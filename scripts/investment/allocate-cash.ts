/**
 * allocate-cash — cash 残高を Add / Buy 候補に position sizing ルールで配分する。
 *
 * Investor Profile (aggressive growth) に合わせて緩めの sizing。
 * 短期モメンタム反転（1w -10% 以下）には tranche/half-size ルールを適用。
 */

import { callClaude } from "../lib/claude";
import { extractJson } from "./util-json";
import type {
  CashRow,
  HoldingDecision,
  DiscoveryCandidate,
  BuyDecision,
} from "./types";
import type { PriceMetrics } from "./fetch-price-history";

const SYSTEM = `あなたは 30 歳・中長期・aggressive growth tilt の投資家の cash 配分担当です。
保有銘柄評価で ADD が付いた銘柄と、discovery skill が提案した BUY 候補に、現金を配分します。
短期モメンタム反転（1w 急落）には tranche entry を強制します。`;

interface AllocateInput {
  cash: CashRow[];
  /** 今回の TRIM/SELL で生まれる USD 建て proceeds。cash $0 でも BUY/ADD 候補を評価するために使う */
  trimProceedsUSD: number;
  portfolioTotals: { ticker: string; currency: "USD" | "CAD"; valueInCurrency: number; sector: string | null }[];
  portfolioTotalUSD: number;
  portfolioTotalCAD: number;
  adds: HoldingDecision[]; // action === "ADD"
  buys: DiscoveryCandidate[];
  /** 全候補 ticker の price metrics (orchestrator が用意) */
  priceMetrics: Map<string, PriceMetrics>;
}

function fmt(v: number | null): string {
  if (v === null) return "—";
  return Number.isInteger(v) ? v.toString() : v.toFixed(2);
}

function pct(v: number | null): string {
  if (v === null) return "—";
  return `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`;
}

function technicalLine(p: PriceMetrics | undefined): string {
  if (!p) return "(価格データなし)";
  const dropFlag = (p.return1w ?? 0) <= -10 ? " ⚠️ 1w 急落" : "";
  return `現在 $${fmt(p.currentPrice)} / 1w=${pct(p.return1w)} 1m=${pct(p.return1m)} 3m=${pct(p.return3m)} 6m=${pct(p.return6m)} 12m=${pct(p.return12m)} drawdown=${pct(p.drawdownPct)}${dropFlag}`;
}

