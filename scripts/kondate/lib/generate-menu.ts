import { callLLM } from "../../lib/llm";
import type { Slot } from "./empty-slots";

export interface PastMeal {
  date: string;
  title: string;
}

export interface Ingredient {
  name: string;
  amount: string;
}

export interface MenuResult {
  menu_name: string;
  cuisine: "和" | "洋" | "中";
  recipe_url: string;
  ingredients: Ingredient[];
  missing_ingredients: Ingredient[];
  steps: string[];
  estimated_pfc: {
    p: number;
    f: number;
    c: number;
    kcal: number;
  };
}

export interface MenuContext {
  pastMeals: PastMeal[];
  historyMenus: string[];
  fridge: string;
  nutritionTargets: string;
  ngIngredients: string[];
  emptySlots: Slot[];
}

export function buildPrompt(ctx: MenuContext): string {
  const slots = ctx.emptySlots.slice(0, 3);
  const slotLines = slots
    .map((s) => `  - ${s.date} ${s.mealType} ${s.start}〜${s.end}`)
    .join("\n");

  const pastMealLines = ctx.pastMeals
    .map((m) => `  - ${m.date}: ${m.title}`)
    .join("\n");

  const historyLines = ctx.historyMenus.map((m) => `  - ${m}`).join("\n");

  const ngLines = ctx.ngIngredients.map((i) => `  - ${i}`).join("\n");

  return `あなたは優秀な料理プランナーです。以下の条件に従って、1品の主菜を提案してください。

## 優先順位
美味しさ > 栄養バランス > 在庫消化

## レシピ参照元（以下のサイトから選ぶこと）
- クラシル
- 白ごはん.com
- Nadia
- DELISH KITCHEN

## 料理ジャンル
和/洋/中 のいずれかのみ。エスニック料理は除外すること。

## 空きスロット（このうち1食分を提案）
${slotLines}

## 過去14日間の食事（重複を避ける）
${pastMealLines}

## 過去の献立履歴（重複を避ける）
${historyLines}

## 冷蔵庫の在庫
${ctx.fridge}

## 栄養目標
${ctx.nutritionTargets}

## 使用禁止食材（NG）
${ngLines}

## 不足食材の判定（厳守）
\`ingredients\` の各食材を「冷蔵庫の在庫」と突き合わせ、在庫に**ない**ものだけを \`missing_ingredients\` に列挙してください。
- 醤油・みりん・酒・砂糖・塩・胡椒・ごま油・サラダ油・酢・味噌など**常備調味料は除外**（冷蔵庫の在庫に書かれていなくても買い出しに入れない）
- 在庫の数量が不足している場合も missing に含める
- 全部在庫にある場合は \`missing_ingredients: []\` を返す

## 出力形式
以下の JSON 形式で回答してください（他のテキストは不要）:
\`\`\`json
{
  "menu_name": "料理名",
  "cuisine": "和 | 洋 | 中",
  "recipe_url": "https://...",
  "ingredients": [
    { "name": "食材名", "amount": "分量" }
  ],
  "missing_ingredients": [
    { "name": "食材名", "amount": "必要量" }
  ],
  "steps": ["手順1", "手順2"],
  "estimated_pfc": {
    "p": 数値(g),
    "f": 数値(g),
    "c": 数値(g),
    "kcal": 数値
  }
}
\`\`\`
`;
}

export function parseMenuResponse(raw: string): MenuResult {
  // Strip markdown code fence if present
  let cleaned = raw.trim();
  if (cleaned.startsWith("```")) {
    // Remove opening fence (```json or ```)
    cleaned = cleaned.replace(/^```(?:json)?\n?/, "");
    // Remove closing fence
    cleaned = cleaned.replace(/\n?```\s*$/, "");
    cleaned = cleaned.trim();
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error(`Invalid JSON response: ${cleaned.slice(0, 100)}`);
  }

  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("Response is not a JSON object");
  }

  const obj = parsed as Record<string, unknown>;

  if (!obj.menu_name || typeof obj.menu_name !== "string") {
    throw new Error("Missing required field: menu_name");
  }

  const validCuisines = ["和", "洋", "中"];
  if (!obj.cuisine || typeof obj.cuisine !== "string") {
    throw new Error("Missing required field: cuisine");
  }
  if (obj.cuisine === "エスニック") {
    throw new Error("エスニック料理は禁止されています");
  }
  if (!validCuisines.includes(obj.cuisine)) {
    throw new Error(`Invalid cuisine: ${obj.cuisine}. Must be one of 和/洋/中`);
  }

  if (!obj.recipe_url || typeof obj.recipe_url !== "string") {
    throw new Error("Missing required field: recipe_url");
  }

  if (!Array.isArray(obj.ingredients)) {
    throw new Error("Missing required field: ingredients (must be an array)");
  }

  if (!Array.isArray(obj.steps)) {
    throw new Error("Missing required field: steps (must be an array)");
  }

  if (!obj.estimated_pfc || typeof obj.estimated_pfc !== "object") {
    throw new Error("Missing required field: estimated_pfc");
  }

  const missing = Array.isArray(obj.missing_ingredients)
    ? (obj.missing_ingredients as Ingredient[])
    : [];

  return {
    menu_name: obj.menu_name,
    cuisine: obj.cuisine as "和" | "洋" | "中",
    recipe_url: obj.recipe_url,
    ingredients: obj.ingredients as Ingredient[],
    missing_ingredients: missing,
    steps: obj.steps as string[],
    estimated_pfc: obj.estimated_pfc as MenuResult["estimated_pfc"],
  };
}

export async function generateMenu(ctx: MenuContext): Promise<MenuResult> {
  const prompt = buildPrompt(ctx);
  const raw = await callLLM(
    [{ role: "user", content: prompt }],
    {
      model: "claude-opus-4-7",
      maxTokens: 2048,
    },
  );
  return parseMenuResponse(raw);
}
