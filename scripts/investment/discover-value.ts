#!/usr/bin/env bun
/**
 * discover-value — news 起点で value 候補を発掘し、
 * aspects/investment/candidates/<YYYY-MM-DD>-value.json に出力する。
 *
 * /rebalance が次回実行時にこの候補ファイルを自動取り込みする。
 *
 * 違い vs daily-report:
 * - daily-report は 1 テーマに集中、Notion に書く（記録用）
 * - discover-value は保有銘柄除外、複数テーマ可、ファイル出力（/rebalance 入力用）
 *
 * 使い方:
 *   bun run scripts/investment/discover-value.ts            # 本番（JSON 出力）
 *   bun run scripts/investment/discover-value.ts --dry-run  # JSON 出力せず stdout
 *   bun run scripts/investment/discover-value.ts --n 6      # 候補数指定（default 5）
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
const DEFAULT_PICK_COUNT = 12;
const DEFAULT_FINAL_COUNT = 5;

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
// Step 1: news から value 候補を pick (Claude)
// =========================================================

const PICK_SYSTEM = `あなたは long-term value 投資の銘柄発掘担当です。
ニュースから「割安かつクオリティのある」銘柄候補をピックアップします。
モメンタムではなく **バリュー指標 + クオリティ + 構造的優位** で選びます。バリュートラップ（割安に見えて構造的に衰退）には特に注意します。`;

interface PickedCandidate {
  ticker: string;
  name: string;
  theme: string;
  rationale: string;
}

async function pickValueCandidatesFromNews(
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

これらから **value (割安) 投資の候補銘柄** を ${pickCount} 個ピックアップしてください。

**ピック基準（必須）:**
- **割安性**: PER（trail/fwd）が同セクター平均より低い、PBR が低い、FCF yield が出ている、配当利回り妥当
- **クオリティ**: ROE が安定、負債比率が極端でない、長期キャッシュフロー強固
- **構造的優位**: 寡占・規制保護・ブランド・スイッチングコスト等の堀
- 中型〜大型株を優先（time-tested で流動性ある銘柄）
- **既存保有銘柄は除外**: ${excludeList || "（保有なし）"}

**避ける（バリュートラップ警告）:**
- 構造的衰退セクター（古いメディア、伝統小売、化石燃料中心電力等）
- 利益縮小傾向 / FCF マイナス / 配当カット履歴
- 粉飾疑惑・規制リスク・訴訟リスク
- 過去 30 日に大きく崩れた（drawdown -25% 超）銘柄
- ペニーストック・IPO 直後（>6 ヶ月実績がない）

セクター偏りを避け、できるだけ複数業種から選んでください（消費財・金融・ヘルスケア・産業財・公益等）。

**Tech は避けるか少数に。** Tech は growth tilt 用なので value 探索では弱含み。

**出力は以下の JSON のみ**（コードフェンス・前置きなし）:
{
  "candidates": [
    {
      "ticker": "BRK.B",
      "name": "Berkshire Hathaway",
      "theme": "保険・コングロマリット（堀広い）",
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
    throw new Error(`pick-value-candidates: invalid JSON from Claude:\n${raw}`);
  }
  return parsed.candidates.filter((c) => !excludeTickers.has(c.ticker.toUpperCase()));
}

// =========================================================
// Step 2: 候補を fundamentals/price/news で評価 (Claude)
// =========================================================

const EVAL_SYSTEM = `あなたは long-term value 投資家のためのアナリストです。
バリュー指標と質的競争優位で銘柄を評価し、確信度の高いものに絞ります。
モメンタムや高 PER は選好理由になりません。バリュートラップ（割安に見えて構造的衰退）を厳しくスクリーニングします。`;

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

async function evaluateValueCandidates(
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
      lines.push(`- ファンダ: PER(trail/fwd)=${fmtNum(f.trailingPE)}/${fmtNum(f.forwardPE)}, PBR=${fmtNum(f.priceToBook)}, ROE=${fmtNum(f.returnOnEquity, "pct")}, 配当=${fmtNum(f.dividendYield, "pct")}, FCF=${fmtNum(f.freeCashFlow, "money")}, D/E=${fmtNum(f.debtToEquity)}`);
      lines.push(`- 52w レンジ: ${fmtNum(f.fiftyTwoWeekLow)} - ${fmtNum(f.fiftyTwoWeekHigh)}`);
    } else {
      lines.push(`- ファンダ: 取得失敗`);
    }
    if (p) {
      const dropFlag = (p.return1w ?? 0) <= -10 ? " ⚠️ 1w 急落" : "";
      lines.push(`- 価格推移: 1w=${fmtNum(p.return1w)}%, 1m=${fmtNum(p.return1m)}%, 3m=${fmtNum(p.return3m)}%, 6m=${fmtNum(p.return6m)}%, 12m=${fmtNum(p.return12m)}%, drawdown(12m高値)=${fmtNum(p.drawdownPct)}%${dropFlag}`);
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

  const userPrompt = `以下は news 起点でピックした value 候補銘柄リストです。**${finalCount} 銘柄に絞り込んで** confidence High/Med のみを採用してください。

${blocks.join("\n\n")}

**評価基準（重要度順）:**
1. **割安性（最重要）** — PER(fwd) が同セクター平均より低い、PBR が低い、FCF yield (FCF / market cap) が 5% 以上、配当利回りが 2% 以上で safe
2. **クオリティ** — ROE 安定して 10%+、D/E 200 未満、利益マージン健全
3. **構造的優位** — 寡占・規制保護・ブランド・switching cost・network effect 等の経済的堀
4. **直近ニュース** — earnings 良好、買収・自社株買い・スピンオフ等のカタリスト
5. **下値リスク** — 52w 安値近辺で底値感がある（モメンタムには使わない）

**バリュートラップとして除外（必須スクリーニング）:**
- FCF マイナス
- 売上 / 利益縮小トレンド明確
- D/E 400 超または利息カバレッジ低い
- 配当カット・粉飾疑惑・規制リスク
- ニュースで earnings miss + ガイダンス下方修正
- drawdown -25% 以上で構造的悪化の疑い濃厚

**Confidence:**
- High: 割安 + クオリティ + 堀 + 直近ニュース好材料
- Med: 2-3 つの基準を満たすが 1 つ弱い
- Low: 採用しない

**避けるバイアス:**
- 高 PER でも growth が良いから OK → ❌ 違う、これは value 探索
- モメンタムが強いから魅力 → ❌ value は底値・割安が魅力
- Tech だから採用 → ❌ Tech は growth tilt 用、value 探索では他セクター優先

各候補について:
- \`thesis\`: なぜこの銘柄が value (割安かつクオリティ) なのか。**バリュー指標を最上位根拠**、直近ニュースは補助。3-4 文
- \`recent_news\`: 強いニュース 0-3 件 \`{date, headline, url}\`
- \`sources\`: thesis の根拠 URL を 1 つ以上

**出力は以下の JSON のみ**（コードフェンス・前置きなし）:
{
  "candidates": [
    {
      "ticker": "BRK.B",
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
    throw new Error(`evaluate-value: invalid JSON from Claude:\n${raw}`);
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

  console.error(`🎯 value 候補ピックアップ中（Claude）...`);
  const picked = await pickValueCandidatesFromNews(news, heldTickers, DEFAULT_PICK_COUNT);
  console.error(`  → ${picked.length} 銘柄候補: ${picked.map((p) => p.ticker).join(", ")}`);
  if (picked.length === 0) {
    console.error("value 候補が 1 件も出ませんでした。news 内容を確認してください。");
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
  const safePicked = picked.filter((p) => {
    const flag = sanityFlags.get(p.ticker.toUpperCase());
    return !flag || flag.warnings.length === 0;
  });
  if (safePicked.length < picked.length) {
    console.error(`  → ${picked.length - safePicked.length} 銘柄を sanity-check で除外`);
  }

  console.error(`💎 value 評価中（Claude）...`);
  const evaluated = await evaluateValueCandidates(safePicked, fundMap, prices, tickerNews, args.n);
  console.error(`  → ${evaluated.length} 銘柄を採用: ${evaluated.map((c) => `${c.ticker}(${c.confidence})`).join(", ")}`);

  const date = todayJST();
  const output = {
    generated_at: new Date().toISOString(),
    strategy: "value",
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
  const filename = `${date}-value.json`;
  const fullPath = join(CANDIDATES_DIR, filename);
  writeFileSync(fullPath, JSON.stringify(output, null, 2), "utf-8");
  console.error(`✓ 完了: ${fullPath}`);
  console.error(`  → 次回 /rebalance 実行時に自動取り込み（14 日以内）`);
}

main().catch((err) => {
  console.error("discover-value failed:", err);
  process.exit(1);
});
