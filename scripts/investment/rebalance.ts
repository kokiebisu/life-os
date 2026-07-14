#!/usr/bin/env bun
/**
 * Portfolio Rebalance — オーケストレーター
 *
 * 使い方:
 *   bun run scripts/investment/rebalance.ts            # 本番（Notion 登録 + md 保存）
 *   bun run scripts/investment/rebalance.ts --dry-run  # Notion 登録せず stdout
 *   bun run scripts/investment/rebalance.ts --only-sanity
 *   bun run scripts/investment/rebalance.ts --only-holdings
 *   bun run scripts/investment/rebalance.ts --candidates aspects/investment/candidates/<file>.json
 *   bun run scripts/investment/rebalance.ts --cash-file /tmp/test-cash.csv
 */

import { loadContext } from "./load-context";
import { fetchTickerNews, deriveAliases } from "./fetch-ticker-news";
import { fetchFundamentals } from "./fetch-fundamentals";
import { fetchPriceHistory } from "./fetch-price-history";
import { sanityCheck, formatSanityLine } from "./sanity-check";
import { evaluateHoldings } from "./evaluate-holdings";
import { allocateCash } from "./allocate-cash";
import { writeRebalanceReport, renderRebalanceMarkdown } from "./write-rebalance-report";
import { registerRebalanceNotion } from "./register-rebalance-notion";
import type {
  PortfolioRow,
  Candidate,
  RebalanceReport,
  PortfolioHealth,
  NewsItem,
} from "./types";

function todayJST(): string {
  const now = new Date();
  const jst = new Date(now.getTime() + 9 * 3600 * 1000);
  return jst.toISOString().slice(0, 10);
}

interface Args {
  dryRun: boolean;
  only: "sanity" | "holdings" | null;
  candidates: string | null;
  cashFile: string | null;
}

function parseArgs(): Args {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  let only: Args["only"] = null;
  if (args.includes("--only-sanity")) only = "sanity";
  else if (args.includes("--only-holdings")) only = "holdings";
  const candIdx = args.indexOf("--candidates");
  const cashIdx = args.indexOf("--cash-file");
  return {
    dryRun,
    only,
    candidates: candIdx >= 0 ? args[candIdx + 1] : null,
    cashFile: cashIdx >= 0 ? args[cashIdx + 1] : null,
  };
}

function computePortfolioHealth(
  portfolio: PortfolioRow[],
  fundamentalsMap: Map<string, { sector: string | null; currency: string }>,
  priceMap: Map<string, number | null>,
): PortfolioHealth {
  let totalUSD = 0;
  let totalCAD = 0;
  const sectorVals = new Map<string, number>();
  const ccyVals = new Map<string, number>();
  const acctVals = new Map<string, number>();

  for (const row of portfolio) {
    const price = priceMap.get(row.ticker.toUpperCase()) ?? row.avgCost;
    const value = row.quantity * (price ?? row.avgCost);
    if (row.currency === "USD") totalUSD += value;
    if (row.currency === "CAD") totalCAD += value;
    const fund = fundamentalsMap.get(row.ticker.toUpperCase());
    const sector = fund?.sector ?? "Unknown";
    sectorVals.set(sector, (sectorVals.get(sector) ?? 0) + value);
    ccyVals.set(row.currency, (ccyVals.get(row.currency) ?? 0) + value);
    acctVals.set(row.account, (acctVals.get(row.account) ?? 0) + value);
  }
  const totalAll = totalUSD + totalCAD;

  return {
    totalValueUSD: totalUSD,
    totalValueCAD: totalCAD,
    sectorBreakdown: [...sectorVals.entries()]
      .map(([sector, v]) => ({ sector, pct: totalAll > 0 ? (v / totalAll) * 100 : 0 }))
      .sort((a, b) => b.pct - a.pct),
    currencyBreakdown: [...ccyVals.entries()]
      .map(([currency, v]) => ({ currency, pct: totalAll > 0 ? (v / totalAll) * 100 : 0 })),
    accountBreakdown: [...acctVals.entries()]
      .map(([account, v]) => ({ account, pct: totalAll > 0 ? (v / totalAll) * 100 : 0 })),
  };
}

