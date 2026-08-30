#!/usr/bin/env bun
/**
 * import-monthly-statement — Wealthsimple monthly statement CSV から
 * portfolio.csv (数量 delta) と cash.csv (期末残高) を同期する。
 *
 * 使い方:
 *   bun run scripts/investment/import-monthly-statement.ts \
 *     --monthly <path/to/monthly-statement-transactions.csv> [--dry-run]
 *
 * 同期内容:
 *   - portfolio.csv: BUY/SELL を quantity delta として加算。BUY は avg_cost を加重平均で再計算
 *   - cash.csv: ファイル内の last balance per currency をそのまま採用
 *
 * 重複適用防止:
 *   - 処理済み statement の period_end (= ファイル内最大日付) を
 *     aspects/investment/.last-import.json に記録
 *   - period_end <= 記録済み last_period_end の statement はスキップ
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

type Tx = {
  date: string;
  type: string;
  ticker: string;
  qty: number;
  price: number;
  amount: number;
  balance: number;
  currency: string;
};

function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const fields: string[] = [];
    let cur = "";
    let inQuote = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') inQuote = !inQuote;
      else if (ch === "," && !inQuote) {
        fields.push(cur);
        cur = "";
      } else cur += ch;
    }
    fields.push(cur);
    if (fields.length > 1) rows.push(fields);
  }
  return rows;
}

const TRADE_RE = /^([A-Z][A-Z0-9.]*)\s*-\s*[^:]+:\s*(Bought|Sold)\s+(\d+(?:\.\d+)?)\s+shares?\s+at\s+\$(\d+(?:\.\d+)?)/i;

function parseStatement(path: string): Tx[] {
  const rows = parseCsvRows(readFileSync(path, "utf-8"));
  if (rows.length < 2) throw new Error(`statement CSV: no data rows (${path})`);
  const header = rows[0].map((h) => h.toLowerCase());
  const idx = (name: string) => {
    const i = header.indexOf(name);
    if (i < 0) throw new Error(`statement CSV: column "${name}" not found. Got: ${header.join("|")}`);
    return i;
  };
  const iDate = idx("date");
  const iTx = idx("transaction");
  const iDesc = idx("description");
  const iAmt = idx("amount");
  const iBal = idx("balance");
  const iCcy = idx("currency");

  const out: Tx[] = [];
  for (const r of rows.slice(1)) {
    const date = r[iDate]?.trim();
    if (!date) continue;
    const type = r[iTx]?.trim() ?? "";
    const desc = r[iDesc]?.trim() ?? "";
    const amount = parseFloat(r[iAmt]) || 0;
    const balance = parseFloat(r[iBal]) || 0;
    const currency = r[iCcy]?.trim() ?? "";

    let ticker = "";
    let qty = 0;
    let price = 0;
    if (type === "BUY" || type === "SELL") {
      const m = desc.match(TRADE_RE);
      if (!m) {
        console.error(`⚠️  ${date} ${type}: description をパースできず: ${desc}`);
        continue;
      }
      ticker = m[1];
      qty = parseFloat(m[3]);
      price = parseFloat(m[4]);
    }

    out.push({ date, type, ticker, qty, price, amount, balance, currency });
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

function applyTrades(portfolio: PortfolioRow[], txs: Tx[]): { portfolio: PortfolioRow[]; changes: string[] } {
  const map = new Map(portfolio.map((p) => [p.ticker, { ...p }]));
  const changes: string[] = [];
  const defaultCurrency = portfolio[0]?.currency ?? "USD";
  const defaultAccount = portfolio[0]?.account ?? "TFSA";

  for (const tx of txs) {
    if (tx.type !== "BUY" && tx.type !== "SELL") continue;
    const existing = map.get(tx.ticker);
    if (tx.type === "BUY") {
      if (!existing) {
        map.set(tx.ticker, {
          ticker: tx.ticker,
          quantity: tx.qty,
          avgCost: tx.price,
          currency: tx.currency || defaultCurrency,
          account: defaultAccount,
          acquiredOn: tx.date,
          note: "",
        });
        changes.push(`  + NEW ${tx.ticker}: qty=${tx.qty} @ $${tx.price} (${tx.date})`);
      } else {
        const newQty = existing.quantity + tx.qty;
        const newAvg = newQty > 0 ? (existing.quantity * existing.avgCost + tx.qty * tx.price) / newQty : 0;
        changes.push(
          `  + BUY ${tx.ticker}: qty ${existing.quantity} → ${newQty.toFixed(4)}, avg $${existing.avgCost.toFixed(2)} → $${newAvg.toFixed(2)} (${tx.date})`,
        );
        existing.quantity = newQty;
        existing.avgCost = newAvg;
      }
    } else {
      if (!existing) {
        console.error(`⚠️  ${tx.date} SELL ${tx.ticker}: portfolio.csv に存在しない ticker。スキップ`);
        continue;
      }
      const newQty = existing.quantity - tx.qty;
      changes.push(
        `  - SELL ${tx.ticker}: qty ${existing.quantity} → ${newQty.toFixed(4)} (avg保持 $${existing.avgCost.toFixed(2)}, ${tx.date})`,
      );
      existing.quantity = newQty;
      if (newQty <= 0.0001) {
        changes.push(`  🗑  ${tx.ticker}: quantity 0 → portfolio から除外`);
        map.delete(tx.ticker);
      }
    }
  }

  return { portfolio: [...map.values()], changes };
}

function lastBalancePerCurrency(txs: Tx[]): Map<string, { amount: number; date: string }> {
  const out = new Map<string, { amount: number; date: string }>();
  for (const tx of txs) {
    if (!tx.currency) continue;
    out.set(tx.currency, { amount: tx.balance, date: tx.date });
  }
  return out;
}

function writePortfolio(portfolio: PortfolioRow[]) {
  const lines = ["ticker,quantity,avg_cost,currency,account,acquired_on,note"];
  const sorted = [...portfolio].sort((a, b) => a.ticker.localeCompare(b.ticker));
  for (const p of sorted) {
    lines.push(
      [p.ticker, p.quantity, p.avgCost.toFixed(2), p.currency, p.account, p.acquiredOn, p.note].join(","),
    );
  }
  writeFileSync(PORTFOLIO_PATH, lines.join("\n") + "\n");
}

function writeCash(existing: CashRow[], updates: Map<string, { amount: number; date: string }>) {
  const today = todayJST();
  const map = new Map(existing.map((r) => [r.currency, r]));
  for (const [ccy, { amount }] of updates) {
    map.set(ccy, { currency: ccy, amount: String(amount), updatedOn: today });
  }
  const lines = ["currency,amount,updated_on"];
  for (const r of map.values()) lines.push(`${r.currency},${r.amount},${r.updatedOn}`);
  writeFileSync(CASH_PATH, lines.join("\n") + "\n");
}

function writeState(periodEnd: string, fileName: string, prev: { files_processed: string[] }) {
  const state = {
    last_period_end: periodEnd,
    last_imported_at: new Date(Date.now() + 9 * 3600 * 1000).toISOString().replace("Z", "+09:00"),
    files_processed: [...prev.files_processed, fileName].slice(-20),
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
const monthlyPath = get("--monthly");

if (!monthlyPath) {
  console.error(
    "Usage: bun run scripts/investment/import-monthly-statement.ts --monthly <path> [--dry-run]",
  );
  process.exit(1);
}

console.error(`📥 monthly statement 解析中: ${monthlyPath}`);
const txs = parseStatement(monthlyPath);
const trades = txs.filter((t) => t.type === "BUY" || t.type === "SELL");
const periodEnd = txs.reduce((acc, t) => (t.date > acc ? t.date : acc), "");
const periodStart = txs.reduce((acc, t) => (acc === "" || t.date < acc ? t.date : acc), "");
console.error(`  → 期間: ${periodStart} 〜 ${periodEnd}`);
console.error(`  → 取引: BUY ${trades.filter((t) => t.type === "BUY").length} / SELL ${trades.filter((t) => t.type === "SELL").length}`);

// period check
const state = loadState();
if (state.last_period_end && periodEnd <= state.last_period_end) {
  console.error(
    `🚫 SKIP: この statement の period_end (${periodEnd}) は last_period_end (${state.last_period_end}) 以前。重複適用を防ぐためスキップします。`,
  );
  console.error(`  → より新しい monthly statement を渡してください。`);
  process.exit(0);
}

// dry-run / apply
const portfolio = loadPortfolio(PORTFOLIO_PATH);
const cash = loadCash(CASH_PATH);

const { portfolio: newPortfolio, changes } = applyTrades(portfolio, trades);
const cashUpdates = lastBalancePerCurrency(txs);

console.error(`\n--- portfolio.csv 変更プレビュー ---`);
if (changes.length === 0) console.error("  (変更なし)");
else for (const c of changes) console.error(c);

console.error(`\n--- cash.csv 更新プレビュー (期末残高) ---`);
for (const [ccy, { amount, date }] of cashUpdates) {
  const before = cash.find((c) => c.currency === ccy);
  const beforeStr = before ? `${before.amount} (${before.updatedOn})` : "なし";
  console.error(`  ${ccy}: ${beforeStr}  →  ${amount} (${date})`);
}

console.error(`\n--- state ---`);
console.error(`  last_period_end: ${state.last_period_end ?? "(未記録)"} → ${periodEnd}`);

if (dryRun) {
  console.error(`\n✓ dry-run 完了。実際に書き込むには --dry-run を外して再実行してください。`);
  process.exit(0);
}

writePortfolio(newPortfolio);
console.error(`\n✓ portfolio.csv 更新完了 → ${PORTFOLIO_PATH}`);
writeCash(cash, cashUpdates);
console.error(`✓ cash.csv 更新完了 → ${CASH_PATH}`);
const fileName = monthlyPath.split("/").pop() ?? monthlyPath;
writeState(periodEnd, fileName, state);
console.error(`✓ state 更新完了 → ${STATE_PATH}`);
