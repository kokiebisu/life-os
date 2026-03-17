#!/usr/bin/env bun
/**
 * デイリープランのスケジュールを Notion Calendar に同期
 *
 * 使い方:
 *   bun run scripts/notion-sync-schedule.ts --date 2026-02-15
 *   bun run scripts/notion-sync-schedule.ts --date 2026-02-15 --dry-run
 *
 * 動作:
 *   1. notion-daily-plan.ts --json でスケジュール取得
 *   2. notion-list.ts --json で既存イベント取得
 *   3. 未登録のルーティン枠を Notion に追加
 */

import { getScheduleDbConfig, notionFetch, parseArgs, todayJST, pickTaskIcon, pickCover, type ScheduleDbName } from "./lib/notion";

interface TimeSlot {
  start: string;
  end: string;
  label: string;
  source: "devotion" | "event" | "notion";
  notionRegistered?: boolean;
}

interface DailyPlanData {
  schedule: {
    timeline: TimeSlot[];
    allDay: { label: string; aspect?: string; notionRegistered?: boolean }[];
  };
}

interface ExistingTask {
  title: string;
  start: string;
  end: string | null;
}

function timeToMinutes(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

function timeFromISO(iso: string): string {
  return new Date(iso).toLocaleString("ja-JP", {
    timeZone: "Asia/Tokyo",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** 2つの時間帯が重なっているか（1分でも重なればtrue） */
function overlaps(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  const a0 = timeToMinutes(aStart);
  const a1 = timeToMinutes(aEnd);
  const b0 = timeToMinutes(bStart);
  const b1 = timeToMinutes(bEnd);
  return a0 < b1 && b0 < a1;
}

async function main() {
  const { flags, opts } = parseArgs();
  const date = opts.date || todayJST();
  const dryRun = flags.has("dry-run");

  // 1. Get schedule from daily plan
  const planProc = Bun.spawn(
    ["bun", "run", "scripts/notion-daily-plan.ts", "--date", date, "--json"],
    { stdout: "pipe", stderr: "pipe", cwd: import.meta.dir + "/.." },
  );
  const planOutput = await new Response(planProc.stdout).text();
  const planErr = await new Response(planProc.stderr).text();
  await planProc.exited;
  if (planProc.exitCode !== 0) {
    console.error("Failed to get daily plan:", planErr);
    process.exit(1);
  }
  const planData: DailyPlanData = JSON.parse(planOutput);

  // 2. Get existing Notion events
  const listProc = Bun.spawn(
    ["bun", "run", "scripts/notion-list.ts", "--date", date, "--json"],
    { stdout: "pipe", stderr: "pipe", cwd: import.meta.dir + "/.." },
  );
  const listOutput = await new Response(listProc.stdout).text();
  await listProc.exited;
  const existing: ExistingTask[] = JSON.parse(listOutput || "[]");

  // 3. Find routine slots not yet registered (skip fragments < 30 min)
  const routineSlots = planData.schedule.timeline.filter(
    (s) => s.source === "devotion" && !s.notionRegistered &&
      timeToMinutes(s.end) - timeToMinutes(s.start) >= 30,
  );

  const toRegister: TimeSlot[] = [];
  for (const slot of routineSlots) {
    // 時間帯が重なる既存イベントがあればスキップ（同日2回実行しても安全）
    const hasOverlap = existing.some((e) => {
      if (!e.start.includes("T") || !e.end) return false;
      return overlaps(slot.start, slot.end, timeFromISO(e.start), timeFromISO(e.end));
    });
    if (!hasOverlap) {
      toRegister.push(slot);
    }
  }

  if (toRegister.length === 0) {
    console.log("全てのルーティンは登録済みです");
    return;
  }

  console.log(`${toRegister.length} 件のルーティンを登録${dryRun ? "（dry-run）" : ""}:`);

  // Label → DB mapping for non-routine entries
  const GUITAR_LABEL = "ギター練習";
  const GYM_LABEL = "ジム";

  /** Count this week's gym sessions (Mon-Sun) to determine A/B rotation */
  async function getGymSessionCount(currentDate: string): Promise<number> {
    const d = new Date(currentDate + "T12:00:00+09:00");
    const day = d.getDay(); // 0=Sun, 1=Mon, ...
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
          { property: "日付", date: { before: currentDate } },
        ],
      },
    });
    return resp.results?.length || 0;
  }

  /** Generate Notion blocks for gym menu (A or B day) */
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
        // --- Walking ---
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
        // --- Machine Strength ---
        {
          type: "heading_3",
          heading_3: { rich_text: [{ type: "text", text: { content: "🏋️ マシン筋トレ（30分）" } }] },
        },
        {
          type: "quote",
          quote: { rich_text: [{ type: "text", text: { content: "各種目の間に60秒休憩。15回3セットが楽にできたら次回から重量UP。" } }] },
        },
        // Bench press
        {
          type: "to_do",
          to_do: { rich_text: [
            { type: "text", text: { content: "ベンチプレス 3×15" }, annotations: { bold: true } },
            { type: "text", text: { content: "  — バーのみ(20kg)〜。セーフティバー必須。胸に下ろして押し上げる" } },
          ], checked: false },
        },
        // Lat pulldown
        {
          type: "to_do",
          to_do: { rich_text: [
            { type: "text", text: { content: "ラットプルダウン 3×15" }, annotations: { bold: true } },
            { type: "text", text: { content: "  — 15kg〜。バーを鎖骨まで引き下ろす。肘を脇腹に向かって引く意識" } },
          ], checked: false },
        },
        // Leg press
        {
          type: "to_do",
          to_do: { rich_text: [
            { type: "text", text: { content: "レッグプレス 3×15" }, annotations: { bold: true } },
            { type: "text", text: { content: "  — 30kg〜。膝を伸ばしきらない。足の裏全体で押す" } },
          ], checked: false },
        },
        // Abdominal
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

  /** Find the next unscheduled Lesson page in curriculum DB (no date set, not completed) */
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

  for (const slot of toRegister) {
    const isGuitar = slot.label === GUITAR_LABEL;

    if (isGuitar) {
      // Guitar: find existing Lesson page and set date (don't create new)
      const lesson = await findNextLesson();
      if (!lesson) {
        console.log(`  ${slot.start}-${slot.end}  ⚠ 未スケジュールの Lesson が見つかりません [guitar]`);
        continue;
      }

      console.log(`  ${slot.start}-${slot.end}  ${lesson.title} [guitar]`);

      if (dryRun) continue;

      const { apiKey } = getScheduleDbConfig("guitar");
      await notionFetch(apiKey, `/pages/${lesson.id}`, {
        properties: {
          "日付": {
            date: {
              start: `${date}T${slot.start}:00+09:00`,
              end: `${date}T${slot.end}:00+09:00`,
            },
          },
        },
      }, "PATCH");
    } else {
      // Default: create new page in routine DB
      const { apiKey, dbId, config } = getScheduleDbConfig("devotion");
      const isGym = slot.label === GYM_LABEL;

      // Determine gym menu type (A/B rotation)
      let gymMenu: "A" | "B" | null = null;
      if (isGym) {
        const count = await getGymSessionCount(date);
        // A→B→A pattern: even count = A, odd count = B
        gymMenu = count % 2 === 0 ? "A" : "B";
        console.log(`  ${slot.start}-${slot.end}  ${slot.label}（${gymMenu}日: ${gymMenu === "A" ? "マシン筋トレ+ウォーキング" : "ウォーキングのみ"}）`);
      } else {
        console.log(`  ${slot.start}-${slot.end}  ${slot.label}`);
      }

      if (dryRun) continue;

      const properties: Record<string, unknown> = {
        [config.titleProp]: { title: [{ text: { content: slot.label } }] },
        [config.dateProp]: {
          date: {
            start: `${date}T${slot.start}:00+09:00`,
            end: `${date}T${slot.end}:00+09:00`,
          },
        },
      };

      const createBody: Record<string, unknown> = {
        parent: { database_id: dbId },
        properties,
        icon: pickTaskIcon(slot.label),
        cover: pickCover(),
      };

      // Add gym menu as page content
      if (isGym && gymMenu) {
        createBody.children = gymMenuBlocks(gymMenu);
      }

      await notionFetch(apiKey, "/pages", createBody);
    }
  }

  if (!dryRun) {
    console.log("登録完了");
  }
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
