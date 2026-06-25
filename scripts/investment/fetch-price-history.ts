#!/usr/bin/env bun
/**
 * fetch-price-history — 各 ticker の 12 ヶ月価格履歴を取得し、1w/1m/3m/6m/12m リターン + drawdown を返す。
 */

import YahooFinance from "yahoo-finance2";

const yahooFinance = new YahooFinance({ suppressNotices: ["yahooSurvey"] });

export interface PriceMetrics {
  ticker: string;
  dayChange: number | null;  // 直近 1 日（前営業日 close → 今日 close）
  peakToNow5d: number | null; // 直近 5 営業日の最高値 → 今日 close（intra-window crash 検出）
  return1w: number | null;   // ~5 営業日
  return1m: number | null;   // ~21 営業日
  return3m: number | null;
  return6m: number | null;
  return12m: number | null;
  drawdownPct: number | null; // 12-month high からの drawdown
  currentPrice: number | null;
  fetchError?: string;
}

const HISTORY_DAYS = 380; // ~ 1 year + buffer

export async function fetchPriceHistory(tickers: string[]): Promise<Map<string, PriceMetrics>> {
  const out = new Map<string, PriceMetrics>();
  const now = new Date();
  const start = new Date(now.getTime() - HISTORY_DAYS * 24 * 3600 * 1000);

  await Promise.all(
    tickers.map(async (ticker) => {
      try {
        const hist = await yahooFinance.chart(ticker, { period1: start, period2: now, interval: "1d" });
        const quotes = (hist.quotes ?? []).filter((q: any) => q.close !== null && q.close !== undefined);
        if (quotes.length < 30) {
          out.set(ticker.toUpperCase(), {
            ticker,
            dayChange: null,
            peakToNow5d: null,
            return1w: null,
            return1m: null,
            return3m: null,
            return6m: null,
            return12m: null,
            drawdownPct: null,
            currentPrice: null,
            fetchError: `only ${quotes.length} data points`,
          });
          return;
        }
        const closes = quotes.map((q: any) => q.close as number);
        const lastClose = closes[closes.length - 1];
        const high12m = Math.max(...closes);
        const drawdownPct = ((lastClose - high12m) / high12m) * 100;

        const pickReturn = (daysAgo: number): number | null => {
          const idx = quotes.length - 1 - daysAgo;
          if (idx < 0) return null;
          const prev = closes[idx];
          if (prev <= 0) return null;
          return ((lastClose - prev) / prev) * 100;
        };

        const dayChange = closes.length >= 2
          ? ((lastClose - closes[closes.length - 2]) / closes[closes.length - 2]) * 100
          : null;

        const recent5 = closes.slice(Math.max(0, closes.length - 5));
        const peak5 = Math.max(...recent5);
        const peakToNow5d = peak5 > 0 ? ((lastClose - peak5) / peak5) * 100 : null;

        out.set(ticker.toUpperCase(), {
          ticker,
          dayChange,
          peakToNow5d,
          return1w: pickReturn(5),
          return1m: pickReturn(21),
          return3m: pickReturn(63),
          return6m: pickReturn(126),
          return12m: pickReturn(252),
          drawdownPct,
          currentPrice: lastClose,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[price-history] ${ticker} failed: ${msg}`);
        out.set(ticker.toUpperCase(), {
          ticker,
          dayChange: null,
          peakToNow5d: null,
          return1w: null,
          return1m: null,
          return3m: null,
          return6m: null,
          return12m: null,
          drawdownPct: null,
          currentPrice: null,
          fetchError: msg,
        });
      }
    }),
  );

  return out;
}

if (import.meta.main) {
  const tickers = process.argv.slice(2);
  if (tickers.length === 0) {
    console.error("Usage: bun run scripts/investment/fetch-price-history.ts AAPL AMZN");
    process.exit(1);
  }
  const result = await fetchPriceHistory(tickers);
  for (const [t, m] of result.entries()) {
    if (m.fetchError) {
      console.log(`${t}: ERROR ${m.fetchError}`);
    } else {
      console.log(`${t}: price=${m.currentPrice?.toFixed(2)} day=${m.dayChange?.toFixed(1)}% peak→now=${m.peakToNow5d?.toFixed(1)}% 1w=${m.return1w?.toFixed(1)}% 1m=${m.return1m?.toFixed(1)}% 3m=${m.return3m?.toFixed(1)}% 6m=${m.return6m?.toFixed(1)}% 12m=${m.return12m?.toFixed(1)}% drawdown=${m.drawdownPct?.toFixed(1)}%`);
    }
  }
}