function buildPrompt(input: AllocateInput): string {
  const cashLines = input.cash
    .map((c) => {
      const trimNote = c.currency === "USD" && input.trimProceedsUSD > 0
        ? ` (内訳: cash.csv $${fmt(c.amount - input.trimProceedsUSD)} + 今回 TRIM 益 $${fmt(input.trimProceedsUSD)})`
        : "";
      return `- ${c.currency}: $${fmt(c.amount)}${trimNote}`;
    })
    .join("\n");
  const sectorTotals = new Map<string, number>();
  for (const t of input.portfolioTotals) {
    const k = t.sector ?? "Unknown";
    sectorTotals.set(k, (sectorTotals.get(k) ?? 0) + t.valueInCurrency);
  }
  const totalAll = input.portfolioTotalUSD + input.portfolioTotalCAD;
  const sectorPct = [...sectorTotals.entries()]
    .map(([s, v]) => `  - ${s}: ${((v / totalAll) * 100).toFixed(1)}%`)
    .join("\n");

  const addLines = input.adds.length === 0
    ? "（ADD 推奨なし）"
    : input.adds.map((a) => {
        const p = input.priceMetrics.get(a.ticker.toUpperCase());
        return `- ${a.ticker} (${a.currency}, ${a.account}) confidence=${a.confidence}\n    価格: ${technicalLine(p)}\n    Thesis: ${a.thesis}`;
      }).join("\n");
  const buyLines = input.buys.length === 0
    ? "（BUY 候補なし）"
    : input.buys.map((b) => {
        const p = input.priceMetrics.get(b.ticker.toUpperCase());
        const entryNote = (b as any).entryNote ? `\n    EntryNote: ${(b as any).entryNote}` : "";
        const bucket = (b as any).bucket ? `\n    Bucket: ${(b as any).bucket}` : "";
        return `- ${b.ticker} (strategy=${b.strategy}) confidence=${b.confidence}${bucket}\n    価格: ${technicalLine(p)}\n    Thesis: ${b.thesis}${entryNote}\n    Sources: ${b.sources.slice(0, 2).join(", ")}`;
      }).join("\n");

  // バケット分類（ticker → bucket）
  const EDGE_CORE = new Set(["NVDA","MSFT","AMZN","GOOG","AAPL","CRWD","AVGO","META","PANW","ASML","ORCL","TSM","AMD","INTC"]);
  const DEFENSIVE = new Set(["SGOV","AXP","WFC","JPM","UL","KO","JNJ","VZ","T","BRK-B"]);
  // それ以外は Edge Lottery または Diversifier Growth として扱う

  const bucketTotals: Record<string, number> = {
    "Edge Core": 0,
    "Edge Lottery / Diversifier": 0,
    "Defensive Value": 0,
    "Cash": input.cash.reduce((s, c) => s + c.amount, 0),
  };
  for (const t of input.portfolioTotals) {
    const upper = t.ticker.toUpperCase();
    if (EDGE_CORE.has(upper)) bucketTotals["Edge Core"] += t.valueInCurrency;
    else if (DEFENSIVE.has(upper)) bucketTotals["Defensive Value"] += t.valueInCurrency;
    else bucketTotals["Edge Lottery / Diversifier"] += t.valueInCurrency;
  }
  const bucketPct = Object.entries(bucketTotals)
    .map(([b, v]) => `  - ${b}: ${((v / totalAll) * 100).toFixed(1)}% (目標: ${
      b === "Edge Core" ? "35-40%" : b === "Edge Lottery / Diversifier" ? "20-30% (Lottery 10-15% + Diversifier 15-20%)" : b === "Defensive Value" ? "10-15%" : "5-10%"
    })`)
    .join("\n");

  // 過熱判定（3m +80% 超の保有が何銘柄あるか）
  const overheatCount = input.portfolioTotals.filter((t) => {
    const p = input.priceMetrics.get(t.ticker.toUpperCase());
    return p && (p.return3m ?? 0) >= 80;
  }).length;
  const macroWarning = overheatCount >= 3
    ? `⚠️ 保有銘柄 ${overheatCount} 銘柄が 3m +80% 超。市場過熱の可能性。Cash 20-30% 維持を強く推奨。BUY 総額を縮小すること。`
    : overheatCount >= 2
    ? `注意: 保有銘柄 ${overheatCount} 銘柄が 3m +80% 超。BUY は厳選し、Cash は 15% 以上残すこと。`
    : "（過熱シグナルなし）";

  return `**現在の cash:**
${cashLines}

**Portfolio 概況:**
- 合計（rough、USD と CAD を単純合算）: $${fmt(totalAll)}
- セクター分布:
${sectorPct}

**バケット別配分（最優先で確認すること）:**
${bucketPct}

**マクロ過熱チェック:** ${macroWarning}

**🚨 Cash 配分の優先順位（この順番で考えること）:**
1. Defensive Value が目標（10-15%）を下回っているなら、まずそこを補填する
2. Diversifier Growth（Edge Lottery/Diversifier の非-AI/非-Tech 部分）が薄ければ補填する
3. 過熱シグナルがある場合は Cash を 20-30% 残す
4. 上記を満たした後の残余 Cash のみで ADD/BUY を実行する

**ADD 推奨銘柄（保有銘柄の買い増し候補、各銘柄に直近の価格推移付き）:**
${addLines}

**BUY 候補（discovery skill 出力、新規銘柄、各銘柄に直近の価格推移付き）:**
${buyLines}

**新規 BUY 件数制限（厳守）:** 新規 BUY（新規銘柄）は最大 3 件。confidence が高い順に選び、残りは「次回候補」として buyDecisions から除外する。

**Position Sizing ルール（3 層 Portfolio フレームワーク、厳守）:**

ユーザーは AI/Software edge の aggressive growth 投資家。以下の 3 層構造で配分:

| 層 | 目標 % | 1 銘柄サイズ |
|---|---|---|
| Edge Core (NVDA/MSFT/AMZN/GOOG 等 mega-cap edge plays) | 35-40% | 5-10% each |
| **Edge Lottery (mid/small-cap AI/Software pre-breakout)** | **10-15%** | **max 3% each (厳守)** |
| Diversifier Growth (Healthcare/Industrials growth) | 15-20% | 3-5% each |
| Defensive Value (Banks, Staples) | 10-15% | 3-5% each |
| Cash | 5-10% | — |

**メタトレンド配分ルール（厳守）:**

- BUY / ADD 候補は、まず「どの 10 年級メタトレンドに乗るか」を確認する
- 牽引企業・プラットフォーム企業・不可欠インフラ企業は Core/Diversifier として厚めを許容する
- 周辺銘柄・単一プロダクト・採用初期で winner 不明な候補は Edge Lottery として小さく分散する
- メタトレンド仮説が弱い候補、または実需・収益化がニュースから確認できない候補には配分しない
- thesis には「メタトレンド仮説」「牽引企業としての根拠」「主な仮説崩壊条件」を含める

**配分時の判断ルール:**

- **BUY 候補 (discovery 出力) のサイジング:**
  - mid/small-cap ($1B-$20B): **Edge Lottery 扱い、max 3% portfolio (= $1,500-$2,000 程度)**
  - 5-7 銘柄に分散して "lottery ticket basket" を構築
  - mega-cap ($50B+, 稀): Edge Core 扱い 5-10% portfolio
- **ADD 候補 (existing holding) のサイジング:**
  - 現サイズ < 5% かつ確信あり → 5% 目標まで増額
  - 現サイズ 5-10% → maintained (Edge Core 確立済み)
  - 現サイズ > 10% → ADD しない (むしろ TRIM 候補)
- 1 銘柄あたり portfolio 占有率 **≤ 15%**（既存保有分も含めて、絶対上限）
- **GICS Tech ≤ 40% は廃止**。代わりに **AI/Software ecosystem (Tech + AI 関連 Comm Services + AMZN 等) ≤ 60%**
- confidence Low の銘柄には配分しない
- currency マッチ厳守: USD cash → USD 銘柄、CAD cash → CAD 銘柄
- cash 残し率 5-10% を保つ (Edge Lottery basket の追加買い増し余地として)

**Edge Lottery の数学 (理解しておくこと):**
- 10x になる: 5-10%
- 2-5x になる: 15-20%
- 横ばい〜微増: 20-30%
- -50%+ 失敗: 40-50%
- → high variance、small × many bets が正しい戦略。大きく賭けると基準分布通り 40-50% 失敗で portfolio 重大棄損

**短期モメンタム反転ルール（厳守、上記の上書き）:**
- **1w return が -10% 以下** の銘柄に配分する場合は、**通常の半分以下**にサイズ縮小し、必ず \`trancheRecommended: true\` を設定する
  - 例: 通常 cash の 40% 配分 → 1w 急落銘柄なら最大 20%
  - 理由: 短期急落は thesis が壊れた possibility あり、または追加下落リスクあり。一括投入は危険
- **1w が -10% 以下 かつ confidence Low** → 配分しない
- **1m return が -15% 以下 かつ ニュースで悪材料あり** → 配分しない（thesis 確認まで待機）
- **1w が -10% 以下 だが ニュースは中立/好材料** → tranche entry で半分配分、残りは様子見

**アナリスト PT 引上げに釣られない:**
- 大幅下落直後の PT 引上げは「分析家の擁護」の可能性を疑う
- 価格モメンタム + ファンダ + ニュースを総合判断し、PT 引上げ単独で増額しない

ルールに違反する候補は配分せず thesis に「制約違反のため見送り」と書く。

**出力は以下の JSON のみ**（コードフェンス・前置きなし）:
{
  "buyDecisions": [
    {
      "ticker": "TSM",
      "source": "existing-holding" or strategy name (例: "growth"),
      "action": "BUY" or "ADD",
      "amount": 1200,
      "currency": "USD",
      "confidence": "High",
      "thesis": "配分根拠（ADD/BUY それぞれの thesis を 2-3 文。1w 急落なら tranche 理由を明記）",
      "sources": ["https://..."],
      "trancheRecommended": false
    }
  ],
  "remainder": [
    {"currency": "USD", "amount": 1500},
    {"currency": "CAD", "amount": 2000}
  ]
}

source 値の規則:
- ADD の場合: "existing-holding"
- BUY の場合: 候補の strategy 名（例: "growth", "value"）

\`trancheRecommended\`:
- 1w return が -10% 以下なら必ず \`true\`
- それ以外は \`false\``;
}

