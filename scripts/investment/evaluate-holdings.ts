/**
 * evaluate-holdings — 各保有銘柄について Hold / Trim / Sell / Add を判定する。
 *
 * 直近ニュースを最優先軸とし、Investor Profile (30 / 中長期 / aggressive growth) を
 * プロンプトで明示。Sources URL 必須。TRIM/SELL の場合は売却量も Claude に出させる。
 */

import { callClaude } from "../lib/claude";
import { extractJson } from "./util-json";
import type {
  PortfolioRow,
  Fundamentals,
  NewsItem,
  SanityFlag,
  HoldingDecision,
  RebalanceAction,
} from "./types";
import type { PriceMetrics } from "./fetch-price-history";

const SYSTEM = `あなたは 30 歳・中長期投資・aggressive growth tilt の投資家のためのポートフォリオ・アドバイザーです。

**Investor Profile（必ず遵守）:**
- リスク許容度: 高い。横ばい配当株より成長株を優先する
- 時間軸: 3 ヶ月〜数年の中長期。日次トレードではない
- バイアス: 売上成長率・カタリスト・テーマ性を重視。バリュー指標は下値リスクのスクリーニング用
- 集中度: やや集中許容（1 銘柄 max 15% portfolio、確信があれば厚く張ってよい）
- 配当志向: 弱い

**メタトレンド投資フレーム（中島聡氏の手法から着想、必ず反映）:**
- 短期ニュースだけでなく、10 年単位の技術・社会構造変化（例: AI、半導体、電力インフラ、ロボティクス、バイオ、金融インフラ）に乗っているかを評価する
- 各銘柄を「どのメタトレンドの牽引企業か / 単なる周辺銘柄か / メタトレンド性が弱いか」で判定する
- メタトレンド仮説が維持されている winner は、含み益が大きいだけでは売らない。売却理由は「仮説崩壊」「過集中」「短期急落 + 悪材料」「より強い機会への資金移動」に限定する
- 逆に、メタトレンドと無関係な高 PER 銘柄や、テーマだけで実需・収益化が弱い銘柄は厳しく見る

**Thesis 必須構成（厳守、ラベル貼りだけ禁止）:**

各銘柄の thesis は以下 3 要素を必ず含む。「メタトレンド winner」と書くだけでは不可：

1. **なぜこの会社が 10 年後も生き残るか**（バリューチェーン上の立ち位置・独占性・切り替えコスト・エコシステム）
   - 例: 「CUDA エコシステムは移行コストが高すぎて競合が食い込めない」
   - 例: 「EUV 露光機は物理的に ASML しか製造できず、代替技術は 10 年以上かかる」
   - ❌ 禁止: 「AI 半導体のメタトレンド winner」だけ

2. **サプライチェーン上の位置**（川上・中流・川下 の分類と、なぜそこが有利か）
   - 川上（原材料・装置・部品）→ 需要が確定した後でも恩恵が続く「ピックアンドシャベル」
   - 川下（アプリ・プラットフォーム）→ 勝者総取りになるが競争も激しい
   - その会社がバリューチェーンのどこにいて、なぜ不可欠かを 1 文で

3. **仮説崩壊条件**（具体的なイベント）
   - 例: 「主要ハイパースケーラーがカスタムチップ（TPU/Trainium）へ全面移行した場合」
   - 例: 「中国製 EUV が実用化レベルに達した場合」
   - ❌ 禁止: 「競争が激化したら」のような抽象的表現

**評価軸の優先順位:**
1. **直近のニュース・sentiment（最優先）** — 過去 30 日の earnings、ガイダンス、規制、訴訟、insider 取引、アナリスト評価変更。カタリストの有無が判定の主軸
2. **メタトレンド仮説** — 10 年単位の構造変化に乗る winner か、周辺銘柄か、テーマ性だけか
3. テクニカル / 価格モメンタム — 1w/1m/3/6/12 ヶ月リターン、drawdown
4. ファンダメンタル — 売上成長率を最重視（低 PER ≠ 買い）
5. portfolio 全体の健全性 — aggressive profile 前提で多少の偏りは許容

**重要ルール:**
- 直近 30 日にネガティブなニュース（earnings miss + ガイダンス下方修正、訴訟、規制ショック等）がある銘柄は、ファンダが割安でも SELL / TRIM を優先する
- 直近に強いカタリストが出た銘柄は、高 PER でも HOLD / ADD を許容する
- **すべての thesis に少なくとも 1 つの URL ソースを付ける。** ソース無しの判定は不可
- ニュースが取得できなかった銘柄は Action=HOLD、Confidence=Low とし、thesis に「ニュース取得失敗、判定保留」と書く
- sanity-check 警告がある銘柄は、その警告内容を thesis の最上位根拠として引用する（無視しない）
- ポジション % は与えられた数値を使う。推測しない。15% 超なら必ずトリム検討
- TRIM / SELL の場合は \`trimPct\` (1-100) を必ず出す。実数値（株数・$ 金額）はコード側で計算する

**短期モメンタム反転ルール（厳守）:**
- 直近 1 週間 (1w return) が **-10% 以下** → ADD 推奨は禁止（thesis に「短期急落で買い増し見送り、tranche entry が必要」と書いて HOLD に格下げ）
- 直近 1 ヶ月 (1m return) が **-15% 以下** → ニュースで thesis 確認できなければ HOLD/Low
- 1w が -10% 以下 **かつ** ニュースで earnings miss / ガイダンス下方修正等の明確な悪材料があれば、TRIM/SELL を強化
- 1w が -10% 以下 **だが** ニュースは中立または好材料の場合は、HOLD でモメンタム回復を確認（ADD はしない）

**アナリスト PT 引上げの解釈（厳守）:**
- 大幅下落 (1w -10% 以下) の **直後** に PT 引上げが出ている場合、「分析家の擁護的反応」の可能性を疑う
- 単独のシグナルとせず、価格モメンタム・出来高・他の analyst の動きと合わせて判断する
- 「PT 引上げあり → 強気」とは即断しない`;

