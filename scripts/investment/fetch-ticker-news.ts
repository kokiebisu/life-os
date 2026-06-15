#!/usr/bin/env bun
/**
 * fetch-ticker-news — 既存の fetch-news.ts と yahoo-finance2 の per-ticker search を組み合わせて
 * 各 ticker のニュースを返す。
 *
 * 1. 既存の RSS feed を ticker キーワードでフィルタ
 * 2. RSS マッチが 3 件未満の ticker に対しては yahoo-finance2.search() で補完（per-ticker news）
 */

import YahooFinance from "yahoo-finance2";
import { fetchNews } from "./fetch-news";
import type { NewsItem, TickerNews } from "./types";

const yahooFinance = new YahooFinance({ suppressNotices: ["yahooSurvey"] });

const PER_TICKER_FALLBACK_THRESHOLD = 3; // RSS マッチがこれ未満なら Yahoo per-ticker を追加取得
const PER_TICKER_NEWS_LIMIT = 5;
const NEWS_FRESHNESS_DAYS = 30;
const YAHOO_SEARCH_RETRIES = 3;
const YAHOO_SEARCH_BACKOFF_MS = 700;

export interface TickerKey {
  ticker: string;
  /**
   * Match against title/summary. Include ticker plus company short name(s).
   * If null, only the ticker symbol is matched.
   */
  aliases?: string[];
}

async function yahooSearchWithRetry(query: string): Promise<{ news: any[] } | null> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < YAHOO_SEARCH_RETRIES; attempt++) {
    try {
      const r = await yahooFinance.search(
        query,
        { newsCount: PER_TICKER_NEWS_LIMIT },
        { validateResult: false },
      );
      return r as { news: any[] };
    } catch (err) {
      lastErr = err;
      const msg = err instanceof Error ? err.message : String(err);
      // Schema validation failures are transient — Yahoo occasionally returns
      // data shapes that fail strict validation. Retry with backoff.
      if (!/Schema validation|ECONNRESET|fetch failed|timeout/i.test(msg)) break;
      if (attempt < YAHOO_SEARCH_RETRIES - 1) {
        await new Promise((r) => setTimeout(r, YAHOO_SEARCH_BACKOFF_MS * (attempt + 1)));
      }
    }
  }
  const msg = lastErr instanceof Error ? lastErr.message : String(lastErr);
  console.warn(`[ticker-news] ${query} yahoo search failed after ${YAHOO_SEARCH_RETRIES} attempts: ${msg}`);
  return null;
}

export async function fetchTickerNews(keys: TickerKey[]): Promise<Map<string, NewsItem[]>> {
  const allNews = await fetchNews();
  const rssMap = filterByTicker(allNews, keys);

  // For tickers with low RSS match, fetch per-ticker news via yahoo-finance2.search
  const cutoff = Date.now() - NEWS_FRESHNESS_DAYS * 24 * 3600 * 1000;
  await Promise.all(
    keys.map(async (key) => {
      const upper = key.ticker.toUpperCase();
      const existing = rssMap.get(upper) ?? [];
      if (existing.length >= PER_TICKER_FALLBACK_THRESHOLD) return;
      const result = await yahooSearchWithRetry(key.ticker);
      if (!result) return;
      const yahooNews: NewsItem[] = (result.news ?? [])
        .filter((n: any) => {
          const ts = n.providerPublishTime ? new Date(n.providerPublishTime).getTime() : 0;
          return ts >= cutoff;
        })
        .map((n: any): NewsItem => ({
          source: n.publisher ?? "Yahoo Finance",
          category: "株",
          lang: "en",
          title: n.title ?? "",
          link: n.link ?? "",
          pubDate: n.providerPublishTime ? new Date(n.providerPublishTime).toISOString() : "",
          summary: "",
        }));
      // Dedupe by link
      const seen = new Set(existing.map((i) => i.link));
      const merged = [...existing];
      for (const n of yahooNews) {
        if (!seen.has(n.link)) {
          merged.push(n);
          seen.add(n.link);
        }
      }
      rssMap.set(upper, merged.slice(0, PER_TICKER_NEWS_LIMIT));
    }),
  );

  return rssMap;
}

