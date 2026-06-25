#!/usr/bin/env bun
/**
 * import-wealthsimple-export — Wealthsimple Activities Export + Holdings Report から
 * portfolio.csv と cash.csv を同期する。
 *
 * 使い方:
 *   bun run scripts/investment/import-wealthsimple-export.ts \
 *     --activities <path/to/activities-export-YYYY-MM-DD.csv> \
 *     --holdings <path/to/holdings-report-YYYY-MM-DD.csv> [--dry-run]
 *
 * 同期内容:
 *   - portfolio.csv: holdings-report を source of truth として全置換。
 *                    quantity = Quantity、avg_cost = Book Value (Market) / Quantity。
 *                    acquired_on は既存値を保持（新規 ticker は activities の最古 BUY 日）。
 *   - cash.csv: 既存 cash の updated_on 以降の net_cash_amount 合計を delta として加算。
 *               未知 currency は activities 合計から新規追加。
 *
 * 重複適用防止:
 *   - 処理済み activities の latest_transaction_date を
 *     aspects/investment/.last-import.json に記録
 *   - latest_transaction_date <= 記録済み last_period_end の場合はスキップ
 */

import { readFileSync, writeFileSync, existsSync } from "fs";

const PORTFOLIO_PATH = "aspects/investment/portfolio.csv";
const CASH_PATH = "aspects/investment/cash.csv";
const STATE_PATH = "aspects/investment/.last-import.json";

type CashRow = { currency: string; amount: string; updatedOn: string };
type PortfolioRow = {
  ticker: string;
  quantity: number;
  avgCost: number;
  currency: string;
  account: string;
  acquiredOn: string;
  note: string;
};

type Activity = {
  date: string;
  settlement: string;
  activityType: string;
  subType: string;
  symbol: string;
  currency: string;
  quantity: number;
  unitPrice: number;
  netCash: number;
};

type Holding = {
  ticker: string;
  account: string;
  quantity: number;
  bookValueMarket: number;
  bookValueCurrency: string;
  marketPrice: number;
  marketPriceCurrency: string;
};

function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trimEnd();
    if (!line) continue;
    const fields: string[] = [];
    let cur = "";
    let inQuote = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuote && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuote = !inQuote;
        }
      } else if (ch === "," && !inQuote) {
        fields.push(cur);
        cur = "";
      } else cur += ch;
    }
    fields.push(cur);
    if (fields.length > 1) rows.push(fields);
  }
  return rows;
}

function parseActivities(path: string): Activity[] {
  const rows = parseCsvRows(readFileSync(path, "utf-8"));
  if (rows.length < 2) throw new Error(`activities CSV: no data rows (${path})`);
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const idx = (name: string) => {
    const i = header.indexOf(name);
    if (i < 0) throw new Error(`activities CSV: column "${name}" not found. Got: ${header.join("|")}`);
    return i;
  };
  const iDate = idx("transaction_date");
  const iSettle = idx("settlement_date");
  const iType = idx("activity_type");
  const iSub = idx("activity_sub_type");
  const iSymbol = idx("symbol");
  const iCcy = idx("currency");
  const iQty = idx("quantity");
  const iPrice = idx("unit_price");
  const iNet = idx("net_cash_amount");

  const out: Activity[] = [];
  for (const r of rows.slice(1)) {
    const date = r[iDate]?.trim();
    if (!date) continue;
    // Footer line ("As of ..."): skip rows without proper date
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    out.push({
      date,
      settlement: r[iSettle]?.trim() ?? "",
      activityType: r[iType]?.trim() ?? "",
      subType: r[iSub]?.trim() ?? "",
      symbol: r[iSymbol]?.trim() ?? "",
      currency: r[iCcy]?.trim() ?? "",
      quantity: parseFloat(r[iQty] ?? "0") || 0,
      unitPrice: parseFloat(r[iPrice] ?? "0") || 0,
      netCash: parseFloat(r[iNet] ?? "0") || 0,
    });
  }
  return out;
}

