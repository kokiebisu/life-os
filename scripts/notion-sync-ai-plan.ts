#!/usr/bin/env bun
/**
 * AI デイリープラン → Notion ルーティン同期（クリーンスレート方式）
 *
 * AI 生成のデイリープラン markdown から 🔹（ルーティン）エントリを抽出し、
 * 既存の未完了ルーティンを削除してからクリーンに登録する。
 *
 * 特殊処理:
 *   - ギター練習 → guitar DB の次の Lesson に日付セット
 *   - ジム → A/B ローテーション判定 + メニューブロック付き
 *
 * 使い方:
 *   bun run scripts/notion-sync-ai-plan.ts --date 2026-02-20
 *   bun run scripts/notion-sync-ai-plan.ts --date 2026-02-20 --dry-run
 */

import { readFileSync, existsSync } from "fs";
import { join } from "path";
import {
  getScheduleDbConfig, notionFetch, parseArgs, todayJST,
  pickTaskIcon, pickCover, queryDbByDate, normalizePages,
  clearNotionCache,
} from "./lib/notion";

const ROOT = join(import.meta.dir, "..");

const GUITAR_LABEL = "ギター練習";
const GYM_LABEL = "ジム";

// --- Types & Helpers ---

interface ScheduleJsonRoutine {
  label: string;
  [key: string]: unknown;
}

interface PlanEntry {
  start: string; // "09:00"
  end: string;   // "09:30"
  label: string; // "読書"
}

function loadRoutineLabels(): string[] {
  const configPath = join(ROOT, "aspects", "devotion", "schedule.json");
  if (!existsSync(configPath)) return [];
  const config = JSON.parse(readFileSync(configPath, "utf-8"));
  return (config.routines || []).map((r: ScheduleJsonRoutine) => r.label.toLowerCase());
}

function isRoutineLabel(label: string, routineLabels: string[]): boolean {
  const normalized = label.toLowerCase();
  return routineLabels.some(
    (r) => normalized.startsWith(r) || r.startsWith(normalized),
  );
}

function getTimeFromISO(iso: string): string {
  return iso.match(/T(\d{2}:\d{2})/)?.[1] || "00:00";
}

function parseDailyPlan(filePath: string): PlanEntry[] {
  const content = readFileSync(filePath, "utf-8");
  const entries: PlanEntry[] = [];

  for (const line of content.split("\n")) {
    // Table format: | 09:00-09:30 | 🔹 | 読書 |
    const tableMatch = line.match(
      /\|\s*(\d{2}:\d{2})-(\d{2}:\d{2})\s*\|\s*🔹\s*\|\s*(.+?)\s*\|/,
    );
    if (tableMatch) {
      entries.push({
        start: tableMatch[1],
        end: tableMatch[2],
        label: tableMatch[3].trim(),
      });
      continue;
    }

    // Plain format: 09:00-09:30  🔹 読書
    const plainMatch = line.match(/(\d{2}:\d{2})-(\d{2}:\d{2})\s+🔹\s+(.+)/);
    if (plainMatch) {
      entries.push({
        start: plainMatch[1],
        end: plainMatch[2],
        label: plainMatch[3].trim(),
      });
    }
  }

  return entries;
}

// --- Phase 1: Clean Slate ---

async function cleanExistingRoutines(date: string, dryRun: boolean): Promise<number> {
  const { apiKey, dbId, config } = getScheduleDbConfig("devotion");
  const data = await queryDbByDate(apiKey, dbId, config, date, date);
  const existing = normalizePages(data.results, config, "devotion");

  let deleted = 0;
  for (const entry of existing) {
    if (entry.status === "Done" || entry.status === "完了") continue;
    const time = entry.start.includes("T") ? getTimeFromISO(entry.start) : "?";
    const endTime = entry.end ? getTimeFromISO(entry.end) : "?";
    console.log(`  CLEAN: ${entry.title} ${time}-${endTime}`);
    if (!dryRun) {
      await notionFetch(apiKey, `/pages/${entry.id}`, { archived: true }, "PATCH");
    }
    deleted++;
  }

  return deleted;
}

// --- Curriculum (Guitar/Sound) Handling ---

async function findNextLesson(dbName: "guitar" | "sound" = "guitar"): Promise<{ id: string; title: string } | null> {
  const { apiKey, dbId, config } = getScheduleDbConfig(dbName);
  const filters: Record<string, unknown>[] = [
    { property: "名前", title: { starts_with: "Lesson" } },
    { property: "日付", date: { is_empty: true } },
    { property: "ステータス", status: { does_not_equal: "完了" } },
  ];
  if (config.extraFilter) filters.push(config.extraFilter);
  const resp = await notionFetch(apiKey, "/databases/" + dbId + "/query", {
    filter: { and: filters },
    sorts: [{ property: "名前", direction: "ascending" }],
    page_size: 1,
  });
  const page = resp.results?.[0];
  if (!page) return null;
  const title = page.properties?.["名前"]?.title?.[0]?.plain_text || "";
  return { id: page.id, title };
}

