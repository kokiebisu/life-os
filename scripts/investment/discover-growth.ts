#!/usr/bin/env bun
/**
 * discover-growth — news 起点で growth 候補を発掘し、
 * aspects/investment/candidates/<YYYY-MM-DD>-growth.json に出力する。
 *
 * /rebalance が次回実行時にこの候補ファイルを自動取り込みする。
 *
 * 使い方:
 *   bun run scripts/investment/discover-growth.ts            # 本番（JSON 出力）
 *   bun run scripts/investment/discover-growth.ts --dry-run  # JSON 出力せず stdout
 *   bun run scripts/investment/discover-growth.ts --n 6      # 候補数指定（default 5）
 */

import { writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";
import { fetchNews } from "./fetch-news";
import { fetchFundamentals } from "./fetch-fundamentals";
import { fetchPriceHistory } from "./fetch-price-history";
import { sanityCheck } from "./sanity-check";
import { fetchTickerNews } from "./fetch-ticker-news";
import { loadPortfolio } from "./load-context";
import { callClaude } from "../lib/claude";
import { extractJson } from "./util-json";
import type { NewsItem, Fundamentals, Candidate } from "./types";
import type { PriceMetrics } from "./fetch-price-history";

const CANDIDATES_DIR = "aspects/investment/candidates";
const DEFAULT_PICK_COUNT = 12; // Claude が news から最初に出す candidate 数
const DEFAULT_FINAL_COUNT = 5; // 最終的に JSON に書く数

interface Args {
  dryRun: boolean;
  n: number;
}

function parseArgs(): Args {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const nIdx = args.indexOf("--n");
  const n = nIdx >= 0 ? parseInt(args[nIdx + 1] ?? "5", 10) : DEFAULT_FINAL_COUNT;
  return { dryRun, n: Number.isFinite(n) && n > 0 ? n : DEFAULT_FINAL_COUNT };
}

function todayJST(): string {
  const now = new Date();
  const jst = new Date(now.getTime() + 9 * 3600 * 1000);
  return jst.toISOString().slice(0, 10);
}

// =========================================================
// Step 1: news から growth 候補を pick (Claude)
// =========================================================

const PICK_SYSTEM = `あなたは aggressive growth tilt の投資家のための銘柄発掘担当です。
ニュースから「中長期 (3 ヶ月〜数年) で爆発的に伸びる可能性がある」銘柄候補をピックアップします。
バリュー指標ではなく **売上成長率 + テーマ性 + カタリスト** で選びます。`;

interface PickedCandidate {
  ticker: string;
  name: string;
  theme: string;
  rationale: string;
}

async function pickGrowthCandidatesFromNews(
  news: NewsItem[],
  excludeTickers: Set<string>,
  pickCount: number,
): Promise<PickedCandidate[]> {
  const newsSummary = news
    .slice(0, 60)
    .map((n, i) => `${i + 1}. [${n.source}] ${n.title}`)
    .join("\n");

  const excludeList = [...excludeTickers].sort().join(", ");

  const userPrompt = `以下は本日取得したニュース見出しです。

${newsSummary}

これらから **growth テーマで 3 ヶ月〜数年スパンで爆発的に伸びる可能性がある銘柄** を ${pickCount} 個ピックアップしてください。

**ユーザーの edge: AI / Software / Tech ecosystem (software engineer の視点で評価可能)。Edge Lottery 候補として「化ける」狙い。**

**ピック基準（厳守）:**
- **テーマ: AI/Software ecosystem 内に絞る (優先順)**
  1. **AI infrastructure / dev tools / cloud** (engineer が使う SaaS、AI 開発ツール、observability)
  2. **AI security / cyber** (engineer が評価しやすい領域)
  3. **AI applications / vertical SaaS** (specific industry に AI を載せた SaaS)
  4. **Adjacent: AI 電力 / semi 周辺 / 量子 / 核融合** (AI の supply chain 周辺)
  5. (低優先) 非 AI/Tech (Healthcare biotech, 宇宙, 防衛) — 1-2 銘柄まで、diversifier 用
- **市場規模: $1B-$20B mid/small-cap が sweet spot** (Edge Lottery = 化ける狙い)
  - **$5B-$15B が最も好み** (pre-breakout: 機関ホルダー余地大 + 業績急加速段階)
  - $50B+ のメガキャップ (NVDA, MSFT, AMZN, GOOG, AVGO, ASML, TSM 規模) は **採用 0 銘柄** (Edge Core 担当、Lottery じゃない)
  - $20B-$50B は **採用 0-1 銘柄まで** (もう走った後の可能性大)
  - 例えるなら RKLB ($1B 時) / CRWD ($10B 時) / SNOW IPO 直後 のような pre-breakout 銘柄
- 直近で **earnings 急加速 / 巨大契約 / アナリスト upgrade ラッシュ / sector momentum** がある銘柄を優先
- **First-hand evaluable products を優先**: engineer として試せる/使える、AWS/Azure 競合で adoption 見える、面接先 SaaS choice で見える
- **既存保有銘柄は除外**: ${excludeList || "（保有なし）"}

**避ける:**
- $500M 以下のペニーストック領域 (流動性・破綻リスク)
- $50B+ のメガキャップ全て (Edge Core 担当、Lottery じゃない)
- 上場直後 IPO（>6 ヶ月実績を見たい）
- 配当株（growth より income 向き）
- 既に -50% drawdown 等で構造的悪化している銘柄
- **非 AI/Tech (Materials, Restaurants, Mining, Banks, Consumer Brands 等) を主力に持つ銘柄** ← edge 外、value/defensive 層担当
  - 例外: AI 周辺 (AI 電力 utility, AI 量子) は OK

複数テーマから分散して選んでください (例: dev tools + AI security + AI infra + 量子)。同じテーマで 3 銘柄以上は禁止。

**出力は以下の JSON のみ**（コードフェンス・前置きなし）:
{
  "candidates": [
    {
      "ticker": "TSM",
      "name": "Taiwan Semiconductor",
      "theme": "AI 半導体 (foundry 寡占)",
      "rationale": "（なぜこの候補を選んだか、1-2 文）"
    }
  ]
}`;

  const raw = await callClaude(
    [{ role: "user", content: userPrompt }],
    { system: PICK_SYSTEM, maxTurns: 1, model: "claude-opus-4-7", maxTokens: 3072 },
  );

  const parsed = extractJson(raw) as { candidates: PickedCandidate[] };
  if (!parsed.candidates || !Array.isArray(parsed.candidates)) {
    throw new Error(`pick-growth-candidates: invalid JSON from Claude:\n${raw}`);
  }
  return parsed.candidates.filter((c) => !excludeTickers.has(c.ticker.toUpperCase()));
}

// =========================================================
// Step 2: 候補を fundamentals/price/news で評価 (Claude)
// =========================================================

const EVAL_SYSTEM = `あなたは aggressive growth 投資家のためのアナリストです。
売上成長率・モメンタム・カタリストで銘柄を評価し、確信度の高いものに絞ります。
バリュー指標 (低 PER 等) は **下値リスクのスクリーニング** に使うのみで、選好理由ではありません。`;

interface DiscoveryOutput {
  ticker: string;
  thesis: string;
  confidence: "High" | "Med" | "Low";
  recent_news: { date: string; headline: string; url: string }[];
  sources: string[];
}

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

async function evaluateGrowthCandidates(
  picked: PickedCandidate[],
  fundamentals: Map<string, Fundamentals>,
  prices: Map<string, PriceMetrics>,
  newsByTicker: Map<string, NewsItem[]>,
  finalCount: number,
): Promise<DiscoveryOutput[]> {
  const blocks: string[] = [];
  for (const c of picked) {
    const upper = c.ticker.toUpperCase();
    const f = fundamentals.get(upper);
    const p = prices.get(upper);
    const news = newsByTicker.get(upper) ?? [];
    const lines: string[] = [];
    lines.push(`## ${c.ticker} — ${c.name} (Theme: ${c.theme})`);
    lines.push(`- 候補理由: ${c.rationale}`);
    if (f) {
      lines.push(`- セクター: ${f.sector ?? "—"} / 業種: ${f.industry ?? "—"}`);
      lines.push(`- 現在価格: $${fmtNum(f.price)} ${f.currency} / 時価総額: ${fmtNum(f.marketCap, "money")}`);
      lines.push(`- ファンダ: PER(trail/fwd)=${fmtNum(f.trailingPE)}/${fmtNum(f.forwardPE)}, PBR=${fmtNum(f.priceToBook)}, ROE=${fmtNum(f.returnOnEquity, "pct")}, FCF=${fmtNum(f.freeCashFlow, "money")}, D/E=${fmtNum(f.debtToEquity)}`);
    } else {
      lines.push(`- ファンダ: 取得失敗`);
    }
    if (p) {
      const dropFlag = (p.return1w ?? 0) <= -10 ? " ⚠️ 1w 急落" : "";
      lines.push(`- テクニカル: 1w=${fmtNum(p.return1w)}%, 1m=${fmtNum(p.return1m)}%, 3m=${fmtNum(p.return3m)}%, 6m=${fmtNum(p.return6m)}%, 12m=${fmtNum(p.return12m)}%, drawdown(12m高値)=${fmtNum(p.drawdownPct)}%${dropFlag}`);
    }
    if (news.length === 0) {
      lines.push(`- 直近ニュース: 取得できず`);
    } else {
      lines.push(`- 直近ニュース（${news.length} 件）:`);
      news.slice(0, 5).forEach((n) => {
        lines.push(`    - [${n.pubDate}] ${n.title} — ${n.link}`);
      });
    }
    blocks.push(lines.join("\n"));
  }

  const userPrompt = `以下は news 起点でピックした growth 候補銘柄リストです。**${finalCount} 銘柄に絞り込んで** confidence High/Med のみを採用してください。

${blocks.join("\n\n")}

**評価基準（最優先 → 補助）:**
1. **直近 30 日のニュース・カタリスト** — earnings beat、ガイダンス上方修正、巨大契約、新製品ローンチ、規制緩和等
2. **テクニカル** — 3/6/12 ヶ月リターンが正、SMA 上抜け、drawdown 軽微
3. **売上成長率** — fundamentals に直接出ないが、ROE × FCF growth、セクター成長率で代理判定
4. **テーマ性** — AI、semis、宇宙、バイオ、クリーンエネルギー等の中長期トレンド

**カットオフ:**
- 直近 30 日にネガティブニュース (earnings miss + ガイダンス下方修正、訴訟、規制ショック) → 採用しない
- drawdown <= -25% AND モメンタム弱い → 採用しない (構造的悪化の疑い)
- ニュースが 0 件で確信度が組み立てられない → 採用しない (confidence Low と判定し除外)
- PER は基準にしない (growth tilt なので高 PER 許容)

**Confidence:**
- High: 強いカタリスト + 上向きモメンタム + ファンダ堅牢
- Med: カタリストあるが価格まだ動いていない、or モメンタムあるがニュース弱い
- Low: 不確実性大、採用しない

各候補について:
- \`thesis\`: なぜこの銘柄が中長期 growth なのか、**直近ニュースを最上位根拠として引用**。3-4 文
- \`recent_news\`: 強いニュース 1-3 件 \`{date, headline, url}\`
- \`sources\`: thesis の根拠 URL を 1 つ以上

**出力は以下の JSON のみ**（コードフェンス・前置きなし）:
{
  "candidates": [
    {
      "ticker": "TSM",
      "thesis": "...",
      "confidence": "High",
      "recent_news": [{"date": "2026-05-18", "headline": "...", "url": "https://..."}],
      "sources": ["https://...", "https://..."]
    }
  ]
}`;

  const raw = await callClaude(
    [{ role: "user", content: userPrompt }],
    { system: EVAL_SYSTEM, maxTurns: 1, model: "claude-opus-4-7", maxTokens: 6144 },
  );

  const parsed = extractJson(raw) as { candidates: DiscoveryOutput[] };
  if (!parsed.candidates || !Array.isArray(parsed.candidates)) {
    throw new Error(`evaluate-growth: invalid JSON from Claude:\n${raw}`);
  }
  return parsed.candidates.filter((c) => c.confidence !== "Low");
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
    console.error(`  ⚠️ portfolio.csv 読み込み失敗（除外なしで継続）: ${err instanceof Error ? err.message : err}`);
    heldTickers = new Set();
  }

  console.error(`📰 ニュース取得中...`);
  const news = await fetchNews();
  console.error(`  → ${news.length} 件取得`);
  if (news.length === 0) {
    console.error("ニュースが 1 件も取れませんでした。RSS フィードを確認してください。");
    process.exit(1);
  }

  console.error(`🎯 growth 候補ピックアップ中（Claude）...`);
  const picked = await pickGrowthCandidatesFromNews(news, heldTickers, DEFAULT_PICK_COUNT);
  console.error(`  → ${picked.length} 銘柄候補: ${picked.map((p) => p.ticker).join(", ")}`);
  if (picked.length === 0) {
    console.error("growth 候補が 1 件も出ませんでした。news 内容を確認してください。");
    process.exit(1);
  }

  const tickers = picked.map((p) => p.ticker);

  console.error(`📊 yahoo-finance2 で財務指標取得中...`);
  const candForFund: Candidate[] = picked.map((p) => ({ ticker: p.ticker, name: p.name, rationale: p.rationale }));
  const fundamentalsArr = await fetchFundamentals(candForFund);
  const fundMap = new Map(fundamentalsArr.map((f) => [f.ticker.toUpperCase(), f]));

  console.error(`📈 価格履歴取得中...`);
  const prices = await fetchPriceHistory(tickers);

  console.error(`📰 ticker 別ニュース取得中（yahoo-finance2.search）...`);
  const tickerKeys = picked.map((p) => ({ ticker: p.ticker, aliases: [p.name] }));
  const tickerNews = await fetchTickerNews(tickerKeys);
  const totalTickerNews = [...tickerNews.values()].reduce((sum, items) => sum + items.length, 0);
  console.error(`  → ${totalTickerNews} 件マッチ`);

  console.error(`🚨 sanity-check 中...`);
  const sanityFlags = await sanityCheck(tickers);
  for (const [t, flag] of sanityFlags) {
    if (flag.warnings.length > 0) {
      console.error(`  🚨 ${t}: ${flag.warnings.join(" / ")}`);
    }
  }
  // 暴落銘柄は picked から除外（discovery では最初から避ける）
  const safePicked = picked.filter((p) => {
    const flag = sanityFlags.get(p.ticker.toUpperCase());
    return !flag || flag.warnings.length === 0;
  });
  if (safePicked.length < picked.length) {
    console.error(`  → ${picked.length - safePicked.length} 銘柄を sanity-check で除外`);
  }

  console.error(`💎 growth 評価中（Claude）...`);
  const evaluated = await evaluateGrowthCandidates(safePicked, fundMap, prices, tickerNews, args.n);
  console.error(`  → ${evaluated.length} 銘柄を採用: ${evaluated.map((c) => `${c.ticker}(${c.confidence})`).join(", ")}`);

  const date = todayJST();
  const output = {
    generated_at: new Date().toISOString(),
    strategy: "growth",
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
  const filename = `${date}-growth.json`;
  const fullPath = join(CANDIDATES_DIR, filename);
  writeFileSync(fullPath, JSON.stringify(output, null, 2), "utf-8");
  console.error(`✓ 完了: ${fullPath}`);
  console.error(`  → 次回 /rebalance 実行時に自動取り込み（14 日以内）`);
}

main().catch((err) => {
  console.error("discover-growth failed:", err);
  process.exit(1);
});
