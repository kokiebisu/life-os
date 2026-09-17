#!/usr/bin/env bun
/**
 * /kondate 自動化
 *
 * 毎朝 GitHub Actions から呼ばれる。今日〜3日後の meals エントリーが 2 件以下なら
 * 作り置きメニューを Claude API で生成し、Notion meals DB に登録する。
 *
 * 使い方:
 *   bun run scripts/kondate/kondate-auto.ts            # 本番実行
 *   bun run scripts/kondate/kondate-auto.ts --dry-run  # 登録せずログのみ
 */

import { existsSync, readFileSync } from "fs";
import { join, resolve } from "path";
import { spawnSync } from "child_process";
import { fileURLToPath } from "url";

import {
  getScheduleDbConfig,
  queryDbByDateCached,
  normalizePages,
  todayJST,
  parseArgs,
} from "../notion/lib/notion";
import { computeEmptySlots, type ExistingEntry, type Slot } from "./lib/empty-slots";
import { readHistory, appendHistoryEntry } from "./lib/menu-history";
import { generateMenu, type MenuContext, type MenuResult, type PastMeal } from "./lib/generate-menu";
import { appendDailyMealEntry } from "./lib/daily-writer";
import { decideGroceryDateTime, formatGroceryTitle } from "./lib/grocery-schedule";

const REPO_ROOT = resolve(fileURLToPath(import.meta.url), "../../..");
const DISABLE_FLAG = join(REPO_ROOT, ".kondate-auto.disabled");
const HISTORY_PATH = join(REPO_ROOT, "aspects/diet/kondate-history.md");
const FRIDGE_PATH = join(REPO_ROOT, "aspects/diet/fridge.md");
const NUTRITION_PATH = join(REPO_ROOT, "aspects/diet/nutrition-targets.md");
const DAILY_DIR = join(REPO_ROOT, "aspects/diet/daily");

const NG_INGREDIENTS = ["トマト", "マヨネーズ", "ケチャップ", "マスタード"];
const WINDOW_DAYS = 3;
const ENTRY_THRESHOLD = 5; // 5件以上でスキップ
const SERVINGS = 3;

