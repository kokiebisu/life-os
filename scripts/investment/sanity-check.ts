#!/usr/bin/env bun
/**
 * Sanity check — 直近の異常な値動きを検出する。
 *
 * 「Claude のナレッジカットオフ以後の earnings イベント等で大暴落した銘柄」を
 * thesis 構築前 / 出力前にフラグする。PRIM の earnings miss (-50%) を見逃した
 * 反省から追加。
 *
 * 検出ルール（いずれか該当で警告）:
 *   - 180d 高値からの drawdown <= -25%
 *   - 直近 5 営業日 <= -15%
 *   - 直近 22 営業日 <= -20%
 *   - 直近 30 日の最大出来高が 30 日平均の 5 倍以上（earnings / 重大ニュース疑い）
 *
 * 使い方:
 *   bun run scripts/investment/sanity-check.ts AAPL PRIM CEG
 */

import YahooFinance from "yahoo-finance2";
import type { SanityFlag } from "./types";

const yahooFinance = new YahooFinance({ suppressNotices: ["yahooSurvey"] });

const DRAWDOWN_THRESHOLD = -25;
const PCT5D_THRESHOLD = -15;
const PCT30D_THRESHOLD = -20;
const VOLUME_RATIO_THRESHOLD = 5;
const HISTORY_DAYS = 180;

export async function sanityCheck(tickers: string[]): Promise<Map<string, SanityFlag>> {
  const out = new Map<string, SanityFlag>();
  const now = new Date();
  const start = new Date(now.getTime() - HISTORY_DAYS * 24 * 3600 * 1000);

  await Promise.all(
    tickers.map(async (ticker) => {
      try {
        const hist = await yahooFinance.chart(ticker, { period1: start, period2: now, interval: "1d" });
        const quotes = (hist.quotes ?? []).filter((q: any) => q.close !== null && q.close !== undefined);
        if (quotes.length < 10) return;

        const last = quotes[quotes.length - 1];
        const lastClose = last.close as number;
        const high180 = Math.max(...quotes.map((q: any) => q.high ?? q.close ?? -Infinity));
        const drawdownPct = ((lastClose - high180) / high180) * 100;

        const ago5 = quotes[Math.max(0, quotes.length - 6)];
        const pct5d = ((lastClose - (ago5.close as number)) / (ago5.close as number)) * 100;

        const ago22 = quotes[Math.max(0, quotes.length - 23)];
        const pct30d = ((lastClose - (ago22.close as number)) / (ago22.close as number)) * 100;

        const recent30Volumes = quotes
          .slice(-30)
          .map((q: any) => q.volume ?? 0)
          .filter((v: number) => v > 0);
        const avgVol = recent30Volumes.length > 0 ? recent30Volumes.reduce((a, b) => a + b, 0) / recent30Volumes.length : 0;
        const maxVol = recent30Volumes.length > 0 ? Math.max(...recent30Volumes) : 0;
        const maxVolumeRatio = avgVol > 0 ? maxVol / avgVol : 0;

        const warnings: string[] = [];
        if (drawdownPct <= DRAWDOWN_THRESHOLD) {
          warnings.push(`180日高値 $${high180.toFixed(2)} → 現在 $${lastClose.toFixed(2)}（drawdown ${drawdownPct.toFixed(1)}%）`);
        }
        if (pct5d <= PCT5D_THRESHOLD) {
          warnings.push(`直近 5 営業日で ${pct5d.toFixed(1)}% 下落`);
        }
        if (pct30d <= PCT30D_THRESHOLD) {
          warnings.push(`直近 30 営業日で ${pct30d.toFixed(1)}% 下落`);
        }
        if (maxVolumeRatio >= VOLUME_RATIO_THRESHOLD) {
          warnings.push(`異常出来高 ${maxVolumeRatio.toFixed(1)}× 平均（earnings / 重大ニュース疑い）`);
        }

        out.set(ticker.toUpperCase(), {
          ticker,
          drawdownPct,
          pct5d,
          pct30d,
          maxVolumeRatio,
          high180,
          currentPrice: lastClose,
          warnings,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[sanity-check] ${ticker} failed: ${msg}`);
      }
    }),
  );

  return out;
}

export function formatSanityLine(flag: SanityFlag): string {
  const icon = flag.warnings.length > 0 ? "🚨" : "✓";
  return `${icon} ${flag.ticker}: 5d=${flag.pct5d.toFixed(1)}% / 30d=${flag.pct30d.toFixed(1)}% / drawdown=${flag.drawdownPct.toFixed(1)}% / volRatio=${flag.maxVolumeRatio.toFixed(1)}×`;
}

if (import.meta.main) {
  const tickers = process.argv.slice(2);
  if (tickers.length === 0) {
    console.error("Usage: bun run scripts/investment/sanity-check.ts <ticker> [...]");
    process.exit(1);
  }
  const flags = await sanityCheck(tickers);
  let warningCount = 0;
  for (const [, f] of flags) {
    console.log(formatSanityLine(f));
    for (const w of f.warnings) console.log(`    🚨 ${w}`);
    if (f.warnings.length > 0) warningCount++;
  }
  console.error(`\n${warningCount}/${flags.size} 銘柄に警告あり`);
  if (warningCount > 0) process.exit(2);
}
