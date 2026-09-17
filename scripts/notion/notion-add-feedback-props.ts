#!/usr/bin/env bun
/**
 * Meals DB に Feedback (rich_text) プロパティを追加する
 * 一度だけ実行すればOK
 */

import { getApiKey, getDbId, notionFetch } from "./lib/notion";

async function addFeedbackProperty(dbId: string, label: string) {
  const apiKey = getApiKey();
  await notionFetch(apiKey, `/databases/${dbId}`, {
    properties: {
      Feedback: { rich_text: {} },
    },
  }, "PATCH");
  console.log(`✅ ${label}: Feedback プロパティを追加しました`);
}

async function main() {
  const mealsDbId = getDbId("NOTION_MEALS_DB");

  await addFeedbackProperty(mealsDbId, "Meals DB");

  console.log("完了！");
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
