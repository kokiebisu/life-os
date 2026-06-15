/**
 * Investment aspect — 型定義
 */

export interface FeedConfig {
  name: string;
  url: string;
  category: string;
  lang?: "ja" | "en";
}

export interface NewsItem {
  source: string;
  category: string;
  lang: "ja" | "en";
  title: string;
  link: string;
  pubDate: string;
  summary: string;
}

export interface Theme {
  title: string;
  reasoning: string;
  primarySourceLink: string;
  category: "株" | "仮想通貨セクター" | "その他";
}

export interface Candidate {
  ticker: string;
  name: string;
  rationale: string;
}

export interface Fundamentals {
  ticker: string;
  name: string;
  currency: string;
  price: number | null;
  marketCap: number | null;
  trailingPE: number | null;
  forwardPE: number | null;
  priceToBook: number | null;
  returnOnEquity: number | null;
  dividendYield: number | null;
  debtToEquity: number | null;
  freeCashFlow: number | null;
  fiftyTwoWeekLow: number | null;
  fiftyTwoWeekHigh: number | null;
  sector: string | null;
  industry: string | null;
  fetchError?: string;
}

export interface SanityFlag {
  ticker: string;
  drawdownPct: number;     // 180d 高値からの下落率（負値）
  pct5d: number;           // 直近 5 営業日の変化率
  pct30d: number;          // 直近 22 営業日（約 30 日）の変化率
  maxVolumeRatio: number;  // 直近 30 日内の最大出来高 / 30 日平均
  high180: number;
  currentPrice: number;
  warnings: string[];      // 閾値超えの警告メッセージ。空なら問題なし
}

export interface ValuePick {
  ticker: string;
  name: string;
  thesis: string;
  catalysts: string[];
  risks: string[];
  fundamentals: Fundamentals;
  sanity?: SanityFlag;
}

export interface Analysis {
  date: string;
  theme: Theme;
  newsSummary: string;
  picks: ValuePick[];
  overallRisks: string[];
}

// ============================================================
// Rebalance domain types
// ============================================================

export interface CashRow {
  currency: "USD" | "CAD";
  amount: number;
  updatedOn: string; // YYYY-MM-DD
}

export interface PortfolioRow {
  ticker: string;
  quantity: number;
  avgCost: number;
  currency: "USD" | "CAD";
  account: "TFSA" | "RRSP" | "Non-Registered" | "FHSA";
  acquiredOn: string;
  note: string;
}

export interface DiscoveryCandidate {
  ticker: string;
  thesis: string;
  confidence: "High" | "Med" | "Low";
  recentNews: { date: string; headline: string; url: string }[];
  sources: string[];
  strategy: string; // file name without date/ext, e.g. "growth"
  generatedAt: string; // ISO
  // Optional fields from investor-drill
  bucket?: "Edge Core" | "Edge Lottery" | "Diversifier Growth" | "Defensive Value";
  entryNote?: string; // e.g. "調整待ち。$60以下で買い" or "今すぐエントリー可能"
}

export interface TickerNews {
  ticker: string;
  items: NewsItem[]; // filtered by ticker keyword
}

export type RebalanceAction = "BUY" | "ADD" | "HOLD" | "TRIM" | "SELL" | "SKIP";

export interface HoldingDecision {
  ticker: string;
  account: PortfolioRow["account"];
  quantity: number;
  avgCost: number;
  currency: PortfolioRow["currency"];
  action: RebalanceAction;
  confidence: "High" | "Med" | "Low";
  thesis: string;
  recentNews: NewsItem[]; // top 1-3, kept for report rendering
  sources: string[]; // at least 1 URL
  technicals: {
    dayChange: number | null;
    peakToNow5d: number | null;
    return1w: number | null;
    return1m: number | null;
    return3m: number | null;
    return6m: number | null;
    return12m: number | null;
    drawdownPct: number | null;
  };
  fundamentals: Fundamentals;
  sanity?: SanityFlag;
  // Position context (filled by orchestrator before evaluate-holdings)
  currentPrice: number | null;
  positionValue: number; // qty * price (or qty * avgCost as fallback)
  positionPct: number; // % of total portfolio (holdings + cash USD-equiv)
  pnlPct: number; // (price - avgCost) / avgCost * 100
  // TRIM / SELL only: how much to reduce (null otherwise)
  trimPct?: number | null;       // 0-100, what % of current position to sell
  trimShares?: number | null;    // suggested share count to sell
  trimAmount?: number | null;    // suggested $ amount to sell
}

export interface BuyDecision {
  ticker: string;
  source: "existing-holding" | string; // "existing-holding" for ADD, strategy name for BUY
  action: "BUY" | "ADD";
  amount: number;
  currency: "USD" | "CAD";
  confidence: "High" | "Med" | "Low";
  thesis: string;
  recentNews: NewsItem[] | { date: string; headline: string; url: string }[];
  sources: string[];
  // Optional context filled by allocate-cash
  currentPrice?: number | null;
  technicals?: {
    return1w: number | null;
    return1m: number | null;
    return3m: number | null;
    return6m: number | null;
    return12m: number | null;
    drawdownPct: number | null;
  };
  trancheRecommended?: boolean; // true when recent 1w sharp drop suggests split entry
}

export interface PortfolioHealth {
  totalValueUSD: number;
  totalValueCAD: number;
  sectorBreakdown: { sector: string; pct: number }[];
  currencyBreakdown: { currency: string; pct: number }[];
  accountBreakdown: { account: string; pct: number }[];
}

export interface RebalanceReport {
  date: string;
  cash: CashRow[];
  cashStale: boolean; // updated_on > 30 days ago
  holdings: PortfolioRow[];
  portfolioHealth: PortfolioHealth;
  holdingDecisions: HoldingDecision[];
  buyDecisions: BuyDecision[];
  candidatesUsed: DiscoveryCandidate[];
  cashRemainder: { currency: "USD" | "CAD"; amount: number }[];
}
