import { describe, test, expect } from "bun:test";
import { buildPrompt, parseMenuResponse, type MenuContext, type MenuResult } from "./generate-menu";

const baseContext: MenuContext = {
  pastMeals: [
    { date: "2026-04-22", title: "鶏むね蒸し" },
    { date: "2026-04-20", title: "鮭の塩焼き" },
  ],
  historyMenus: ["豚こま生姜焼き", "鮭の塩焼き"],
  fridge: "鶏むね肉 1枚\nキャベツ 1/2",
  nutritionTargets: "P: 920g/週 ...",
  ngIngredients: ["トマト", "マヨネーズ"],
  emptySlots: [
    { date: "2026-04-24", mealType: "朝", start: "08:00", end: "09:00" },
    { date: "2026-04-24", mealType: "昼", start: "12:00", end: "13:00" },
    { date: "2026-04-24", mealType: "晩", start: "19:00", end: "20:00" },
  ],
};

describe("buildPrompt", () => {
  test("includes priority ordering 美味しさ > 栄養 > 在庫", () => {
    const prompt = buildPrompt(baseContext);
    expect(prompt).toContain("美味しさ > 栄養バランス > 在庫消化");
  });

  test("lists recipe sources", () => {
    const prompt = buildPrompt(baseContext);
    expect(prompt).toContain("クラシル");
    expect(prompt).toContain("白ごはん.com");
    expect(prompt).toContain("Nadia");
    expect(prompt).toContain("DELISH KITCHEN");
  });

  test("excludes エスニック cuisine", () => {
    const prompt = buildPrompt(baseContext);
    expect(prompt).toContain("和/洋/中");
    expect(prompt).toContain("エスニック");
    expect(prompt).toMatch(/エスニック.*(除外|禁止|避け)/);
  });

  test("lists past 14 days proteins to avoid", () => {
    const prompt = buildPrompt(baseContext);
    expect(prompt).toContain("鶏むね蒸し");
    expect(prompt).toContain("鮭の塩焼き");
  });

  test("lists history menus to avoid duplication", () => {
    const prompt = buildPrompt(baseContext);
    expect(prompt).toContain("豚こま生姜焼き");
  });

  test("lists NG ingredients", () => {
    const prompt = buildPrompt(baseContext);
    expect(prompt).toContain("トマト");
    expect(prompt).toContain("マヨネーズ");
  });

  test("requests JSON output", () => {
    const prompt = buildPrompt(baseContext);
    expect(prompt).toContain("JSON");
    expect(prompt).toContain("menu_name");
    expect(prompt).toContain("cuisine");
    expect(prompt).toContain("recipe_url");
  });

  test("instructs the model to compute missing_ingredients", () => {
    const prompt = buildPrompt(baseContext);
    expect(prompt).toContain("missing_ingredients");
    expect(prompt).toContain("常備調味料は除外");
  });
});

describe("parseMenuResponse", () => {
  test("parses valid JSON response", () => {
    const response = JSON.stringify({
      menu_name: "豚の生姜焼き",
      cuisine: "和",
      recipe_url: "https://www.kurashiru.com/recipes/xxx",
      ingredients: [{ name: "豚こま", amount: "300g" }],
      missing_ingredients: [{ name: "生姜", amount: "1片" }],
      steps: ["step1", "step2"],
      estimated_pfc: { p: 25, f: 15, c: 20, kcal: 350 },
    });
    const result = parseMenuResponse(response);
    expect(result.menu_name).toBe("豚の生姜焼き");
    expect(result.cuisine).toBe("和");
    expect(result.ingredients).toHaveLength(1);
    expect(result.missing_ingredients).toHaveLength(1);
    expect(result.missing_ingredients[0]?.name).toBe("生姜");
  });

  test("defaults missing_ingredients to empty array when omitted", () => {
    const response = JSON.stringify({
      menu_name: "オートミール",
      cuisine: "洋",
      recipe_url: "https://example.com/oats",
      ingredients: [{ name: "オートミール", amount: "40g" }],
      steps: ["step1"],
      estimated_pfc: { p: 5, f: 2, c: 25, kcal: 150 },
    });
    const result = parseMenuResponse(response);
    expect(result.missing_ingredients).toEqual([]);
  });

  test("parses JSON wrapped in markdown code fence", () => {
    const response = "```json\n" + JSON.stringify({
      menu_name: "鮭の塩焼き",
      cuisine: "和",
      recipe_url: "https://example.com/a",
      ingredients: [],
      steps: [],
      estimated_pfc: { p: 30, f: 10, c: 5, kcal: 250 },
    }) + "\n```";
    const result = parseMenuResponse(response);
    expect(result.menu_name).toBe("鮭の塩焼き");
  });

  test("throws on invalid JSON", () => {
    expect(() => parseMenuResponse("not json")).toThrow();
  });

  test("throws when menu_name is missing", () => {
    const response = JSON.stringify({ cuisine: "和" });
    expect(() => parseMenuResponse(response)).toThrow(/menu_name/);
  });

  test("throws when cuisine is エスニック", () => {
    const response = JSON.stringify({
      menu_name: "パッタイ",
      cuisine: "エスニック",
      recipe_url: "https://example.com",
      ingredients: [],
      steps: [],
      estimated_pfc: { p: 20, f: 10, c: 30, kcal: 300 },
    });
    expect(() => parseMenuResponse(response)).toThrow(/エスニック/);
  });
});
