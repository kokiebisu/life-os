#!/usr/bin/env bun
/**
 * 買い出しリスト自動生成
 *
 * daily 献立 + pantry + あおば価格表 → Claude API → Notion 買い出しページ本文
 *
 * 使い方:
 *   bun run scripts/notion-grocery-gen.ts --page-id <id>
 *   bun run scripts/notion-grocery-gen.ts --date 2026-02-17
 *   bun run scripts/notion-grocery-gen.ts --date 2026-02-17 --dry-run
 */

import { readFileSync, existsSync } from "fs";
import { join } from "path";
import {
  type ScheduleDbName,
  getScheduleDbConfig,
  getScheduleDbConfigOptional,
  queryDbByDateCached,
  normalizePages,
  notionFetch,
  getApiKey,
  parseArgs,
} from "./lib/notion";
import { callClaude } from "./lib/claude";

const ROOT = join(import.meta.dir, "..");
const DIET_DIR = join(ROOT, "aspects/diet");

const WEEKDAY_NAMES = ["日", "月", "火", "水", "木", "金", "土"];

const CATEGORY_ORDER = [
  "肉・魚",
  "卵・乳製品",
  "豆腐・納豆",
  "野菜・果物",
  "主食",
  "おやつ・その他",
];

const CATEGORY_EMOJI: Record<string, string> = {
  "肉・魚": "🥩",
  "卵・乳製品": "🥚",
  "豆腐・納豆": "🫘",
  "野菜・果物": "🥬",
  主食: "🍚",
  "おやつ・その他": "🍫",
};

// --- Types ---

interface MealEntry {
  date: string;
  weekday: string;
  meal: string; // 朝/昼/間食/夜
  menu: string;
  isEatingOut: boolean;
}

interface GroceryItem {
  category: string;
  name: string;
  quantity: string;
  mealRefs: string[];
  estimatedPrice: number;
}

interface FreezeMemo {
  item: string;
  instruction: string;
}

interface GroceryListData {
  periodSummary: string;
  estimatedTotal: string;
  eatingOutNotes: string[];
  cookingNotes: string[];
  items: GroceryItem[];
  freezeMemos: FreezeMemo[];
}

// --- Helpers ---

function getWeekday(dateStr: string): string | undefined {
  const d = new Date(dateStr + "T12:00:00+09:00");
  return WEEKDAY_NAMES[d.getDay()];
}