export interface HoldingInput {
  row: PortfolioRow;
  fundamentals: Fundamentals;
  news: NewsItem[];
  technicals: PriceMetrics;
  sanity?: SanityFlag;
  /** 現在価格（fundamentals.price か technicals.currentPrice、無ければ avgCost フォールバック） */
  currentPrice: number;
  /** quantity * currentPrice */
  positionValue: number;
  /** % of total portfolio (holdings + cash USD-equiv) */
  positionPct: number;
  /** (currentPrice - avgCost) / avgCost * 100 */
  pnlPct: number;
}

function fmt(v: number | null, mode: "raw" | "pct" | "money" = "raw"): string {
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

function formatHolding(h: HoldingInput): string {
  const lines: string[] = [];
  lines.push(`## ${h.row.ticker} (${h.row.account})`);
  lines.push(`- 保有: ${h.row.quantity} 株 @ avg $${fmt(h.row.avgCost)} ${h.row.currency} / 現在 $${fmt(h.currentPrice)}`);
  lines.push(`- **Position: $${fmt(h.positionValue)} (${h.positionPct.toFixed(1)}% of total portfolio) / P&L: ${h.pnlPct >= 0 ? "+" : ""}${h.pnlPct.toFixed(1)}%**`);
  lines.push(`- セクター: ${h.fundamentals.sector ?? "—"} / 業種: ${h.fundamentals.industry ?? "—"}`);
  lines.push(`- ファンダ: PER(trail/fwd)=${fmt(h.fundamentals.trailingPE)}/${fmt(h.fundamentals.forwardPE)}, PBR=${fmt(h.fundamentals.priceToBook)}, ROE=${fmt(h.fundamentals.returnOnEquity, "pct")}, 配当=${fmt(h.fundamentals.dividendYield, "pct")}, D/E=${fmt(h.fundamentals.debtToEquity)}, FCF=${fmt(h.fundamentals.freeCashFlow, "money")}`);
  lines.push(`- テクニカル: 1w=${fmt(h.technicals.return1w)}%, 1m=${fmt(h.technicals.return1m)}%, 3m=${fmt(h.technicals.return3m)}%, 6m=${fmt(h.technicals.return6m)}%, 12m=${fmt(h.technicals.return12m)}%, drawdown(12m高値)=${fmt(h.technicals.drawdownPct)}%`);
  const dropFlag1w = (h.technicals.return1w ?? 0) <= -10 ? " ⚠️ 1w 急落" : "";
  const dropFlag1m = (h.technicals.return1m ?? 0) <= -15 ? " ⚠️ 1m 軟調" : "";
  if (dropFlag1w || dropFlag1m) {
    lines.push(`- **短期モメンタム警告:${dropFlag1w}${dropFlag1m}** — ADD 禁止・tranche entry 必要`);
  }
  if (h.sanity && h.sanity.warnings.length > 0) {
    lines.push(`- 🚨 sanity-check 警告:`);
    h.sanity.warnings.forEach((w) => lines.push(`    - ${w}`));
  }
  if (h.news.length === 0) {
    lines.push(`- 直近ニュース: 取得できず`);
  } else {
    lines.push(`- 直近ニュース（${h.news.length} 件）:`);
    h.news.slice(0, 5).forEach((n) => {
      lines.push(`    - [${n.pubDate}] ${n.title} — ${n.link}`);
    });
  }
  return lines.join("\n");
}

export async function evaluateHoldings(inputs: HoldingInput[]): Promise<HoldingDecision[]> {
  if (inputs.length === 0) return [];

  const portfolioSection = inputs.map(formatHolding).join("\n\n");

  const userPrompt = `以下は現在の保有銘柄リストです。各銘柄について Hold / Trim / Sell / Add のいずれかを判定してください。

${portfolioSection}

**各銘柄について以下を判定:**

- \`action\`: "HOLD" | "TRIM" | "SELL" | "ADD"
- \`confidence\`: "High" | "Med" | "Low"
- \`thesis\`: なぜその action か。**直近ニュースを最上位根拠として引用**。Position % と P&L にも触れる。2-4 文
- \`sources\`: thesis の根拠となる URL を 1 つ以上（ニュース項目の link を使用、空配列は不可）
- \`trimPct\`: TRIM / SELL のときのみ整数 1-100（売却する % of current position）。HOLD / ADD なら null

**判定の優先順位（最優先 → 補助）:**
1. 直近 30 日のニュース・カタリスト
2. メタトレンド仮説（10 年単位の構造変化に乗る winner か）
3. テクニカル / 価格モメンタム
4. ファンダメンタル（成長率重視、PER は割高警告として）
5. sanity-check 警告（あれば必ず最上位根拠として参照）
6. Position 比率（15% 超なら TRIM 検討、極端な含み益銘柄も利確 TRIM 検討）

**TRIM 量の目安（aggressive growth profile）:**
- ニュース駆動の防衛的 TRIM: 30-40% 売却
- 過熱・利確 TRIM（含み益 +200% 超）: 25-33% 売却。ただしメタトレンド winner で仮説が維持されている場合は、単なる含み益だけで TRIM しない
- ポジション集中 TRIM（15% 超）: 15% に戻す比率を計算
- メタトレンド仮説が完全に壊れた → SELL（trimPct=100）

ニュースが 0 件の銘柄は action=HOLD, confidence=Low、thesis に「ニュース取得失敗、判定保留」と明記し、sources はファンダの参照として yahoo finance URL "https://finance.yahoo.com/quote/<ticker>" を使ってよい。

**出力は以下の JSON のみ**（コードフェンス・前置きなし）:
{
  "decisions": [
    {
      "ticker": "AAPL",
      "action": "HOLD",
      "confidence": "High",
      "thesis": "...",
      "sources": ["https://...", "https://..."],
      "trimPct": null
    }
  ]
}`;

  const raw = await callClaude(
    [{ role: "user", content: userPrompt }],
    { system: SYSTEM, maxTurns: 1, model: "claude-opus-4-7", maxTokens: 8192 },
  );

  const parsed = extractJson(raw) as {
    decisions: Array<{
      ticker: string;
      action: RebalanceAction;
      confidence: "High" | "Med" | "Low";
      thesis: string;
      sources: string[];
      trimPct?: number | null;
    }>;
  };

  if (!parsed.decisions || !Array.isArray(parsed.decisions)) {
    throw new Error(`evaluate-holdings: invalid JSON from Claude:\n${raw}`);
  }

  const inputMap = new Map(inputs.map((h) => [h.row.ticker.toUpperCase(), h]));
  return parsed.decisions
    .map((d): HoldingDecision | null => {
      const h = inputMap.get(d.ticker.toUpperCase());
      if (!h) return null;
      if (!d.sources || d.sources.length === 0) {
        console.warn(`[evaluate-holdings] ${d.ticker}: no sources, marking confidence Low`);
        d.sources = [`https://finance.yahoo.com/quote/${d.ticker}`];
      }

      // Compute trim shares / amount from trimPct
      const isReducing = d.action === "TRIM" || d.action === "SELL";
      const trimPct = isReducing ? (d.trimPct ?? (d.action === "SELL" ? 100 : 30)) : null;
      const trimShares = trimPct !== null ? +(h.row.quantity * (trimPct / 100)).toFixed(4) : null;
      const trimAmount = trimPct !== null ? +(h.positionValue * (trimPct / 100)).toFixed(2) : null;

      return {
        ticker: h.row.ticker,
        account: h.row.account,
        quantity: h.row.quantity,
        avgCost: h.row.avgCost,
        currency: h.row.currency,
        action: d.action,
        confidence: d.confidence,
        thesis: d.thesis,
        recentNews: h.news.slice(0, 3),
        sources: d.sources,
        technicals: {
          dayChange: h.technicals.dayChange,
          peakToNow5d: h.technicals.peakToNow5d,
          return1w: h.technicals.return1w,
          return1m: h.technicals.return1m,
          return3m: h.technicals.return3m,
          return6m: h.technicals.return6m,
          return12m: h.technicals.return12m,
          drawdownPct: h.technicals.drawdownPct,
        },
        fundamentals: h.fundamentals,
        sanity: h.sanity,
        currentPrice: h.currentPrice,
        positionValue: h.positionValue,
        positionPct: h.positionPct,
        pnlPct: h.pnlPct,
        trimPct,
        trimShares,
        trimAmount,
      };
    })
    .filter((d): d is HoldingDecision => d !== null);
}
