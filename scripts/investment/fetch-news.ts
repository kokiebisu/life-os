#!/usr/bin/env bun
/**
 * RSS フィードから過去 24h のニュースを並列取得する。
 *
 * 使い方:
 *   bun run scripts/investment/fetch-news.ts            # JSON で stdout
 *   bun run scripts/investment/fetch-news.ts --titles   # タイトルだけ
 */

import { readFileSync } from "fs";
import { join } from "path";
import Parser from "rss-parser";
import type { FeedConfig, NewsItem } from "./types";

const ROOT = join(import.meta.dir, "../..");
const FEEDS_PATH = join(ROOT, "aspects/investment/feeds.json");

const HOURS_WINDOW = 24;

export async function fetchNews(): Promise<NewsItem[]> {
  const feedsJson = readFileSync(FEEDS_PATH, "utf-8");
  const { feeds } = JSON.parse(feedsJson) as { feeds: FeedConfig[] };

  const parser = new Parser({ timeout: 10_000 });
  const cutoff = Date.now() - HOURS_WINDOW * 60 * 60 * 1000;

  const results = await Promise.allSettled(
    feeds.map(async (feed) => {
      const parsed = await parser.parseURL(feed.url);
      const items: NewsItem[] = [];
      for (const item of parsed.items ?? []) {
        const pubMs = item.isoDate ? Date.parse(item.isoDate) : item.pubDate ? Date.parse(item.pubDate) : NaN;
        if (Number.isNaN(pubMs) || pubMs < cutoff) continue;
        items.push({
          source: feed.name,
          category: feed.category,
          lang: feed.lang ?? "en",
          title: (item.title ?? "").trim(),
          link: item.link ?? "",
          pubDate: item.isoDate ?? item.pubDate ?? "",
          summary: ((item.contentSnippet ?? item.content ?? "") as string).slice(0, 400).trim(),
        });
      }
      return items;
    }),
  );

  const news: NewsItem[] = [];
  results.forEach((r, i) => {
    if (r.status === "fulfilled") {
      news.push(...r.value);
    } else {
      console.warn(`[fetch-news] ${feeds[i].name} failed: ${r.reason}`);
    }
  });

  news.sort((a, b) => (a.pubDate < b.pubDate ? 1 : -1));
  return news;
}

if (import.meta.main) {
  const titlesOnly = process.argv.includes("--titles");
  const news = await fetchNews();
  if (titlesOnly) {
    for (const n of news) console.log(`[${n.source}] ${n.title}`);
  } else {
    console.log(JSON.stringify(news, null, 2));
  }
  console.error(`\n${news.length} 件取得`);
}