async function main() {
  const args = parseArgs();

  console.error(`📂 コンテキスト読み込み中...`);
  const ctx = loadContext({
    cashPath: args.cashFile ?? undefined,
    candidatesPath: args.candidates ?? undefined,
  });
  console.error(`  → portfolio ${ctx.portfolio.length} 銘柄, cash ${ctx.cash.length} currency, candidates ${ctx.candidates.length}`);
  if (ctx.cashStale) {
    console.error(`  ⚠️  cash.csv は 30 日以上更新されていません`);
  }

  const allTickers = [...new Set([...ctx.portfolio.map((p) => p.ticker), ...ctx.candidates.map((c) => c.ticker)])];

  if (args.only === "sanity") {
    console.error(`🚨 sanity-check (--only-sanity)...`);
    const flags = await sanityCheck(allTickers);
    for (const [, f] of flags) {
      console.log(formatSanityLine(f));
      for (const w of f.warnings) console.log(`    🚨 ${w}`);
    }
    return;
  }

  console.error(`📊 yahoo-finance2 で財務指標取得中...`);
  const candidatesForFundamentals: Candidate[] = allTickers.map((t) => ({ ticker: t, name: t, rationale: "" }));
  const fundamentals = await fetchFundamentals(candidatesForFundamentals);
  const fundMap = new Map(fundamentals.map((f) => [f.ticker.toUpperCase(), f]));

  // Build per-ticker aliases from fundamentals (company names) plus candidate names,
  // so RSS-feed matching works even when yahoo's per-ticker news search is flaky.
  console.error(`📰 ticker 別ニュース取得中...`);
  const candidateNameMap = new Map(ctx.candidates.map((c) => [c.ticker.toUpperCase(), c.name]));
  const tickerKeys = ctx.portfolio.map((p) => {
    const upper = p.ticker.toUpperCase();
    const name = fundMap.get(upper)?.name ?? null;
    return { ticker: p.ticker, aliases: deriveAliases(name) };
  });
  tickerKeys.push(
    ...ctx.candidates.map((c) => {
      const upper = c.ticker.toUpperCase();
      const fundName = fundMap.get(upper)?.name ?? null;
      const candName = candidateNameMap.get(upper) ?? null;
      const aliasSet = new Set<string>([...deriveAliases(fundName), ...deriveAliases(candName)]);
      return { ticker: c.ticker, aliases: [...aliasSet] };
    }),
  );
  const newsMap = await fetchTickerNews(tickerKeys);
  const totalNewsItems = [...newsMap.values()].reduce((sum, items) => sum + items.length, 0);
  console.error(`  → ${totalNewsItems} 件マッチ`);

  console.error(`📈 価格履歴取得中...`);
  const priceMetrics = await fetchPriceHistory(allTickers);

  console.error(`🚨 sanity-check 中...`);
  const sanityFlags = await sanityCheck(allTickers);

  // Compute portfolio totals BEFORE evaluate-holdings so Claude sees position %
  // FX: CAD → USD at fixed ~0.73 (simplification; for sizing purposes only)
  const CAD_TO_USD = 0.73;
  const priceMap = new Map<string, number | null>();
  for (const [t, m] of priceMetrics) priceMap.set(t, m.currentPrice);
  for (const [t, f] of fundMap) {
    if (!priceMap.has(t) || priceMap.get(t) === null) priceMap.set(t, f.price);
  }

  const positionValueUSDEquivByTicker = new Map<string, number>();
  let totalHoldingsUSDEquiv = 0;
  for (const row of ctx.portfolio) {
    const upper = row.ticker.toUpperCase();
    const price = priceMap.get(upper) ?? row.avgCost;
    const valueInCcy = row.quantity * (price ?? row.avgCost);
    const valueUSDEquiv = row.currency === "CAD" ? valueInCcy * CAD_TO_USD : valueInCcy;
    positionValueUSDEquivByTicker.set(upper, valueUSDEquiv);
    totalHoldingsUSDEquiv += valueUSDEquiv;
  }
  const totalCashUSDEquiv = ctx.cash.reduce(
    (sum, c) => sum + (c.currency === "CAD" ? c.amount * CAD_TO_USD : c.amount),
    0,
  );
  const totalPortfolioUSDEquiv = totalHoldingsUSDEquiv + totalCashUSDEquiv;

  const holdingInputs = ctx.portfolio.map((row) => {
    const upper = row.ticker.toUpperCase();
    const fund = fundMap.get(upper);
    if (!fund) throw new Error(`fundamentals missing for ${row.ticker}`);
    const currentPrice = priceMap.get(upper) ?? fund.price ?? row.avgCost;
    const positionValue = row.quantity * currentPrice;
    const positionValueUSDEquiv = positionValueUSDEquivByTicker.get(upper) ?? 0;
    const positionPct = totalPortfolioUSDEquiv > 0
      ? (positionValueUSDEquiv / totalPortfolioUSDEquiv) * 100
      : 0;
    const pnlPct = row.avgCost > 0 ? ((currentPrice - row.avgCost) / row.avgCost) * 100 : 0;
    return {
      row,
      fundamentals: fund,
      news: newsMap.get(upper) ?? [],
      technicals: priceMetrics.get(upper) ?? { ticker: row.ticker, dayChange: null, peakToNow5d: null, return1w: null, return1m: null, return3m: null, return6m: null, return12m: null, drawdownPct: null, currentPrice: null },
      sanity: sanityFlags.get(upper),
      currentPrice,
      positionValue,
      positionPct,
      pnlPct,
    };
  });

  console.error(`🧠 保有銘柄評価中（Claude）...`);
  const holdingDecisions = await evaluateHoldings(holdingInputs);
  console.error(`  → ${holdingDecisions.length} 銘柄判定済み`);

  if (args.only === "holdings") {
    for (const d of holdingDecisions) {
      const trimStr = d.trimPct ? ` trim ${d.trimPct}% (~${d.trimShares} 株, ~$${d.trimAmount?.toFixed(0)})` : "";
      console.log(`${d.ticker} (${d.account}, ${d.positionPct.toFixed(1)}%): ${d.action} [${d.confidence}]${trimStr} — ${d.thesis.slice(0, 80)}...`);
    }
    return;
  }

  const fundSectorMap = new Map<string, { sector: string | null; currency: string }>();
  for (const [t, f] of fundMap) fundSectorMap.set(t, { sector: f.sector, currency: f.currency });
  const portfolioHealth = computePortfolioHealth(ctx.portfolio, fundSectorMap, priceMap);

  console.error(`💰 cash 配分中（Claude）...`);
  const adds = holdingDecisions.filter((d) => d.action === "ADD");

  const trimProceedsUSD = holdingDecisions
    .filter((d) => d.action === "TRIM" || d.action === "SELL")
    .reduce((sum, d) => sum + (d.trimAmount ?? 0), 0);
  const augmentedCash = ctx.cash.map((c) =>
    c.currency === "USD" ? { ...c, amount: c.amount + trimProceedsUSD } : c,
  );

  const portfolioTotals = ctx.portfolio.map((row) => ({
    ticker: row.ticker,
    currency: row.currency,
    valueInCurrency: row.quantity * (priceMap.get(row.ticker.toUpperCase()) ?? row.avgCost),
    sector: fundMap.get(row.ticker.toUpperCase())?.sector ?? null,
  }));
  const { buyDecisions, remainder } = await allocateCash({
    cash: augmentedCash,
    trimProceedsUSD,
    portfolioTotals,
    portfolioTotalUSD: portfolioHealth.totalValueUSD,
    portfolioTotalCAD: portfolioHealth.totalValueCAD,
    adds,
    buys: ctx.candidates,
    priceMetrics,
  });
  console.error(`  → ${buyDecisions.length} 件配分`);

  const report: RebalanceReport = {
    date: todayJST(),
    cash: ctx.cash,
    cashStale: ctx.cashStale,
    holdings: ctx.portfolio,
    portfolioHealth,
    holdingDecisions,
    buyDecisions,
    candidatesUsed: ctx.candidates,
    cashRemainder: remainder,
  };

  if (args.dryRun) {
    console.log(renderRebalanceMarkdown(report));
    console.error(`\n✓ dry-run 完了（md 保存・Notion 登録なし）`);
    return;
  }

  console.error(`📝 md 保存中...`);
  const mdPath = writeRebalanceReport(report);
  console.error(`  → ${mdPath}`);

  console.error(`📝 Notion 登録中...`);
  try {
    const pageId = await registerRebalanceNotion(report);
    console.error(`✓ Notion 完了: ${pageId}`);
  } catch (err) {
    console.error(`✗ Notion 登録失敗: ${err instanceof Error ? err.message : err}`);
    console.error(`md は保存済み (${mdPath})。Notion DB env (NOTION_REBALANCE_DB) を確認して再実行してください。`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("rebalance failed:", err);
  process.exit(1);
});