function parseHoldings(path: string): Holding[] {
  const rows = parseCsvRows(readFileSync(path, "utf-8"));
  if (rows.length < 2) throw new Error(`holdings CSV: no data rows (${path})`);
  const header = rows[0].map((h) => h.trim());
  const idx = (name: string) => {
    const i = header.indexOf(name);
    if (i < 0) throw new Error(`holdings CSV: column "${name}" not found. Got: ${header.join("|")}`);
    return i;
  };
  const iAccount = idx("Account Type");
  const iSymbol = idx("Symbol");
  const iQty = idx("Quantity");
  const iBV = idx("Book Value (Market)");
  const iBVCcy = idx("Book Value Currency (Market)");
  const iPrice = idx("Market Price");
  const iPriceCcy = idx("Market Price Currency");

  const out: Holding[] = [];
  for (const r of rows.slice(1)) {
    const sym = r[iSymbol]?.trim();
    if (!sym) continue;
    // Footer line: skip rows without symbol
    if (!/^[A-Z][A-Z0-9.-]*$/.test(sym)) continue;
    const qty = parseFloat(r[iQty] ?? "0") || 0;
    if (qty === 0) continue;
    out.push({
      ticker: sym,
      account: r[iAccount]?.trim() ?? "TFSA",
      quantity: qty,
      bookValueMarket: parseFloat(r[iBV] ?? "0") || 0,
      bookValueCurrency: r[iBVCcy]?.trim() ?? "USD",
      marketPrice: parseFloat(r[iPrice] ?? "0") || 0,
      marketPriceCurrency: r[iPriceCcy]?.trim() ?? "USD",
    });
  }
  return out;
}

function loadPortfolio(path: string): PortfolioRow[] {
  if (!existsSync(path)) return [];
  const rows = parseCsvRows(readFileSync(path, "utf-8"));
  if (rows.length < 2) return [];
  const header = rows[0];
  const idx = (name: string) => header.indexOf(name);
  return rows.slice(1).map((r) => ({
    ticker: r[idx("ticker")]?.trim() ?? "",
    quantity: parseFloat(r[idx("quantity")] ?? "0") || 0,
    avgCost: parseFloat(r[idx("avg_cost")] ?? "0") || 0,
    currency: r[idx("currency")]?.trim() ?? "USD",
    account: r[idx("account")]?.trim() ?? "TFSA",
    acquiredOn: r[idx("acquired_on")]?.trim() ?? "",
    note: r[idx("note")]?.trim() ?? "",
  }));
}

function loadCash(path: string): CashRow[] {
  if (!existsSync(path)) return [];
  const rows = parseCsvRows(readFileSync(path, "utf-8"));
  if (rows.length < 2) return [];
  const header = rows[0];
  return rows.slice(1).map((r) => ({
    currency: r[header.indexOf("currency")]?.trim() ?? "",
    amount: r[header.indexOf("amount")]?.trim() ?? "0",
    updatedOn: r[header.indexOf("updated_on")]?.trim() ?? "",
  }));
}

function loadState(): { last_period_end: string | null; files_processed: string[] } {
  if (!existsSync(STATE_PATH)) return { last_period_end: null, files_processed: [] };
  try {
    const j = JSON.parse(readFileSync(STATE_PATH, "utf-8"));
    return {
      last_period_end: j.last_period_end ?? null,
      files_processed: Array.isArray(j.files_processed) ? j.files_processed : [],
    };
  } catch {
    return { last_period_end: null, files_processed: [] };
  }
}

