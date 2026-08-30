#!/usr/bin/env bun
/**
 * discover-supply-chain — バリューチェーン起点で「キオクシア型」候補を発掘する。
 *
 * ニュース追いかけではなく、メタトレンドを定義して川上から川下のレイヤーを展開し、
 * 各レイヤーで「まだ割安な上場企業」を特定する。
 * ハードウェア・素材・装置・中流部品など、川上側を優先する。
 *
 * 使い方:
 *   bun run scripts/investment/discover-supply-chain.ts
 *   bun run scripts/investment/discover-supply-chain.ts --dry-run
 *   bun run scripts/investment/discover-supply-chain.ts --n 5
 */

import { writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";
import { fetchFundamentals } from "./fetch-fundamentals";
import { fetchPriceHistory } from "./fetch-price-history";
import { sanityCheck } from "./sanity-check";
import { fetchTickerNews } from "./fetch-ticker-news";
import { loadPortfolio } from "./load-context";
import { callClaude } from "../lib/claude";
import { extractJson } from "./util-json";
import type { Fundamentals } from "./types";
import type { PriceMetrics } from "./fetch-price-history";

const CANDIDATES_DIR = "aspects/investment/candidates";
const DEFAULT_FINAL_COUNT = 5;

// =========================================================
// 分析対象メタトレンド（川上優先で設計）
// =========================================================

const METATRENDS = [
  {
    name: "AI データセンターインフラ（川上材料・部品）",
    description:
      "GPU/HBM に使われる電子グレード化学品・フォトマスク・特殊ガス・超純水・サブストレート・PCB 材料。NVDA/AMZN/MSFT は除く。まだ知名度が低い川上 B2B 素材・部品メーカーを優先。",
  },
  {
    name: "ヒューマノイドロボティクス部品",
    description:
      "精密減速機・トルクセンサー・力覚センサー・アクチュエーター向け高性能磁石（ネオジム/フェライト）・エンコーダ・産業用カメラ。Tesla Optimus/Figure AI の見えないサプライヤー。",
  },
  {
    name: "防衛・宇宙グレード電子部品",
    description:
      "MIL-SPEC/ITAR 規制下の耐放射線半導体・RF フィルタ・マイクロ波部品・精密センサー・慣性計測装置（IMU）。防衛予算増・宇宙コンステレーション拡大の川上受益。",
  },
  {
    name: "バイオ製造・医療機器サプライチェーン",
    description:
      "バイオリアクター・クロマトグラフィー樹脂・フィルター膜・細胞培養消耗品・次世代シーケンサー部品。GLP-1/mRNA/CAR-T 生産急増の川上受益。",
  },
  {
    name: "電力インフラ・グリッド近代化",
    description:
      "変圧器コア材（GOES 鋼）・高圧ブッシング・グリッド監視センサー・電力用コンデンサ・配電盤。AI データセンター電力需要拡大でボトルネックになっている川上部品。",
  },
  {
    name: "半導体製造装置・特殊材料",
    description:
      "CVD/ALD ガス・CMM 研磨材・ウェハ搬送・フォトレジスト添加剤・パッケージング基板材料。ASML/LRCX/AMAT の消耗品・周辺機器サプライヤー。",
  },
  {
    name: "次世代輸送・EV サプライチェーン",
    description:
      "SiC パワーモジュール・EV 用高性能銅箔・電池電解質材料・熱管理システム・充電インフラ部品。Tesla/BYD 以外の川上材料・部品企業。",
  },
];

// =========================================================
// 型定義
// =========================================================

interface Args {
  dryRun: boolean;
  n: number;
}

interface ValueChainLayer {
  name: string;
  description: string;
  tickers: string[];
  moatNote: string; // なぜこのレイヤーが代替困難か
}

interface MetatrendMap {
  metatrend: string;
  layers: ValueChainLayer[];
}

interface EvaluatedCandidate {
  ticker: string;
  metatrend: string;
  layer: string;
  thesis: string;
  confidence: "High" | "Med" | "Low";
  recent_news: { date: string; headline: string; url: string }[];
  sources: string[];
}

// =========================================================
// Step 1: メタトレンド → バリューチェーンマップ (Claude)
// =========================================================

const MAP_SYSTEM = `あなたはハードウェア・半導体・エネルギー・宇宙・ロボティクス産業のサプライチェーン専門家です。
メタトレンドを受け取り、川上から川下までのバリューチェーンを展開し、
各レイヤーで「まだ発見されていない / 割安な可能性がある」米国上場企業をティッカーで列挙します。
キオクシア（日本 NAND メモリ）のような「川上の必需品だが注目度が低い」会社を探します。`;

async function buildValueChainMap(
  metatrend: { name: string; description: string },
  excludeTickers: Set<string>,
): Promise<MetatrendMap> {
  const excludeList = [...excludeTickers].sort().join(", ");

  const userPrompt = `メタトレンド「${metatrend.name}」のバリューチェーンを分析してください。

コンテキスト: ${metatrend.description}

**要件:**
- 川上（原材料・素材・化学品）から川下（完成品・プラットフォーム）まで 4-7 レイヤーに分ける
- 各レイヤーで、米国上場（NYSE/NASDAQ）かつ **時価総額 $500M〜$30B** の会社を 2-4 社列挙する
- **川上・中流レイヤーを最優先**（raw materials, equipment, components, sub-systems）
- 各レイヤーに「なぜこのレイヤーが代替困難か」を 1 文で書く
- 除外銘柄（既に保有）: ${excludeList || "なし"}
- $50B+ のメガキャップ（NVDA, MSFT, AMZN, GOOG, AAPL, TSM, ASML 等）は列挙しない

**良い候補の条件:**
- そのレイヤーで代替品が少ない（寡占・独占・特許・装置）
- アナリストカバーが少ない（まだ発見されていない）
- 需要がメタトレンドで構造的に増加する
- 時価総額 $1B-$15B が sweet spot（breakout 余地大）

**出力は以下の JSON のみ**（コードフェンス・前置きなし）:
{
  "metatrend": "${metatrend.name}",
  "layers": [
    {
      "name": "レイヤー名（例: 特殊素材・化学品）",
      "description": "このレイヤーで何が起きているか 1 文",
      "tickers": ["ENTG", "LIQT"],
      "moatNote": "なぜこのレイヤーが代替困難か 1 文"
    }
  ]
}`;

  const raw = await callClaude(
    [{ role: "user", content: userPrompt }],
    { system: MAP_SYSTEM, maxTurns: 1, model: "claude-opus-4-7", maxTokens: 3072 },
  );

  const parsed = extractJson(raw) as MetatrendMap;
  if (!parsed.layers || !Array.isArray(parsed.layers)) {
    throw new Error(`build-value-chain-map (${metatrend.name}): invalid JSON:\n${raw}`);
  }

  // 除外銘柄をフィルタ
  parsed.layers = parsed.layers.map((layer) => ({
    ...layer,
    tickers: layer.tickers.filter((t) => !excludeTickers.has(t.toUpperCase())),
  }));

  return parsed;
}

// =========================================================
// Step 2: 候補を fundamentals/price/news で評価 (Claude)
// =========================================================

const EVAL_SYSTEM = `あなたはハードウェア・素材・装置産業の専門アナリストです。
バリューチェーン上の候補企業を評価し、「キオクシア型の発見前割安株」を見つけます。
ニュース反応ではなく、構造的な競争優位と需要成長の持続性で判断します。`;

function fmtNum(v: number | null, mode: "raw" | "pct" | "money" = "raw"): string {
  if (v === null) return "—";
  if (mode === "pct") return `${(v * 100).toFixed(1)}%`;
  if (mode === "money") {
    if (Math.abs(v) >= 1e12) return `${(v / 1e12).toFixed(2)}T`;
    if (Math.abs(v) >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
    if (Math.abs(v) >= 1e6) return `${(v / 1e6).toFixed(2)}M`;
    return v.toFixed(0);
  }
  return Number.isInteger(v) ? v.toString() : v.toFixed(2);
}

interface CandidateContext {
  ticker: string;
  metatrend: string;
  layer: string;
  layerMoat: string;
  fundamentals?: Fundamentals;
  price?: PriceMetrics;
  news: { title: string; link: string; pubDate: string }[];
}

async function evaluateSupplyChainCandidates(
  candidates: CandidateContext[],
  finalCount: number,
): Promise<EvaluatedCandidate[]> {
  if (candidates.length === 0) return [];

  const blocks: string[] = [];
  for (const c of candidates) {
    const f = c.fundamentals;
    const p = c.price;
    const lines: string[] = [];
    lines.push(`## ${c.ticker} — ${f?.name ?? c.ticker}`);
    lines.push(`- メタトレンド: ${c.metatrend}`);
    lines.push(`- バリューチェーン層: ${c.layer}`);
    lines.push(`- なぜこの層が代替困難: ${c.layerMoat}`);
    if (f) {
      lines.push(`- セクター: ${f.sector ?? "—"} / 業種: ${f.industry ?? "—"}`);
      lines.push(`- 時価総額: ${fmtNum(f.marketCap, "money")} / 現在価格: $${fmtNum(f.price)}`);
      lines.push(`- ファンダ: PER(trail/fwd)=${fmtNum(f.trailingPE)}/${fmtNum(f.forwardPE)}, PBR=${fmtNum(f.priceToBook)}, ROE=${fmtNum(f.returnOnEquity, "pct")}, FCF=${fmtNum(f.freeCashFlow, "money")}, D/E=${fmtNum(f.debtToEquity)}`);
    } else {
      lines.push(`- ファンダ: 取得失敗`);
    }
    if (p) {
      const dropFlag = (p.return1w ?? 0) <= -10 ? " ⚠️ 1w 急落" : "";
      lines.push(`- テクニカル: 1w=${fmtNum(p.return1w)}%, 1m=${fmtNum(p.return1m)}%, 3m=${fmtNum(p.return3m)}%, 6m=${fmtNum(p.return6m)}%, 12m=${fmtNum(p.return12m)}%, drawdown=${fmtNum(p.drawdownPct)}%${dropFlag}`);
    }
    if (c.news.length === 0) {
      lines.push(`- 直近ニュース: なし`);
    } else {
      lines.push(`- 直近ニュース:`);
      c.news.slice(0, 3).forEach((n) => lines.push(`    - [${n.pubDate}] ${n.title} — ${n.link}`));
    }
    blocks.push(lines.join("\n"));
  }

  const userPrompt = `以下はバリューチェーン分析で発掘した候補企業リストです。
最終的に **${finalCount} 銘柄** に絞り込んでください（confidence High/Med のみ採用）。

${blocks.join("\n\n")}

**評価基準（「キオクシア型」= 発見前の川上必需品）:**

1. **バリューチェーン上の不可欠性**（最重視）
   - そのレイヤーで代替できない技術・装置・材料・プロセスを持つか
   - 顧客が切り替えにくい理由（精度要件・認定プロセス・カスタム仕様）があるか

2. **モメンタム未発火**（重要 — これが「発見前」の核心）
   - **1m リターン < +20%、3m リターン < +50% を優先**
   - すでに 3m+80% を超えている銘柄は「発見済み」として大きく減点する
   - 「地味・知られていない・アナリストカバレッジ ≤5 社」を加点
   - 過熱銘柄（3m+100%超）は thesis が良くても最終候補から外す

3. **構造的需要成長**
   - メタトレンドが拡大すれば自動的に需要が増えるか
   - 一時的ブームではなく 5-10 年の secular trend か

4. **発見度（under-covered）**
   - 時価総額 $1B-$15B で機関投資家のカバーが薄い
   - メディア露出が少ない「地味な B2B 企業」を優先

5. **財務健全性**
   - FCF がプラスか、赤字でも売上成長が 20%+ か
   - D/E が極端に高くないか（400 超は要注意）

**除外:**
- 3m リターンが +80% を超えている（モメンタム発火済み、今から買うには遅い）
- drawdown -30% 超 かつ 直近ニュースに悪材料あり
- ファンダ取得失敗 かつ ニュースもなし（確信が持てない）

**Thesis 必須構成（3 要素）:**
1. このレイヤーでなぜ不可欠か（独占性・切り替えコスト）
2. メタトレンドとの連動（なぜ需要が構造的に増えるか）
3. 仮説崩壊条件（何が起きたら thesis を手放すか）

**出力は以下の JSON のみ**（コードフェンス・前置きなし）:
{
  "candidates": [
    {
      "ticker": "ENTG",
      "metatrend": "半導体製造装置・材料",
      "layer": "特殊化学品・洗浄材料",
      "thesis": "...",
      "confidence": "High",
      "recent_news": [{"date": "2026-05-10", "headline": "...", "url": "https://..."}],
      "sources": ["https://..."]
    }
  ]
}`;

  const raw = await callClaude(
    [{ role: "user", content: userPrompt }],
    { system: EVAL_SYSTEM, maxTurns: 1, model: "claude-opus-4-7", maxTokens: 6144 },
  );

  const parsed = extractJson(raw) as { candidates: EvaluatedCandidate[] };
  if (!parsed.candidates || !Array.isArray(parsed.candidates)) {
    throw new Error(`evaluate-supply-chain: invalid JSON from Claude:\n${raw}`);
  }
  return parsed.candidates.filter((c) => c.confidence !== "Low");
}

// =========================================================
// Utils
// =========================================================

function todayJST(): string {
  const now = new Date();
  const jst = new Date(now.getTime() + 9 * 3600 * 1000);
  return jst.toISOString().slice(0, 10);
}

function parseArgs(): Args {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const nIdx = args.indexOf("--n");
  const n = nIdx >= 0 ? parseInt(args[nIdx + 1] ?? "5", 10) : DEFAULT_FINAL_COUNT;
  return { dryRun, n: Number.isFinite(n) && n > 0 ? n : DEFAULT_FINAL_COUNT };
}

// =========================================================
// Main
// =========================================================

async function main() {
  const args = parseArgs();

  console.error(`📂 保有銘柄を読み込み中（除外リスト用）...`);
  let heldTickers: Set<string>;
  try {
    const portfolio = loadPortfolio();
    heldTickers = new Set(portfolio.map((p) => p.ticker.toUpperCase()));
    console.error(`  → ${heldTickers.size} 銘柄を除外対象に設定`);
  } catch (err) {
    console.error(`  ⚠️ portfolio.csv 読み込み失敗: ${err instanceof Error ? err.message : err}`);
    heldTickers = new Set();
  }

  // Step 1: 各メタトレンドのバリューチェーンを展開
  console.error(`🗺️  バリューチェーンマップ構築中（${METATRENDS.length} メタトレンド）...`);
  const allMaps: MetatrendMap[] = [];
  for (const trend of METATRENDS) {
    console.error(`  → ${trend.name} ...`);
    try {
      const map = await buildValueChainMap(trend, heldTickers);
      allMaps.push(map);
    } catch (err) {
      console.error(`  ⚠️ ${trend.name} マップ構築失敗: ${err instanceof Error ? err.message : err}`);
    }
  }

  // Step 2: 全候補ティッカーを収集（重複排除）
  const candidateMap = new Map<string, { metatrend: string; layer: string; moat: string }>();
  for (const m of allMaps) {
    for (const layer of m.layers) {
      for (const ticker of layer.tickers) {
        const upper = ticker.toUpperCase();
        if (!heldTickers.has(upper) && !candidateMap.has(upper)) {
          candidateMap.set(upper, {
            metatrend: m.metatrend,
            layer: layer.name,
            moat: layer.moatNote,
          });
        }
      }
    }
  }
  const allTickers = [...candidateMap.keys()];
  console.error(`  → ${allTickers.length} ユニーク候補を取得: ${allTickers.join(", ")}`);

  if (allTickers.length === 0) {
    console.error("候補が 0 件。メタトレンド定義を確認してください。");
    process.exit(1);
  }

  // Step 3: ファンダメンタル取得 + 時価総額フィルタ ($500M-$50B)
  console.error(`📊 yahoo-finance2 でファンダメンタル取得中...`);
  const candObjs = allTickers.map((t) => ({ ticker: t, name: t, rationale: "" }));
  const fundamentalsArr = await fetchFundamentals(candObjs);
  const fundMap = new Map(fundamentalsArr.map((f) => [f.ticker.toUpperCase(), f]));

  const filteredTickers = allTickers.filter((t) => {
    const f = fundMap.get(t);
    if (!f || f.fetchError) return true; // フェッチ失敗は評価ステップに任せる
    const cap = f.marketCap ?? 0;
    if (cap > 0 && cap < 300_000_000) {
      console.error(`  🔍 ${t}: 時価総額 ${(cap / 1e6).toFixed(0)}M → $300M 未満のため除外`);
      return false;
    }
    if (cap > 50_000_000_000) {
      console.error(`  🔍 ${t}: 時価総額 ${(cap / 1e9).toFixed(0)}B → $50B 超のため除外（メガキャップ）`);
      return false;
    }
    return true;
  });
  console.error(`  → フィルタ後 ${filteredTickers.length} 銘柄`);

  // Step 4: 価格履歴取得
  console.error(`📈 価格履歴取得中...`);
  const prices = await fetchPriceHistory(filteredTickers);

  // Step 5: sanity-check（暴落銘柄を除外）
  console.error(`🚨 sanity-check 中...`);
  const sanityFlags = await sanityCheck(filteredTickers);
  const safeTickers = filteredTickers.filter((t) => {
    const flag = sanityFlags.get(t);
    if (flag && flag.warnings.length > 0) {
      console.error(`  🚨 ${t}: ${flag.warnings.join(" / ")} → 除外`);
      return false;
    }
    return true;
  });
  console.error(`  → sanity-check 通過: ${safeTickers.length} 銘柄`);

  // Step 6: ticker 別ニュース取得
  console.error(`📰 ticker 別ニュース取得中...`);
  const tickerKeys = safeTickers.map((t) => ({ ticker: t, aliases: [fundMap.get(t)?.name ?? t] }));
  const tickerNews = await fetchTickerNews(tickerKeys);

  // Step 7: 評価用コンテキスト組み立て
  const evalInputs: CandidateContext[] = safeTickers.map((t) => {
    const meta = candidateMap.get(t)!;
    const newsItems = tickerNews.get(t) ?? [];
    return {
      ticker: t,
      metatrend: meta.metatrend,
      layer: meta.layer,
      layerMoat: meta.moat,
      fundamentals: fundMap.get(t),
      price: prices.get(t),
      news: newsItems.slice(0, 5).map((n) => ({
        title: n.title,
        link: n.link,
        pubDate: n.pubDate,
      })),
    };
  });

  // Step 8: Claude で最終評価
  console.error(`💎 サプライチェーン候補を評価中（Claude）...`);
  const evaluated = await evaluateSupplyChainCandidates(evalInputs, args.n);
  console.error(
    `  → ${evaluated.length} 銘柄採用: ${evaluated.map((c) => `${c.ticker}(${c.confidence})`).join(", ")}`,
  );

  // Step 9: 出力
  const date = todayJST();
  const output = {
    generated_at: new Date().toISOString(),
    strategy: "supply-chain",
    metatrends_analyzed: METATRENDS.map((m) => m.name),
    excluded_tickers: [...heldTickers].sort(),
    candidates: evaluated,
  };

  if (args.dryRun) {
    console.log(JSON.stringify(output, null, 2));
    console.error(`\n✓ dry-run 完了（JSON ファイル出力なし）`);
    return;
  }

  if (!existsSync(CANDIDATES_DIR)) {
    mkdirSync(CANDIDATES_DIR, { recursive: true });
  }
  const filename = `${date}-supply-chain.json`;
  const fullPath = join(CANDIDATES_DIR, filename);
  writeFileSync(fullPath, JSON.stringify(output, null, 2), "utf-8");
  console.error(`✓ 完了: ${fullPath}`);
  console.error(`  → 次回 /rebalance 実行時に自動取り込み（14 日以内）`);
}

main().catch((err) => {
  console.error("discover-supply-chain failed:", err);
  process.exit(1);
});