async function findExistingCurriculumEntry(dbName: "guitar" | "sound", date: string): Promise<{ id: string; title: string } | null> {
  const { apiKey, dbId, config } = getScheduleDbConfig(dbName);
  const data = await queryDbByDate(apiKey, dbId, config, date, date);
  const entries = normalizePages(data.results, config, dbName);
  if (entries.length > 0) return { id: entries[0].id, title: entries[0].title };
  return null;
}

// --- Gym Handling ---

async function getGymSessionCount(date: string): Promise<number> {
  const d = new Date(date + "T12:00:00+09:00");
  const day = d.getDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  const monday = new Date(d);
  monday.setDate(d.getDate() + mondayOffset);
  const weekStart = monday.toISOString().slice(0, 10);

  const { apiKey, dbId } = getScheduleDbConfig("devotion");
  const resp = await notionFetch(apiKey, "/databases/" + dbId + "/query", {
    filter: {
      and: [
        { property: "Name", title: { starts_with: GYM_LABEL } },
        { property: "日付", date: { on_or_after: weekStart } },
        { property: "日付", date: { before: date } },
      ],
    },
  });
  return resp.results?.length || 0;
}

function gymMenuBlocks(menuType: "A" | "B"): unknown[] {
  if (menuType === "A") {
    return [
      {
        type: "callout",
        callout: {
          rich_text: [
            { type: "text", text: { content: "A日: マシン筋トレ + ウォーキング（50分）" }, annotations: { bold: true } },
          ],
          icon: { type: "emoji", emoji: "💪" },
          color: "blue_background",
        },
      },
      { type: "divider", divider: {} },
      {
        type: "heading_3",
        heading_3: { rich_text: [{ type: "text", text: { content: "🏃 インクライン・ウォーキング（20分）" } }] },
      },
      {
        type: "quote",
        quote: { rich_text: [{ type: "text", text: { content: "ウォームアップ兼有酸素。傾斜を上げて歩くだけ。走らなくていい。" } }] },
      },
      {
        type: "bulleted_list_item",
        bulleted_list_item: { rich_text: [
          { type: "text", text: { content: "傾斜" }, annotations: { bold: true } },
          { type: "text", text: { content: " 10〜12% / " } },
          { type: "text", text: { content: "速度" }, annotations: { bold: true } },
          { type: "text", text: { content: " 5〜6 km/h / " } },
          { type: "text", text: { content: "心拍数" }, annotations: { bold: true } },
          { type: "text", text: { content: " 120〜140bpm" } },
        ] },
      },
      { type: "divider", divider: {} },
      {
        type: "heading_3",
        heading_3: { rich_text: [{ type: "text", text: { content: "🏋️ マシン筋トレ（30分）" } }] },
      },
      {
        type: "quote",
        quote: { rich_text: [{ type: "text", text: { content: "各種目の間に60秒休憩。15回3セットが楽にできたら次回から重量UP。" } }] },
      },
      {
        type: "to_do",
        to_do: { rich_text: [
          { type: "text", text: { content: "ベンチプレス 3×15" }, annotations: { bold: true } },
          { type: "text", text: { content: "  — バーのみ(20kg)〜。セーフティバー必須。胸に下ろして押し上げる" } },
        ], checked: false },
      },
      {
        type: "to_do",
        to_do: { rich_text: [
          { type: "text", text: { content: "ラットプルダウン 3×15" }, annotations: { bold: true } },
          { type: "text", text: { content: "  — 15kg〜。バーを鎖骨まで引き下ろす。肘を脇腹に向かって引く意識" } },
        ], checked: false },
      },
      {
        type: "to_do",
        to_do: { rich_text: [
          { type: "text", text: { content: "レッグプレス 3×15" }, annotations: { bold: true } },
          { type: "text", text: { content: "  — 30kg〜。膝を伸ばしきらない。足の裏全体で押す" } },
        ], checked: false },
      },
      {
        type: "to_do",
        to_do: { rich_text: [
          { type: "text", text: { content: "アブドミナル 3×15" }, annotations: { bold: true } },
          { type: "text", text: { content: "  — おへそを覗き込むように丸める。腕で引っ張らない" } },
        ], checked: false },
      },
    ];
  } else {
    return [
      {
        type: "callout",
        callout: {
          rich_text: [
            { type: "text", text: { content: "B日: ウォーキングのみ（40分）" }, annotations: { bold: true } },
          ],
          icon: { type: "emoji", emoji: "🏃" },
          color: "green_background",
        },
      },
      { type: "divider", divider: {} },
      {
        type: "heading_3",
        heading_3: { rich_text: [{ type: "text", text: { content: "🏃 インクライン・ウォーキング（40分）" } }] },
      },
      {
        type: "quote",
        quote: { rich_text: [{ type: "text", text: { content: "A日の筋トレ疲労を回復しながら脂肪を燃やす日。走らなくていい。" } }] },
      },
      {
        type: "bulleted_list_item",
        bulleted_list_item: { rich_text: [
          { type: "text", text: { content: "傾斜" }, annotations: { bold: true } },
          { type: "text", text: { content: " 10〜12% / " } },
          { type: "text", text: { content: "速度" }, annotations: { bold: true } },
          { type: "text", text: { content: " 5〜6 km/h / " } },
          { type: "text", text: { content: "心拍数" }, annotations: { bold: true } },
          { type: "text", text: { content: " 120〜140bpm" } },
        ] },
      },
      {
        type: "bulleted_list_item",
        bulleted_list_item: { rich_text: [{ type: "text", text: { content: "手すりに掴まらない。ペースを一定に保つ" } }] },
      },
    ];
  }
}