const CORPORATE_SUFFIX_RE = /,?\s+(Inc|Corp|Corporation|Co|Company|Ltd|Limited|plc|LLC|N\.?V\.?|S\.?A\.?|Holdings|Group|SE|AG|PLC|GmbH|ADR)\.?$/i;

/**
 * Derive RSS-feed match aliases from a company name.
 * "Apple Inc." → ["Apple Inc.", "Apple"]
 * "Amazon.com, Inc." → ["Amazon.com", "Amazon"]
 * "Meta Platforms, Inc." → ["Meta Platforms", "Meta"]
 */
export function deriveAliases(name: string | null | undefined): string[] {
  if (!name) return [];
  let cleaned = name;
  // Strip corporate suffix repeatedly (some names have nested suffixes like "X Holdings, Inc.")
  for (let i = 0; i < 3; i++) {
    const next = cleaned.replace(CORPORATE_SUFFIX_RE, "").trim();
    if (next === cleaned) break;
    cleaned = next;
  }
  cleaned = cleaned.replace(/[,.\s]+$/, "").trim();
  const aliases = new Set<string>();
  if (cleaned.length >= 3) aliases.add(cleaned);
  // Also add the .com-stripped form for "Amazon.com" → "Amazon"
  const noDotCom = cleaned.replace(/\.com$/i, "").trim();
  if (noDotCom.length >= 3 && noDotCom !== cleaned) aliases.add(noDotCom);
  // First word alone — useful for multi-word names ("Meta Platforms" → "Meta")
  const firstWord = noDotCom.split(/\s+/)[0];
  if (firstWord && firstWord.length >= 4 && firstWord !== noDotCom) aliases.add(firstWord);
  return [...aliases];
}

export function filterByTicker(news: NewsItem[], keys: TickerKey[]): Map<string, NewsItem[]> {
  const map = new Map<string, NewsItem[]>();
  for (const key of keys) {
    const candidates = [key.ticker, ...(key.aliases ?? [])]
      .map((s) => s.toLowerCase())
      .filter((s) => s.length >= 2);
    const matched: NewsItem[] = [];
    for (const n of news) {
      const hay = `${n.title} ${n.summary}`.toLowerCase();
      const tickerLower = key.ticker.toLowerCase();
      const tickerRe = new RegExp(`(^|[^a-z0-9])${tickerLower}([^a-z0-9]|$)`);
      const isTickerMatch = tickerRe.test(hay);
      const isAliasMatch = (key.aliases ?? []).some((a) => hay.includes(a.toLowerCase()));
      if (isTickerMatch || isAliasMatch) matched.push(n);
    }
    map.set(key.ticker.toUpperCase(), matched.slice(0, 5));
  }
  return map;
}

export function buildTickerNewsItems(news: Map<string, NewsItem[]>): TickerNews[] {
  return [...news.entries()].map(([ticker, items]) => ({ ticker, items }));
}

if (import.meta.main) {
  const tickers: TickerKey[] = process.argv.slice(2).map((arg) => {
    const [ticker, aliasStr] = arg.split(":");
    return { ticker, aliases: aliasStr ? aliasStr.split(",") : [] };
  });
  if (tickers.length === 0) {
    console.error("Usage: bun run scripts/investment/fetch-ticker-news.ts AAPL:Apple AMZN:Amazon TSM:Taiwan");
    process.exit(1);
  }
  const result = await fetchTickerNews(tickers);
  for (const [t, items] of result.entries()) {
    console.log(`\n=== ${t} (${items.length} items) ===`);
    items.forEach((i) => console.log(`  [${i.source}] ${i.title}`));
  }
}