function addDays(dateStr: string, n: number): string {
  const d = new Date(dateStr + "T12:00:00+09:00");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function readOrEmpty(path: string): string {
  return existsSync(path) ? readFileSync(path, "utf-8") : "";
}

async function fetchMealsRange(startDate: string, endDate: string) {
  const { apiKey, dbId, config } = getScheduleDbConfig("meals");
  const data = await queryDbByDateCached(apiKey, dbId, config, startDate, endDate);
  return normalizePages(data.results, config, "meals");
}

function extractStartTime(iso: string | undefined): string {
  if (!iso || !iso.includes("T")) return "";
  return new Date(iso).toLocaleTimeString("ja-JP", {
    timeZone: "Asia/Tokyo",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function runNotionAdd(args: {
  title: string;
  date: string;
  start: string;
  end: string;
  servings: number;
}): { pageId?: string; url?: string } {
  const cmd = [
    "bun",
    "run",
    "scripts/notion/notion-add.ts",
    "--db",
    "meals",
    "--title",
    args.title,
    "--date",
    args.date,
    "--start",
    args.start,
    "--end",
    args.end,
    "--servings",
    String(args.servings),
  ];
  const result = spawnSync(cmd[0], cmd.slice(1), {
    cwd: REPO_ROOT,
    encoding: "utf-8",
  });
  if (result.status !== 0) {
    throw new Error(`notion-add failed: ${result.stderr || result.stdout}`);
  }
  const pageIdMatch = /page.*id[:\s]+([a-f0-9-]{36})/i.exec(result.stdout);
  const urlMatch = /(https:\/\/(?:www\.)?notion\.so\/[^\s]+)/.exec(result.stdout);
  return {
    pageId: pageIdMatch?.[1],
    url: urlMatch?.[1],
  };
}

function runGroceryAdd(args: {
  date: string;
  start: string;
  end: string;
}): void {
  const cmd = [
    "bun",
    "run",
    "scripts/notion/notion-add.ts",
    "--db",
    "groceries",
    "--title",
    formatGroceryTitle(args.date),
    "--date",
    args.date,
    "--start",
    args.start,
    "--end",
    args.end,
  ];
  const result = spawnSync(cmd[0], cmd.slice(1), {
    cwd: REPO_ROOT,
    encoding: "utf-8",
  });
  if (result.status !== 0) {
    throw new Error(`grocery notion-add failed: ${result.stderr || result.stdout}`);
  }
}

function runGroceryGen(args: { date: string; endDate: string }): void {
  const cmd = [
    "bun",
    "run",
    "scripts/notion/notion-grocery-gen.ts",
    "--date",
    args.date,
    "--end-date",
    args.endDate,
  ];
  const result = spawnSync(cmd[0], cmd.slice(1), {
    cwd: REPO_ROOT,
    encoding: "utf-8",
  });
  if (result.status !== 0) {
    throw new Error(`grocery-gen failed: ${result.stderr || result.stdout}`);
  }
}

async function main() {
  const { flags } = parseArgs();
  const dryRun = flags.has("dry-run");

  // 0. Disable switch
  if (existsSync(DISABLE_FLAG)) {
    console.log("[skip] .kondate-auto.disabled exists");
    return;
  }

  const today = todayJST();
  const endDate = addDays(today, WINDOW_DAYS - 1);

  // 1. Trigger check
  const existing = await fetchMealsRange(today, endDate);
  console.log(`[check] ${today}..${endDate}: ${existing.length} entries`);
  if (existing.length >= ENTRY_THRESHOLD) {
    console.log(`[skip] ${existing.length} >= ${ENTRY_THRESHOLD} entries`);
    return;
  }

  // 2. Compute empty slots
  const existingEntries: ExistingEntry[] = existing.map((e) => ({
    date: e.start.slice(0, 10),
    startTime: extractStartTime(e.start),
  }));
  const emptySlots = computeEmptySlots(today, WINDOW_DAYS, existingEntries);
  if (emptySlots.length === 0) {
    console.log("[skip] no empty slots");
    return;
  }
  const targetSlots = emptySlots.slice(0, Math.min(SERVINGS, emptySlots.length));
  console.log(`[slots] filling ${targetSlots.length} slots:`, targetSlots);

  // 3. Gather context
  const past14Start = addDays(today, -14);
  const past14End = addDays(today, -1);
  const pastMealsData = await fetchMealsRange(past14Start, past14End);
  const pastMeals: PastMeal[] = pastMealsData.map((m) => ({
    date: m.start.slice(0, 10),
    title: m.title,
  }));
  const history = readHistory(HISTORY_PATH);
  const historyMenus = history.map((h) => h.menu);

  const ctx: MenuContext = {
    pastMeals,
    historyMenus,
    fridge: readOrEmpty(FRIDGE_PATH),
    nutritionTargets: readOrEmpty(NUTRITION_PATH),
    ngIngredients: NG_INGREDIENTS,
    emptySlots: targetSlots,
  };

  // 4. Generate menu
  console.log("[generate] calling Claude API...");
  const menu = await generateMenu(ctx);
  console.log(`[generated] ${menu.menu_name} (${menu.cuisine}) → ${menu.recipe_url}`);
  if (menu.missing_ingredients.length > 0) {
    console.log(
      `[missing] ${menu.missing_ingredients.map((m) => `${m.name} ${m.amount}`).join(", ")}`,
    );
  } else {
    console.log("[missing] (none — all ingredients in fridge)");
  }

  if (dryRun) {
    console.log("[dry-run] skipping Notion registration and history update");
    return;
  }

  // 5. Idempotency re-check
  const recheck = await fetchMealsRange(today, endDate);
  if (recheck.length >= ENTRY_THRESHOLD) {
    console.log(`[skip] re-check: ${recheck.length} >= ${ENTRY_THRESHOLD} (race)`);
    return;
  }

  // 6. Register in Notion + daily file (N servings across slots)
  const results: Array<{ slot: Slot; url?: string }> = [];
  for (const slot of targetSlots) {
    const r = runNotionAdd({
      title: menu.menu_name,
      date: slot.date,
      start: slot.start,
      end: slot.end,
      servings: SERVINGS,
    });
    results.push({ slot, url: r.url });
    appendDailyMealEntry({
      date: slot.date,
      mealType: slot.mealType,
      start: slot.start,
      end: slot.end,
      menu,
      baseDir: DAILY_DIR,
    });
  }

  // 7. Append history (first URL as representative)
  const repUrl = results.find((r) => r.url)?.url ?? "";
  appendHistoryEntry(HISTORY_PATH, {
    date: today,
    menu: menu.menu_name,
    url: repUrl,
    cuisine: menu.cuisine,
  });

  console.log(`[done] registered ${results.length} entries`);

  // 8. Register groceries page if any ingredient is missing from fridge
  if (menu.missing_ingredients.length === 0) {
    console.log("[groceries] no missing ingredients, skipping");
    return;
  }
  const sortedDates = [...new Set(targetSlots.map((s) => s.date))].sort();
  const firstCookingDate = sortedDates[0]!;
  const lastCookingDate = sortedDates[sortedDates.length - 1]!;
  const grocery = decideGroceryDateTime(firstCookingDate, today);
  console.log(
    `[groceries] missing: ${menu.missing_ingredients.map((m) => m.name).join(", ")}`,
  );
  console.log(
    `[groceries] adding page: ${grocery.date} ${grocery.start}-${grocery.end}`,
  );
  runGroceryAdd(grocery);
  console.log(
    `[groceries] generating list for ${grocery.date}..${lastCookingDate}`,
  );
  runGroceryGen({ date: grocery.date, endDate: lastCookingDate });
  console.log("[groceries] done");
}

main().catch((e) => {
  console.error("[error]", e);
  process.exit(1);
});