// --- Main ---

async function main() {
  const { flags, opts } = parseArgs();
  const date = opts.date || todayJST();
  const dryRun = flags.has("dry-run");

  const planFile = join(ROOT, "planning", "daily", `${date}.md`);
  if (!existsSync(planFile)) {
    console.log(`Plan file not found: ${planFile}`);
    return;
  }

  const rawEntries = parseDailyPlan(planFile);
  if (rawEntries.length === 0) {
    console.log("No routine (🔹) entries found in daily plan");
    return;
  }

  // Filter: only sync entries whose labels match schedule.json routines
  const routineLabels = loadRoutineLabels();
  const planEntries = rawEntries.filter((e) => {
    if (isRoutineLabel(e.label, routineLabels)) return true;
    console.log(
      `  IGNORE: ${e.label} ${e.start}-${e.end} (not in schedule.json routines)`,
    );
    return false;
  });

  if (planEntries.length === 0) {
    console.log("No matching routine entries after filtering");
    return;
  }

  if (dryRun) {
    console.log("[DRY RUN] Preview mode\n");
  }

  console.log(
    `Found ${planEntries.length} routine entries in daily plan for ${date}`,
  );

  // Phase 1: Clean existing non-completed routine entries
  console.log(`\nPhase 1: Cleaning existing routine entries...`);
  const cleaned = await cleanExistingRoutines(date, dryRun);
  console.log(`Cleaned ${cleaned} entries\n`);
  if (cleaned > 0 && !dryRun) {
    clearNotionCache();
  }

  // Phase 2: Create entries from AI plan
  console.log(`Phase 2: Creating entries from AI plan...`);
  const { apiKey, dbId, config } = getScheduleDbConfig("devotion");
  let created = 0;
  let guitarCount = 0;

  for (const entry of planEntries) {
    const expectedStart = `${date}T${entry.start}:00+09:00`;
    const expectedEnd = `${date}T${entry.end}:00+09:00`;

    // --- Guitar: schedule Lesson in guitar DB ---
    if (entry.label === GUITAR_LABEL) {
      const existing = await findExistingCurriculumEntry("guitar", date);
      if (existing) {
        console.log(`  UPDATE: ${existing.title} → ${entry.start}-${entry.end} [guitar]`);
        if (!dryRun) {
          const { apiKey: gApiKey } = getScheduleDbConfig("guitar");
          await notionFetch(gApiKey, `/pages/${existing.id}`, {
            properties: {
              "日付": { date: { start: expectedStart, end: expectedEnd } },
            },
          }, "PATCH");
        }
      } else {
        const lesson = await findNextLesson();
        if (!lesson) {
          console.log(`  ⚠ 未スケジュールの Lesson が見つかりません [guitar]`);
          continue;
        }
        console.log(`  CREATE: ${lesson.title} ${entry.start}-${entry.end} [guitar]`);
        if (!dryRun) {
          const { apiKey: gApiKey } = getScheduleDbConfig("guitar");
          await notionFetch(gApiKey, `/pages/${lesson.id}`, {
            properties: {
              "日付": { date: { start: expectedStart, end: expectedEnd } },
            },
          }, "PATCH");
        }
      }
      guitarCount++;
      continue;
    }

    // --- Gym: A/B rotation + menu blocks ---
    const isGym = entry.label === GYM_LABEL || entry.label.startsWith(GYM_LABEL);
    let gymMenu: "A" | "B" | null = null;

    if (isGym) {
      const count = await getGymSessionCount(date);
      gymMenu = count % 2 === 0 ? "A" : "B";
      console.log(
        `  CREATE: ${entry.label}（${gymMenu}日: ${gymMenu === "A" ? "マシン筋トレ+ウォーキング" : "ウォーキングのみ"}）${entry.start}-${entry.end}`,
      );
    } else {
      console.log(`  CREATE: ${entry.label} ${entry.start}-${entry.end}`);
    }

    if (!dryRun) {
      const createBody: Record<string, unknown> = {
        parent: { database_id: dbId },
        properties: {
          [config.titleProp]: {
            title: [{ text: { content: entry.label } }],
          },
          [config.dateProp]: {
            date: { start: expectedStart, end: expectedEnd },
          },
        },
        icon: pickTaskIcon(entry.label),
        cover: pickCover(),
      };

      if (isGym && gymMenu) {
        createBody.children = gymMenuBlocks(gymMenu);
      }

      await notionFetch(apiKey, "/pages", createBody);
    }
    created++;
  }

  if ((created > 0 || guitarCount > 0) && !dryRun) {
    clearNotionCache();
  }

  console.log(
    `\nDone! Created: ${created}, Guitar: ${guitarCount}, Cleaned: ${cleaned}`,
  );
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
