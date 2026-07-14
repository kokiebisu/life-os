#!/usr/bin/env bun
/**
 * Notion ページ削除（ゴミ箱に移動）
 *
 * 使い方:
 *   bun run scripts/notion-delete.ts <page-id> [<page-id> ...]
 *   bun run scripts/notion-delete.ts 309ce17f-7b98-8194-bc0f-e3a6534cefdf
 */

import { getApiKey, notionFetch, clearNotionCache } from "./lib/notion";

/** Pull positional page-id args out of argv, ignoring flags (--foo). */
export function parsePageIds(argv: string[]): string[] {
  return argv.filter((a) => !a.startsWith("--"));
}

/** Extract a Notion page's title text, falling back to `fallback` if absent. */
export function extractTitleFromPage(data: any, fallback: string): string {
  const titleProp = Object.values(data?.properties || {}).find(
    (p: any) => p?.type === "title",
  ) as any;
  const text = titleProp?.title?.map((t: any) => t?.plain_text || "").join("") || "";
  return text || fallback;
}

async function main() {
  const ids = parsePageIds(process.argv.slice(2));
  if (ids.length === 0) {
    console.error("Usage: bun run scripts/notion-delete.ts <page-id> [<page-id> ...]");
    process.exit(1);
  }

  const apiKey = getApiKey();
  clearNotionCache();

  for (const id of ids) {
    const data = await notionFetch(apiKey, `/pages/${id}`, { archived: true }, "PATCH");
    const title = extractTitleFromPage(data, id);
    console.log(`削除しました: ${title}`);
  }
}

if (import.meta.main) {
  main().catch((err) => {
    console.error("Error:", err.message);
    process.exit(1);
  });
}
