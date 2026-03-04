#!/usr/bin/env bun
/**
 * レシピ自動生成・Notion食事ページ更新
 *
 * メニュー名 → レシピ検索 → Claude API → Notion 食事ページ本文
 *
 * 使い方:
 *   bun run scripts/notion-recipe-gen.ts --page-id <id>
 *   bun run scripts/notion-recipe-gen.ts --date 2026-02-17 --meal 昼
 *   bun run scripts/notion-recipe-gen.ts --page-id <id> --dry-run
 *
 * メニュー名はページタイトルから自動取得。レシピURLも自動検索。
 */

import {
  type ScheduleDbName,
  getScheduleDbConfig,
  queryDbByDateCached,
  notionFetch,
  getApiKey,
  parseArgs,
} from "./lib/notion";
import { callClaude } from "./lib/claude";

// --- Types ---

interface RecipeData {
  title: string;
  sourceUrl: string;
  sourceSite: string;
  cookingTime: string;
  ingredients: Array<{
    name: string;
    quantity: string;
  }>;
  steps: string[];
  tips: string[];
  skillTheme?: string;
}

// --- Claude API ---

const SYSTEM_PROMPT = `あなたはレシピフォーマットアシスタントです。
レシピサイトの内容から、構造化JSONを生成します。

## ルール

1. **材料は1人前に換算**: 元レシピが2人前なら半分に、4人前なら1/4に
2. **手順は簡潔に**: 各ステップを1文で
3. **コツは重要なものだけ**: 失敗しやすいポイント、美味しくなるコツ
4. **調理時間**: 下準備+調理の合計時間
5. **出典サイト名**: クラシル、白ごはん.com、Nadia、DELISH KITCHENなど

## 出力フォーマット

以下のJSON構造で出力してください（JSONのみ、他のテキスト不要）:

{
  "title": "鶏むね肉のソテー",
  "sourceUrl": "https://...",
  "sourceSite": "クラシル",
  "cookingTime": "20分",
  "ingredients": [
    { "name": "鶏むね肉", "quantity": "150g" },
    { "name": "ブロッコリー", "quantity": "1/2株" },
    { "name": "塩", "quantity": "少々" }
  ],
  "steps": [
    "鶏むね肉を一口大に切る",
    "ブロッコリーを小房に分ける",
    "フライパンで炒める"
  ],
  "tips": [
    "むね肉は下味をつけると柔らかくなる",
    "火加減は中火でじっくり"
  ],
  "skillTheme": "焼く - フライパンの火加減"
}`;

async function searchAndGenerateRecipe(
  menuName: string,
): Promise<RecipeData> {
  console.log(`🔍 Searching and generating recipe for: ${menuName}`);

  const userPrompt = `「${menuName}」のレシピを探して、構造化JSONを生成してください。

## 手順
1. WebSearch で「${menuName} レシピ クラシル」を検索
2. 検索結果から最も適切なレシピページの URL を取得
3. WebFetch でそのページの内容を取得
4. 取得した内容を元に、指定フォーマットの JSON を生成

## 重要
- 必ず実在するレシピサイトから情報を取得してください
- JSON のみを出力してください（他のテキスト不要）`;

  const response = await callClaude(
    [{ role: "user", content: userPrompt }],
    {
      system: SYSTEM_PROMPT,
      model: "claude-sonnet-4-5-20250929",
      allowedTools: ["WebSearch", "WebFetch"],
      maxTurns: 10,
    },
  );

  const jsonMatch = response.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error("Claude API response does not contain valid JSON");
  }

  const data = JSON.parse(jsonMatch[0]) as RecipeData;

  // Validate required fields
  if (!data.sourceUrl || !data.ingredients?.length || !data.steps?.length) {
    throw new Error(
      `Recipe data incomplete: sourceUrl=${!!data.sourceUrl}, ingredients=${data.ingredients?.length ?? 0}, steps=${data.steps?.length ?? 0}`,
    );
  }

  return data;
}

// --- Notion block building ---

function richText(text: string): any[] {
  return [{ type: "text", text: { content: text } }];
}

function styledText(
  segments: Array<{ text: string; bold?: boolean; color?: string; url?: string }>,
): any[] {
  return segments.map((s) => ({
    type: "text",
    text: { content: s.text, ...(s.url && { link: { url: s.url } }) },
    annotations: {
      ...(s.bold && { bold: true }),
      ...(s.color && { color: s.color }),
    },
  }));
}

