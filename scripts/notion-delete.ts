#!/usr/bin/env bun
/**
 * Notion ページを完全削除（アーカイブ）
 *
 * 使い方:
 *   bun run scripts/notion-delete.ts <page-id>
 *
 * 終了コード:
 *   0 = 削除成功
 *   1 = エラー
 */

import { getApiKey, notionFetch } from "./lib/notion";

async function main() {
  const pageId = process.argv[2];
  if (!pageId) {
    console.error("Usage: bun run scripts/notion-delete.ts <page-id>");
    process.exit(1);
  }

  const apiKey = getApiKey();

  // Notion API: ページをアーカイブ（削除扱い）
  await notionFetch(apiKey, `/pages/${pageId}`, { archived: true }, "PATCH");
  console.log(`✅ 削除しました: ${pageId}`);
}

main().catch((err) => {
  console.error(`❌ エラー: ${err.message}`);
  process.exit(1);
});
