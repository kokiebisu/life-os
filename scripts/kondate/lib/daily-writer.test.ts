import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { appendDailyMealEntry, mealTypeToSection } from "./daily-writer";
import type { MenuResult } from "./generate-menu";

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "daily-"));
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

const menu: MenuResult = {
  menu_name: "鶏むねハム",
  cuisine: "和",
  recipe_url: "https://example.com",
  ingredients: [
    { name: "鶏むね肉", amount: "300g" },
    { name: "塩", amount: "小さじ1" },
  ],
  missing_ingredients: [],
  steps: ["下味", "茹でる"],
  estimated_pfc: { p: 40, f: 8, c: 2, kcal: 220 },
};

describe("mealTypeToSection", () => {
  test("朝 → 朝食", () => {
    expect(mealTypeToSection("朝")).toBe("朝食");
  });
  test("昼 → 昼食", () => {
    expect(mealTypeToSection("昼")).toBe("昼食");
  });
  test("晩 → 夕食", () => {
    expect(mealTypeToSection("晩")).toBe("夕食");
  });
});

describe("appendDailyMealEntry", () => {
  test("creates new file with date header and meal section", () => {
    const path = join(tmp, "2026-04-24.md");
    appendDailyMealEntry({
      date: "2026-04-24",
      mealType: "晩",
      start: "19:00",
      end: "20:00",
      menu,
      baseDir: tmp,
    });
    expect(existsSync(path)).toBe(true);
    const content = readFileSync(path, "utf-8");
    expect(content).toContain("# 2026-04-24");
    expect(content).toContain("## 夕食 19:00-20:00");
    expect(content).toContain("鶏むねハム");
    expect(content).toContain("鶏むね肉 300g");
    expect(content).toContain("P: 40g");
  });

  test("appends new meal section to existing file", () => {
    const path = join(tmp, "2026-04-24.md");
    writeFileSync(path, "# 2026-04-24\n\n## 朝食 08:00-09:00\nオートミール\n- オートミール 40g\n");
    appendDailyMealEntry({
      date: "2026-04-24",
      mealType: "晩",
      start: "19:00",
      end: "20:00",
      menu,
      baseDir: tmp,
    });
    const content = readFileSync(path, "utf-8");
    expect(content).toContain("## 朝食 08:00-09:00");
    expect(content).toContain("## 夕食 19:00-20:00");
    expect(content).toContain("鶏むねハム");
  });

  test("does not overwrite existing meal section", () => {
    const path = join(tmp, "2026-04-24.md");
    writeFileSync(
      path,
      "# 2026-04-24\n\n## 夕食 19:00-20:00\n外食\n- ラーメン\n",
    );
    appendDailyMealEntry({
      date: "2026-04-24",
      mealType: "晩",
      start: "19:00",
      end: "20:00",
      menu,
      baseDir: tmp,
    });
    const content = readFileSync(path, "utf-8");
    expect(content).toContain("外食");
    expect(content).toContain("ラーメン");
    expect(content).not.toContain("鶏むねハム");
  });
});