function buildNotionBlocks(data: RecipeData): any[] {
  const blocks: any[] = [];

  // Header callout (green background)
  blocks.push({
    object: "block",
    type: "callout",
    callout: {
      rich_text: styledText([
        { text: data.sourceSite, bold: true, url: data.sourceUrl },
        { text: " | 調理時間 " },
        { text: data.cookingTime, bold: true, color: "orange" },
      ]),
      icon: { type: "emoji", emoji: "📋" },
      color: "green_background",
    },
  });

  // Divider
  blocks.push({ object: "block", type: "divider", divider: {} });

  // Ingredients section
  blocks.push({
    object: "block",
    type: "heading_3",
    heading_3: {
      rich_text: styledText([{ text: "🥗 材料（1人前）" }]),
    },
  });

  for (const ing of data.ingredients) {
    blocks.push({
      object: "block",
      type: "bulleted_list_item",
      bulleted_list_item: {
        rich_text: styledText([
          { text: ing.name, bold: true },
          { text: ` ${ing.quantity}` },
        ]),
      },
    });
  }

  // Steps section
  blocks.push({
    object: "block",
    type: "heading_3",
    heading_3: {
      rich_text: styledText([{ text: "👨‍🍳 作り方" }]),
    },
  });

  for (const step of data.steps) {
    blocks.push({
      object: "block",
      type: "numbered_list_item",
      numbered_list_item: {
        rich_text: richText(step),
      },
    });
  }

  // Tips section
  if (data.tips.length > 0) {
    blocks.push({
      object: "block",
      type: "heading_3",
      heading_3: {
        rich_text: styledText([{ text: "💡 コツ・ポイント" }]),
      },
    });

    blocks.push({
      object: "block",
      type: "quote",
      quote: {
        rich_text: richText(data.tips.join("\n")),
      },
    });
  }

  // Skill theme section
  if (data.skillTheme) {
    blocks.push({
      object: "block",
      type: "callout",
      callout: {
        rich_text: styledText([
          { text: "🎯 今週のスキルテーマ\n", bold: true },
          { text: data.skillTheme },
        ]),
        icon: { type: "emoji", emoji: "🎯" },
        color: "blue_background",
      },
    });
  }

  return blocks;
}

// --- Page finding ---

async function findMealPage(
  apiKey: string,
  date: string,
  meal: string,
): Promise<{ id: string; title: string }> {
  const { dbId, config } = getScheduleDbConfig("meals");
  const data = await queryDbByDateCached(apiKey, dbId, config, date, date);
  const pages = data.results;

  // Filter by meal time (朝/昼/間食/夜)
  const mealPages = pages.filter((p: any) => {
    const title =
      p.properties[config.titleProp]?.title
        ?.map((t: any) => t.plain_text)
        .join("") || "";
    return title.includes(meal);
  });

  if (mealPages.length === 0) {
    throw new Error(
      `No meal page found for date ${date}, meal ${meal}`,
    );
  }

  const page = mealPages[0];
  const props = page.properties;
  const titleArr = props[config.titleProp]?.title || [];
  const title = titleArr.map((t: any) => t.plain_text || "").join("");

  return { id: page.id, title };
}

async function getPageTitle(apiKey: string, pageId: string): Promise<string> {
  const page = await notionFetch(apiKey, `/pages/${pageId}`);
  const props = page.properties;
  const titleArr = props["名前"]?.title || [];
  return titleArr.map((t: any) => t.plain_text || "").join("");
}

// --- Notion update ---

async function updateNotionPage(
  apiKey: string,
  pageId: string,
  blocks: any[],
): Promise<void> {
  // Delete existing blocks
  const page = await notionFetch(
    apiKey,
    `/blocks/${pageId}/children?page_size=100`,
  );
  const existingBlocks = page.results || [];

  for (const block of existingBlocks) {
    await notionFetch(apiKey, `/blocks/${block.id}`, undefined, "DELETE");
  }

  // Append new blocks
  await notionFetch(apiKey, `/blocks/${pageId}/children`, { children: blocks }, "PATCH");
}

// --- Main ---

async function main() {
  const args = parseArgs();

  const pageId = args.opts["page-id"] || args.opts["id"];
  const date = args.opts["date"];
  const meal = args.opts["meal"];
  const dryRun = args.flags.has("dry-run");

  if (!pageId && (!date || !meal)) {
    console.error("Error: --page-id OR (--date AND --meal) is required");
    process.exit(1);
  }

  const apiKey = getApiKey();

  // Find page
  let targetPageId: string;
  let pageTitle: string;

  if (pageId) {
    targetPageId = pageId;
    pageTitle = await getPageTitle(apiKey, pageId);
    console.log(`📄 Page: ${pageTitle} (${pageId})`);
  } else {
    const page = await findMealPage(apiKey, date!, meal!);
    targetPageId = page.id;
    pageTitle = page.title;
    console.log(`📄 Found: ${pageTitle} (${targetPageId})`);
  }

  // Extract menu name from title (remove meal prefix like "昼 ")
  const menuName = pageTitle.replace(/^(朝|昼|間食|夜)\s*/, "");

  // Search + fetch + generate in one Claude call
  const recipeData = await searchAndGenerateRecipe(menuName);

  console.log(`\n📋 Recipe: ${recipeData.title}`);
  console.log(`⏱️  Cooking time: ${recipeData.cookingTime}`);
  console.log(`🥗 Ingredients: ${recipeData.ingredients.length} items`);
  console.log(`👨‍🍳 Steps: ${recipeData.steps.length} steps`);

  // Build Notion blocks
  const blocks = buildNotionBlocks(recipeData);

  if (dryRun) {
    console.log("\n🔍 [DRY RUN] Generated blocks:");
    console.log(JSON.stringify(blocks, null, 2));
    console.log("\n✅ Dry run complete. No changes made.");
    return;
  }

  // Update Notion page
  console.log(`\n📝 Updating Notion page...`);
  await updateNotionPage(apiKey, targetPageId, blocks);

  // Verify page content was written
  const verification = await notionFetch(
    apiKey,
    `/blocks/${targetPageId}/children?page_size=1`,
  );
  if (!verification.results?.length) {
    throw new Error("Page update verification failed: no blocks found after update");
  }

  console.log(`✅ Recipe added to: ${pageTitle}`);
  console.log(`🔗 ${recipeData.sourceUrl}`);
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