export async function allocateCash(input: AllocateInput): Promise<{ buyDecisions: BuyDecision[]; remainder: { currency: "USD" | "CAD"; amount: number }[] }> {
  const totalAvailableUSD = input.cash.reduce((s, c) => s + (c.currency === "USD" ? c.amount : 0), 0);
  const totalAvailableCAD = input.cash.reduce((s, c) => s + (c.currency === "CAD" ? c.amount : 0), 0);
  if (input.adds.length === 0 && input.buys.length === 0) {
    return { buyDecisions: [], remainder: [{ currency: "USD", amount: totalAvailableUSD }, { currency: "CAD", amount: totalAvailableCAD }] };
  }

  const userPrompt = buildPrompt(input);

  const raw = await callClaude(
    [{ role: "user", content: userPrompt }],
    { system: SYSTEM, maxTurns: 1, model: "claude-opus-4-7", maxTokens: 4096 },
  );

  const parsed = extractJson(raw) as {
    buyDecisions: Array<{
      ticker: string;
      source: string;
      action: "BUY" | "ADD";
      amount: number;
      currency: "USD" | "CAD";
      confidence: "High" | "Med" | "Low";
      thesis: string;
      sources: string[];
      trancheRecommended?: boolean;
    }>;
    remainder: { currency: "USD" | "CAD"; amount: number }[];
  };

  if (!parsed.buyDecisions || !Array.isArray(parsed.buyDecisions)) {
    throw new Error(`allocate-cash: invalid JSON from Claude:\n${raw}`);
  }

  const addMap = new Map(input.adds.map((a) => [a.ticker.toUpperCase(), a]));
  const buyMap = new Map(input.buys.map((b) => [b.ticker.toUpperCase(), b]));

  const buyDecisions: BuyDecision[] = parsed.buyDecisions.map((d) => {
    const tickerUpper = d.ticker.toUpperCase();
    const add = addMap.get(tickerUpper);
    const buy = buyMap.get(tickerUpper);
    const p = input.priceMetrics.get(tickerUpper);
    const recentNews = add ? add.recentNews : buy ? buy.recentNews : [];
    const baseSources = add ? add.sources : buy ? buy.sources : [];
    const mergedSources = [...new Set([...d.sources, ...baseSources])];
    // Safety: コード側でも 1w 急落フラグを上書き判定（プロンプトが見落とした場合の保険）
    const enforcedTranche = (p?.return1w ?? 0) <= -10 ? true : (d.trancheRecommended ?? false);
    return {
      ticker: d.ticker,
      source: d.source as BuyDecision["source"],
      action: d.action,
      amount: d.amount,
      currency: d.currency,
      confidence: d.confidence,
      thesis: d.thesis,
      recentNews,
      sources: mergedSources.length > 0 ? mergedSources : ["https://finance.yahoo.com/quote/" + d.ticker],
      currentPrice: p?.currentPrice ?? null,
      technicals: p
        ? {
            return1w: p.return1w,
            return1m: p.return1m,
            return3m: p.return3m,
            return6m: p.return6m,
            return12m: p.return12m,
            drawdownPct: p.drawdownPct,
          }
        : undefined,
      trancheRecommended: enforcedTranche,
    };
  });

  return { buyDecisions, remainder: parsed.remainder ?? [] };
}