function dateRange(start: string, end: string): string[] {
  const dates: string[] = [];
  let current = new Date(start + "T12:00:00+09:00");
  const endDate = new Date(end + "T12:00:00+09:00");
  while (current <= endDate) {
    dates.push(current.toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" }));
    current.setDate(current.getDate() + 1);
  }
  return dates;
}

function parseDailyMeals(date: string, content: string): MealEntry[] {
  const weekday = getWeekday(date);
  const meals: MealEntry[] = [];
  const lines = content.split("\n");

  // Try table format first: | 朝 | メニュー |
  for (const line of lines) {
    const match = line.match(/^\|\s*(朝|昼|間食|夜)\s*\|\s*(.+?)\s*\|/);
    if (match) {
      const meal = match[1];
      const menu = match[2].trim();
      const isEatingOut = /外食/.test(menu);
      meals.push({ date, weekday, meal, menu, isEatingOut });
    }
  }

  // Fallback: section header format: ## 朝食 HH:MM-HH:MM
  if (meals.length === 0) {
    const mealMap: Record<string, string> = {
      朝食: "朝",
      昼食: "昼",
      間食: "間食",
      夕食: "夜",
    };
    let currentMealKey: string | null = null;
    let currentMealTime: string | null = null;
    let menuTitle: string | null = null;
    let ingredients: string[] = [];

    const flushMeal = () => {
      if (currentMealKey && menuTitle) {
        const details =
          ingredients.length > 0
            ? `${menuTitle}\n  材料: ${ingredients.join("、")}`
            : menuTitle;
        const isEatingOut = /外食/.test(menuTitle);
        const mealLabel = currentMealTime
          ? `${currentMealKey}(${currentMealTime})`
          : currentMealKey;
        meals.push({
          date,
          weekday,
          meal: mealLabel,
          menu: details,
          isEatingOut,
        });
      }
      currentMealKey = null;
      currentMealTime = null;
      menuTitle = null;
      ingredients = [];
    };

    for (const line of lines) {
      const headerMatch = line.match(
        /^##\s*(朝食|昼食|間食|夕食)\s+(\d{1,2}:\d{2})/,
      );
      if (headerMatch) {
        flushMeal();
        currentMealKey = mealMap[headerMatch[1]] || headerMatch[1];
        currentMealTime = headerMatch[2];
        continue;
      }
      // Also match headers without time
      const headerNoTime = line.match(/^##\s*(朝食|昼食|間食|夕食)\s*$/);
      if (headerNoTime) {
        flushMeal();
        currentMealKey = mealMap[headerNoTime[1]] || headerNoTime[1];
        continue;
      }
      if (!currentMealKey) continue;
      // Collect ingredient lines (- item) but skip kcal/calorie lines
      if (line.startsWith("- ") && !/kcal/i.test(line)) {
        ingredients.push(line.replace(/^-\s+/, "").trim());
      }
      // First non-empty, non-list, non-heading line is the menu title
      else if (
        !menuTitle &&
        line.trim() &&
        !line.startsWith("*") &&
        !line.startsWith("#")
      ) {
        menuTitle = line.trim();
      }
    }
    flushMeal();
  }

  return meals;
}

function loadPantry(): string {
  const path = join(DIET_DIR, "pantry.md");
  if (!existsSync(path)) return "";
  return readFileSync(path, "utf-8");
}

function loadAobaPrices(): string {
  const path = join(DIET_DIR, "aoba-prices.csv");
  if (!existsSync(path)) return "";
  return readFileSync(path, "utf-8");
}

function loadFridge(): string {
  const path = join(DIET_DIR, "fridge.md");
  if (!existsSync(path)) return "";
  return readFileSync(path, "utf-8");
}

function toJSTTimeStr(isoStr: string): string | null {
  if (!isoStr.includes("T")) return null;
  try {
    const d = new Date(isoStr);
    return d.toLocaleTimeString("ja-JP", {
      timeZone: "Asia/Tokyo",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  } catch {
    return null;
  }
}

// --- Page finding ---

interface PageInfo {
  id: string;
  title: string;
  dateStart: string;
  dateEnd: string;
  shoppingTimeJST: string | null;
}

async function findGroceriesPage(
  apiKey: string,
  date: string,
): Promise<PageInfo> {
  const { dbId, config } = getScheduleDbConfig("groceries");
  const data = await queryDbByDateCached(apiKey, dbId, config, date, date);
  const pages = data.results;

  if (pages.length === 0) {
    throw new Error(`No groceries page found for date ${date}`);
  }

  // Filter out 食材整理 pages
  const groceryPages = pages.filter((p: any) => {
    const title =
      p.properties[config.titleProp]?.title
        ?.map((t: any) => t.plain_text)
        .join("") || "";
    return !title.includes("食材整理");
  });

  const page = groceryPages.length > 0 ? groceryPages[0] : pages[0];
  const props = page.properties;
  const titleArr = props[config.titleProp]?.title || [];
  const title = titleArr.map((t: any) => t.plain_text || "").join("");
  const dateObj = props[config.dateProp]?.date;

  if (!dateObj?.start) {
    throw new Error(`Groceries page "${title}" has no date set`);
  }

  const dateStart = dateObj.start.split("T")[0];
  const dateEnd = dateObj.end ? dateObj.end.split("T")[0] : dateStart;
  const shoppingTimeJST = toJSTTimeStr(dateObj.start);

  return { id: page.id, title, dateStart, dateEnd, shoppingTimeJST };
}

async function getPageDateRange(
  apiKey: string,
  pageId: string,
): Promise<PageInfo> {
  const page = await notionFetch(apiKey, `/pages/${pageId}`);
  const props = page.properties;
  const titleArr = props["件名"]?.title || [];
  const title = titleArr.map((t: any) => t.plain_text || "").join("");
  const dateObj = props["日付"]?.date;

  if (!dateObj?.start) {
    throw new Error(`Page "${title}" has no date set`);
  }

  const dateStart = dateObj.start.split("T")[0];
  const dateEnd = dateObj.end ? dateObj.end.split("T")[0] : dateStart;
  const shoppingTimeJST = toJSTTimeStr(dateObj.start);

  return { id: pageId, title, dateStart, dateEnd, shoppingTimeJST };
}

// --- Events DB check ---

async function fetchEatingOutEvents(
  apiKey: string,
  startDate: string,
  endDate: string,
): Promise<string[]> {
  const dbConf = getScheduleDbConfigOptional("events");
  if (!dbConf) return [];
  const { dbId, config } = dbConf;
  const data = await queryDbByDateCached(
    apiKey,
    dbId,
    config,
    startDate,
    endDate,
  );
  const entries = normalizePages(data.results, config, "events");

  const eatingKeywords =
    /飲み|ランチ|ディナー|食事|ご飯|デート|新年会|忘年会|歓迎会|送別会/;
  return entries
    .filter((e) => eatingKeywords.test(e.title))
    .map((e) => {
      const date = e.start.split("T")[0];
      const weekday = getWeekday(date);
      return `${weekday} ${e.title}`;
    });
}

// --- Claude API ---

const SYSTEM_PROMPT = `あなたは買い出しリスト生成アシスタントです。
献立データから買い出しに必要な食材リストを構造化JSONで出力します。

## ルール

1. **カテゴリ分類**（この順番で出力）:
   - 肉・魚
   - 卵・乳製品
   - 豆腐・納豆
   - 野菜・果物
   - 主食
   - おやつ・その他

2. **量の見積もり**: 1人前で適切な量を推定（例: 肉150g、野菜1/2玉など）

3. **価格見積もり**: あおば食品の価格表を参考に。価格不明なら一般的なスーパーの相場で推定

4. **常備調味料（pantry）は除外**: 塩、胡椒、味噌、醤油、胡麻油など常備品はリストに入れない

5. **外食の食事は食材不要**: 「外食」と記載された食事の食材は買わない

6. **同じ食材はまとめる**: 複数の食事で使う同じ食材は1行にまとめ、用途を全て記載
   例: "豚バラ薄切り 300g（土昼 豚キムチ 150g / 火夜 重ね蒸し 150g）"

7. **冷凍メモ**: 買い出し日から2日以上先に使う肉・魚は冷凍メモに追加
   例: "豚バラ 150g → 小分けラップして冷凍（火夜 重ね蒸し用）"

8. **用途の記法**: 「曜日 + 食事名」で書く
   例: "（火昼 パスタ / 木夜 炒め物）"

9. **間食の食材も含める**: ヨーグルト、バナナ、ナッツなど間食の食材も忘れずにリストに入れる

10. **買い出し前の食事は除外**: 買い出し時刻が指定されている場合、買い出し当日でその時刻より前の食事（朝食など）の食材は買い出しリストに含めない。在庫・前回の買い出しで対応する前提

11. **冷蔵庫の在庫を考慮**: 冷蔵庫の在庫情報が提供されている場合、十分な量がある食材は買い出しリストから除外する（例: 卵が8個あり必要数が4個なら購入不要）

## 出力フォーマット

以下のJSON構造で出力してください（JSONのみ、他のテキスト不要）:

{
  "periodSummary": "土〜火の4日分",
  "estimatedTotal": "約 ¥3,000〜3,500",
  "eatingOutNotes": ["土夜 デート（外食）", "日夜 新年会（外食）"],
  "cookingNotes": ["自炊12食（朝4 / 昼4 / 間食4 / 夜2）"],
  "items": [
    {
      "category": "肉・魚",
      "name": "豚バラ薄切り",
      "quantity": "300g",
      "mealRefs": ["土昼 豚キムチ 150g", "火夜 重ね蒸し 150g"],
      "estimatedPrice": 500
    }
  ],
  "freezeMemos": [
    {
      "item": "豚バラ 150g",
      "instruction": "小分けラップして冷凍（火夜 重ね蒸し用）"
    }
  ]
}`;

function buildUserPrompt(
  meals: MealEntry[],
  eatingOutEvents: string[],
  pantry: string,
  prices: string,
  fridge: string,
  startDate: string,
  endDate: string,
  shoppingTimeJST: string | null,
): string {
  const sections: string[] = [];

  sections.push(`## 期間: ${startDate} 〜 ${endDate}`);
  sections.push(`買い出し日: ${startDate}（${getWeekday(startDate)}）`);
  if (shoppingTimeJST) {
    sections.push(
      `買い出し時刻: ${shoppingTimeJST}（この時刻より前の食事の食材は購入不要）`,
    );
  }

  // Meals by day
  sections.push("\n## 献立");
  const byDate = new Map<string, MealEntry[]>();
  for (const m of meals) {
    if (!byDate.has(m.date)) byDate.set(m.date, []);
    byDate.get(m.date)!.push(m);
  }

  for (const [date, dayMeals] of byDate) {
    const wd = getWeekday(date);
    sections.push(`\n### ${date}（${wd}）`);
    for (const m of dayMeals) {
      const marker = m.isEatingOut ? " 【外食】" : "";
      sections.push(`- ${m.meal}: ${m.menu}${marker}`);
    }
  }

  // Missing dates
  const dates = dateRange(startDate, endDate);
  const missingDates = dates.filter((d) => !byDate.has(d));
  if (missingDates.length > 0) {
    sections.push("\n### 献立未作成の日");
    for (const d of missingDates) {
      sections.push(`- ${d}（${getWeekday(d)}）— daily ファイルなし、スキップ`);
    }
  }

  // Eating out events
  if (eatingOutEvents.length > 0) {
    sections.push("\n## 外食イベント（events DB）");
    for (const e of eatingOutEvents) {
      sections.push(`- ${e}`);
    }
  }

  // Fridge inventory
  if (fridge) {
    sections.push("\n## 冷蔵庫の在庫（在庫がある食材は購入不要）");
    sections.push(fridge);
  }

  // Pantry
  sections.push("\n## 常備調味料（除外対象）");
  sections.push(pantry);

  // Prices
  sections.push("\n## あおば食品 価格参考");
  sections.push(prices);

  return sections.join("\n");
}

async function generateGroceryList(
  meals: MealEntry[],
  eatingOutEvents: string[],
  pantry: string,
  prices: string,
  fridge: string,
  startDate: string,
  endDate: string,
  shoppingTimeJST: string | null,
): Promise<GroceryListData> {
  const userPrompt = buildUserPrompt(
    meals,
    eatingOutEvents,
    pantry,
    prices,
    fridge,
    startDate,
    endDate,
    shoppingTimeJST,
  );

  const result = await callClaude([{ role: "user", content: userPrompt }], {
    system: SYSTEM_PROMPT,
    maxTokens: 4096,
  });

  // Extract JSON from response (might be wrapped in ```json ... ```)
  const jsonMatch = result.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error("Claude API response does not contain valid JSON");
  }

  return JSON.parse(jsonMatch[0]) as GroceryListData;
}

// --- Notion block building ---

function richText(text: string): any[] {
  return [{ type: "text", text: { content: text } }];
}

function styledText(
  segments: Array<{ text: string; bold?: boolean; color?: string }>,
): any[] {
  return segments.map((s) => ({
    type: "text",
    text: { content: s.text },
    annotations: {
      ...(s.bold && { bold: true }),
      ...(s.color && { color: s.color }),
    },
  }));
}

function buildCategoryBlock(cat: string, items: GroceryItem[]): any {
  const emoji = CATEGORY_EMOJI[cat] || "📦";
  const subtotal = items.reduce((sum, i) => sum + i.estimatedPrice, 0);

  const children = items.map((item) => {
    const refs =
      item.mealRefs.length > 0 ? ` （${item.mealRefs.join(" / ")}）` : "";
    return {
      object: "block",
      type: "to_do",
      to_do: {
        rich_text: styledText([
          { text: `${item.name} ${item.quantity}`, bold: true },
          ...(refs ? [{ text: refs, color: "gray" }] : []),
        ]),
        checked: false,
      },
    };
  });

  return {
    object: "block",
    type: "heading_3",
    heading_3: {
      rich_text: styledText([
        { text: `${emoji} ${cat}` },
        { text: `  ≒ ¥${subtotal.toLocaleString()}`, color: "gray" },
      ]),
      is_toggleable: true,
      children,
    },
  };
}

function buildNotionBlocks(data: GroceryListData): any[] {
  const blocks: any[] = [];

  // Summary callout (green background)
  const summaryParts: Array<{ text: string; bold?: boolean; color?: string }> =
    [{ text: `💰 ${data.estimatedTotal}`, bold: true }, { text: "\n" }];
  if (data.cookingNotes.length > 0) {
    summaryParts.push({ text: `🍳 ${data.cookingNotes.join(" / ")}` });
  }
  if (data.eatingOutNotes.length > 0) {
    summaryParts.push({ text: "\n" });
    summaryParts.push({ text: `🍽️ 外食: ${data.eatingOutNotes.join(" / ")}` });
  }
  blocks.push({
    object: "block",
    type: "callout",
    callout: {
      rich_text: styledText(summaryParts),
      icon: { type: "emoji", emoji: "🛒" },
      color: "green_background",
    },
  });

  // Divider
  blocks.push({ object: "block", type: "divider", divider: {} });

  // Group items by category
  const byCategory = new Map<string, GroceryItem[]>();
  for (const item of data.items) {
    if (!byCategory.has(item.category)) byCategory.set(item.category, []);
    byCategory.get(item.category)!.push(item);
  }

  // Categories in defined order (toggle heading_3 with children)
  for (const cat of CATEGORY_ORDER) {
    const items = byCategory.get(cat);
    if (!items || items.length === 0) continue;
    blocks.push(buildCategoryBlock(cat, items));
  }

  // Any categories not in CATEGORY_ORDER
  for (const [cat, items] of byCategory) {
    if (CATEGORY_ORDER.includes(cat)) continue;
    blocks.push(buildCategoryBlock(cat, items));
  }

  // Freeze memos
  if (data.freezeMemos.length > 0) {
    blocks.push({ object: "block", type: "divider", divider: {} });
    const freezeChildren = data.freezeMemos.map((memo) => ({
      object: "block",
      type: "bulleted_list_item",
      bulleted_list_item: {
        rich_text: styledText([
          { text: memo.item, bold: true },
          { text: ` → ${memo.instruction}` },
        ]),
      },
    }));
    blocks.push({
      object: "block",
      type: "callout",
      callout: {
        rich_text: richText("冷凍する食材"),
        icon: { type: "emoji", emoji: "🧊" },
        color: "blue_background",
        children: freezeChildren,
      },
    });
  }

  return blocks;
}

// --- Notion write operations ---

async function clearPageContent(
  apiKey: string,
  pageId: string,
): Promise<number> {
  const response = await notionFetch(apiKey, `/blocks/${pageId}/children`);
  const blocks = response.results || [];
  let deleted = 0;
  for (const block of blocks) {
    await notionFetch(apiKey, `/blocks/${block.id}`, undefined, "DELETE");
    deleted++;
  }
  return deleted;
}

async function appendBlocks(
  apiKey: string,
  pageId: string,
  blocks: any[],
): Promise<void> {
  // Notion API limits to 100 blocks per request
  const BATCH_SIZE = 100;
  for (let i = 0; i < blocks.length; i += BATCH_SIZE) {
    const batch = blocks.slice(i, i + BATCH_SIZE);
    await notionFetch(
      apiKey,
      `/blocks/${pageId}/children`,
      { children: batch },
      "PATCH",
    );
  }
}

// --- Dry run preview ---

function previewBlock(block: any, indent = ""): string {
  const lines: string[] = [];
  const type = block.type;
  const text =
    block[type]?.rich_text?.map((t: any) => t.text.content).join("") || "";
  const children: any[] = block[type]?.children || [];

  switch (type) {
    case "heading_2":
      lines.push(`${indent}## ${text}`);
      break;
    case "heading_3": {
      const toggle = block[type]?.is_toggleable ? "▶ " : "";
      lines.push(`${indent}${toggle}### ${text}`);
      break;
    }
    case "callout": {
      const icon = block[type]?.icon?.emoji || "💡";
      const color = block[type]?.color || "";
      lines.push(
        `${indent}${icon} [${color}] ${text.replace(/\n/g, `\n${indent}  `)}`,
      );
      break;
    }
    case "to_do":
      lines.push(`${indent}- [ ] ${text}`);
      break;
    case "bulleted_list_item":
      lines.push(`${indent}- ${text}`);
      break;
    case "divider":
      lines.push(`${indent}---`);
      break;
    default:
      lines.push(`${indent}[${type}] ${text}`);
  }

  for (const child of children) {
    lines.push(previewBlock(child, indent + "  "));
  }

  return lines.join("\n");
}

function previewBlocks(blocks: any[]): string {
  return blocks.map((b) => previewBlock(b)).join("\n");
}

// --- Main ---

async function main() {
  const { flags, opts } = parseArgs();
  const dryRun = flags.has("dry-run");
  const pageId = opts["page-id"];
  const date = opts.date;

  if (!pageId && !date) {
    console.error("Usage:");
    console.error("  bun run scripts/notion-grocery-gen.ts --page-id <id>");
    console.error("  bun run scripts/notion-grocery-gen.ts --date 2026-02-17");
    console.error(
      "  bun run scripts/notion-grocery-gen.ts --date 2026-02-17 --dry-run",
    );
    process.exit(1);
  }

  const apiKey = getApiKey();

  // 1. Find groceries page
  console.log("Groceries page ...");
  const page = pageId
    ? await getPageDateRange(apiKey, pageId)
    : await findGroceriesPage(apiKey, date!);

  console.log(`  Page: ${page.title} (${page.id})`);
  console.log(`  Range: ${page.dateStart} ~ ${page.dateEnd}`);

  // 2. Get date range
  const dates = dateRange(page.dateStart, page.dateEnd);
  console.log(
    `  Days: ${dates.map((d) => `${d}(${getWeekday(d)})`).join(", ")}`,
  );

  if (page.shoppingTimeJST) {
    console.log(`  Shopping time: ${page.shoppingTimeJST} JST`);
  }

  // 3. Collect data (parallel)
  console.log("Collecting data ...");
  const [eatingOutEvents, pantry, prices, fridge] = await Promise.all([
    fetchEatingOutEvents(apiKey, page.dateStart, page.dateEnd),
    Promise.resolve(loadPantry()),
    Promise.resolve(loadAobaPrices()),
    Promise.resolve(loadFridge()),
  ]);
  if (fridge) {
    console.log("  Fridge inventory loaded");
  }

  // Parse daily meals
  const allMeals: MealEntry[] = [];
  for (const d of dates) {
    const dailyPath = join(DIET_DIR, "daily", `${d}.md`);
    if (existsSync(dailyPath)) {
      const content = readFileSync(dailyPath, "utf-8");
      allMeals.push(...parseDailyMeals(d, content));
    } else {
      console.log(`  Warning: ${d} (${getWeekday(d)}) daily file not found`);
    }
  }

  console.log(
    `  Meals: ${allMeals.length} (eating out: ${allMeals.filter((m) => m.isEatingOut).length})`,
  );
  if (eatingOutEvents.length > 0) {
    console.log(`  Events: ${eatingOutEvents.join(", ")}`);
  }

  // 4. Call Claude API
  console.log("Generating grocery list via Claude API ...");
  const groceryData = await generateGroceryList(
    allMeals,
    eatingOutEvents,
    pantry,
    prices,
    fridge,
    page.dateStart,
    page.dateEnd,
    page.shoppingTimeJST,
  );

  // 5. Build Notion blocks
  const blocks = buildNotionBlocks(groceryData);
  console.log(`  Blocks: ${blocks.length}`);

  // 6. Output
  if (dryRun) {
    console.log("\n--- Preview (dry-run) ---\n");
    console.log(previewBlocks(blocks));
    console.log("\n--- JSON ---\n");
    console.log(JSON.stringify(groceryData, null, 2));
    return;
  }

  // Write to Notion
  console.log("Writing to Notion ...");
  const deletedCount = await clearPageContent(apiKey, page.id);
  console.log(`  Deleted ${deletedCount} existing blocks`);

  await appendBlocks(apiKey, page.id, blocks);
  console.log(`  Added ${blocks.length} blocks`);

  console.log(`Done: ${page.title}`);
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