function todayJST(): string {
  const now = new Date();
  return new Date(now.getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

function buildPortfolio(
  holdings: Holding[],
  prev: PortfolioRow[],
  activities: Activity[],
): { rows: PortfolioRow[]; changes: string[] } {
  const prevMap = new Map(prev.map((p) => [p.ticker, p]));
  const firstBuyDate = new Map<string, string>();
  for (const a of activities) {
    if (a.activityType === "Trade" && a.subType === "BUY" && a.symbol) {
      const cur = firstBuyDate.get(a.symbol);
      if (!cur || a.date < cur) firstBuyDate.set(a.symbol, a.date);
    }
  }

  const changes: string[] = [];
  const rows: PortfolioRow[] = [];
  for (const h of holdings) {
    const avgCost = h.quantity > 0 ? h.bookValueMarket / h.quantity : 0;
    const prevRow = prevMap.get(h.ticker);
    const acquiredOn = prevRow?.acquiredOn ?? firstBuyDate.get(h.ticker) ?? todayJST();
    const note = prevRow?.note ?? "";
    const row: PortfolioRow = {
      ticker: h.ticker,
      quantity: h.quantity,
      avgCost,
      currency: h.bookValueCurrency || "USD",
      account: h.account || "TFSA",
      acquiredOn,
      note,
    };
    rows.push(row);

    if (!prevRow) {
      changes.push(`  + NEW ${h.ticker}: qty=${h.quantity} @ $${avgCost.toFixed(2)} (acquired ${acquiredOn})`);
    } else {
      const qtyDiff = h.quantity - prevRow.quantity;
      const avgDiff = avgCost - prevRow.avgCost;
      if (Math.abs(qtyDiff) > 0.0001 || Math.abs(avgDiff) > 0.005) {
        changes.push(
          `  ~ ${h.ticker}: qty ${prevRow.quantity} → ${h.quantity}, avg $${prevRow.avgCost.toFixed(2)} → $${avgCost.toFixed(2)}`,
        );
      }
    }
  }

  // Detect removed tickers
  const holdingTickers = new Set(holdings.map((h) => h.ticker));
  for (const p of prev) {
    if (!holdingTickers.has(p.ticker)) {
      changes.push(`  🗑  ${p.ticker}: holdings に存在しない → portfolio から除外 (was qty=${p.quantity})`);
    }
  }

  return { rows, changes };
}

function deltaCashFromActivities(
  activities: Activity[],
  cash: CashRow[],
): { deltas: Map<string, number>; newBalances: Map<string, number>; anchor: string } {
  // Anchor date: max updated_on across all cash rows. Activities with date > anchor are added.
  const anchor = cash.reduce((acc, c) => (c.updatedOn > acc ? c.updatedOn : acc), "");
  const deltas = new Map<string, number>();
  for (const a of activities) {
    if (anchor && a.date <= anchor) continue;
    if (!a.currency || a.netCash === 0) continue;
    deltas.set(a.currency, (deltas.get(a.currency) ?? 0) + a.netCash);
  }

  const newBalances = new Map<string, number>();
  const cashMap = new Map(cash.map((c) => [c.currency, parseFloat(c.amount) || 0]));
  const allCcy = new Set([...cashMap.keys(), ...deltas.keys()]);
  for (const ccy of allCcy) {
    const base = cashMap.get(ccy) ?? 0;
    const delta = deltas.get(ccy) ?? 0;
    newBalances.set(ccy, base + delta);
  }
  return { deltas, newBalances, anchor };
}

function writePortfolio(rows: PortfolioRow[]) {
  const lines = ["ticker,quantity,avg_cost,currency,account,acquired_on,note"];
  const sorted = [...rows].sort((a, b) => a.ticker.localeCompare(b.ticker));
  for (const p of sorted) {
    lines.push(
      [p.ticker, p.quantity, p.avgCost.toFixed(2), p.currency, p.account, p.acquiredOn, p.note].join(","),
    );
  }
  writeFileSync(PORTFOLIO_PATH, lines.join("\n") + "\n");
}

function writeCash(newBalances: Map<string, number>) {
  const today = todayJST();
  const lines = ["currency,amount,updated_on"];
  for (const [ccy, amount] of newBalances) {
    lines.push(`${ccy},${amount.toFixed(2)},${today}`);
  }
  writeFileSync(CASH_PATH, lines.join("\n") + "\n");
}

function writeState(latestTx: string, fileNames: string[], prev: { files_processed: string[] }) {
  const state = {
    last_period_end: latestTx,
    last_imported_at: new Date(Date.now() + 9 * 3600 * 1000).toISOString().replace("Z", "+09:00"),
    files_processed: [...prev.files_processed, ...fileNames].slice(-20),
  };
  writeFileSync(STATE_PATH, JSON.stringify(state, null, 2) + "\n");
}

// --- main ---
const args = process.argv.slice(2);
const get = (flag: string) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : null;
};
const dryRun = args.includes("--dry-run");
const skipCash = args.includes("--skip-cash");
const activitiesPath = get("--activities");
const holdingsPath = get("--holdings");

if (!activitiesPath || !holdingsPath) {
  console.error(
    "Usage: bun run scripts/investment/import-wealthsimple-export.ts --activities <path> --holdings <path> [--dry-run] [--skip-cash]",
  );
  process.exit(1);
}

console.error(`📥 activities 解析中: ${activitiesPath}`);
const activities = parseActivities(activitiesPath);
const trades = activities.filter((a) => a.activityType === "Trade");
const latestTx = activities.reduce((acc, a) => (a.date > acc ? a.date : acc), "");
const earliestTx = activities.reduce((acc, a) => (acc === "" || a.date < acc ? a.date : acc), "");
console.error(`  → 期間: ${earliestTx} 〜 ${latestTx}`);
console.error(
  `  → 取引: BUY ${trades.filter((t) => t.subType === "BUY").length} / SELL ${trades.filter((t) => t.subType === "SELL").length}`,
);
console.error(
  `  → その他: Dividend ${activities.filter((a) => a.activityType === "Dividend").length} / Interest ${activities.filter((a) => a.activityType === "Interest").length} / Fee ${activities.filter((a) => a.activityType === "Fee").length} / MoneyMovement ${activities.filter((a) => a.activityType === "MoneyMovement").length}`,
);

console.error(`\n📥 holdings 解析中: ${holdingsPath}`);
const holdings = parseHoldings(holdingsPath);
console.error(`  → 保有銘柄: ${holdings.length}`);

// period check
const state = loadState();
if (state.last_period_end && latestTx <= state.last_period_end) {
  console.error(
    `🚫 SKIP: 最新 transaction_date (${latestTx}) は last_period_end (${state.last_period_end}) 以前。重複適用を防ぐためスキップします。`,
  );
  console.error(`  → より新しい activities export を渡してください。`);
  process.exit(0);
}

// build
const prevPortfolio = loadPortfolio(PORTFOLIO_PATH);
const cash = loadCash(CASH_PATH);

const { rows: newPortfolio, changes } = buildPortfolio(holdings, prevPortfolio, activities);
const { deltas, newBalances, anchor } = deltaCashFromActivities(activities, cash);

console.error(`\n--- portfolio.csv 変更プレビュー ---`);
if (changes.length === 0) console.error("  (変更なし)");
else for (const c of changes) console.error(c);

console.error(`\n--- cash.csv 更新プレビュー ---`);
console.error(`  anchor (cash.csv の最新 updated_on): ${anchor || "(未記録 = 全 activities を集計)"}`);
const cashMap = new Map(cash.map((c) => [c.currency, c.amount]));
for (const [ccy, newAmt] of newBalances) {
  const before = cashMap.get(ccy) ?? "なし";
  const delta = deltas.get(ccy) ?? 0;
  console.error(`  ${ccy}: ${before}  +  delta ${delta.toFixed(2)}  =  ${newAmt.toFixed(2)}`);
}

console.error(`\n--- state ---`);
console.error(`  last_period_end: ${state.last_period_end ?? "(未記録)"} → ${latestTx}`);

if (dryRun) {
  console.error(`\n✓ dry-run 完了。実際に書き込むには --dry-run を外して再実行してください。`);
  process.exit(0);
}

writePortfolio(newPortfolio);
console.error(`\n✓ portfolio.csv 更新完了 → ${PORTFOLIO_PATH}`);
if (skipCash) {
  console.error(`⏭  cash.csv はスキップ（--skip-cash）`);
} else {
  writeCash(newBalances);
  console.error(`✓ cash.csv 更新完了 → ${CASH_PATH}`);
}
const fileNames = [activitiesPath, holdingsPath].map((p) => p.split("/").pop() ?? p);
writeState(latestTx, fileNames, state);
console.error(`✓ state 更新完了 → ${STATE_PATH}`);
