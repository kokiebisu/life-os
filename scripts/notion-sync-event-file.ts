#!/usr/bin/env bun
/**
 * イベントファイル → Notion 同期（4 DB対応）
 *
 * 指定されたイベントファイルをパースし、パスに応じた Notion DB と同期する。
 * TSU-ID（優先）またはタイトル類似度でマッチング。
 *
 * パス → DB ルーティング:
 *   aspects/diet/events/    → meals DB
 *   aspects/guitar/events/  → guitar DB
 *   planning/events/        → events DB
 *   それ以外                → events DB
 *
 * 使い方:
 *   bun run scripts/notion-sync-event-file.ts --file planning/events/2026-02-19.md
 *   bun run scripts/notion-sync-event-file.ts --file aspects/diet/events/2026-02-14.md --dry-run
 */

import { readFileSync, existsSync } from "fs";
import { join, basename } from "path";
import {
  type ScheduleDbName, type ScheduleDbConfig,
  SCHEDULE_DB_CONFIGS, getScheduleDbConfig, queryDbByDateCached, normalizePages,
  normalizeTitle, notionFetch, parseArgs, pickTaskIcon, pickCover, clearNotionCache,
} from "./lib/notion";

const ROOT = join(import.meta.dir, "..");

// --- Types ---

interface ParsedEvent {
  done: boolean;
  startTime: string; // "14:00" or ""
  endTime: string;   // "16:30" or ""
  allDay: boolean;
  title: string;     // "Venture Cafe Global Gathering 2026（虎ノ門ヒルズ/CIC Tokyo）"
  description: string;
  tsuId: string | null; // "TSU-241" or null
  dbOverride: ScheduleDbName | null; // per-item #db tag override
}

// --- Path-based DB routing ---

function resolveDbFromPath(filePath: string): ScheduleDbName {
  if (filePath.includes("/diet/")) return "meals";
  if (filePath.includes("/guitar/")) return "guitar";
  if (filePath.includes("/sound/")) return "sound";
  if (filePath.includes("/routine/")) return "devotion";
  return "events";
}

// --- Parsing ---

function parseEventFile(filePath: string): { date: string; events: ParsedEvent[] } {
  const content = readFileSync(filePath, "utf-8");
  const dateMatch = basename(filePath).match(/^(\d{4}-\d{2}-\d{2})\.md$/);
  if (!dateMatch) {
    throw new Error(`Invalid event file name: ${basename(filePath)}`);
  }
  const date = dateMatch[1];

  const events: ParsedEvent[] = [];
  const lines = content.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Match: - [ ] 14:00-16:30 Title or - [x] 14:00-16:30 Title or - [ ] 終日 Title
    const eventMatch = line.match(/^- \[([ x])\]\s+(?:(\d{1,2}:\d{2})\s*[-–〜]\s*(\d{1,2}:\d{2})\s+|終日\s+)?(.+)$/);
    if (!eventMatch) continue;

    const done = eventMatch[1] === "x";
    const startTime = eventMatch[2] ? eventMatch[2].padStart(5, "0") : "";
    const endTime = eventMatch[3] ? eventMatch[3].padStart(5, "0") : "";
    const allDay = !eventMatch[2];
    const title = eventMatch[4].trim();

    // Collect description lines (indented with 2+ spaces starting with "- ")
    const descLines: string[] = [];
    let j = i + 1;
    while (j < lines.length && lines[j].match(/^\s{2,}-\s/)) {
      descLines.push(lines[j].replace(/^\s{2,}-\s/, "").trim());
      j++;
    }

    const description = descLines.join("\n");

    // Extract TSU-ID from description
    const tsuMatch = description.match(/\b(TSU-\d+)\b/);
    const tsuId = tsuMatch ? tsuMatch[1] : null;

    // Extract #dbname tag for per-item DB routing
    const dbTagMatch = title.match(/\s+#(\w+)$/);
    let dbOverride: ScheduleDbName | null = null;
    let cleanTitle = title;
    if (dbTagMatch && dbTagMatch[1] in SCHEDULE_DB_CONFIGS) {
      dbOverride = dbTagMatch[1] as ScheduleDbName;
      cleanTitle = title.replace(/\s+#\w+$/, "");
    }

    events.push({ done, startTime, endTime, allDay, title: cleanTitle, description, tsuId, dbOverride });
  }

  return { date, events };
}

// --- Matching ---

// Meal prefixes that can change between sync cycles (朝食→昼食 etc.)
const MEAL_PREFIXES = /^(朝食|昼食|夕食|間食|おやつ|ブランチ)/;

function titlesMatch(local: string, notion: string): boolean {
  const a = normalizeTitle(local);
  const b = normalizeTitle(notion);
  if (a.includes(b) || b.includes(a)) return true;

  // Meal content match: 朝食（X）vs 昼食（X）→ match if food content X is the same
  const contentA = local.replace(MEAL_PREFIXES, "");
  const contentB = notion.replace(MEAL_PREFIXES, "");
  if (contentA !== local && contentB !== notion) {
    return normalizeTitle(contentA) === normalizeTitle(contentB);
  }

  return false;
}

function findMatchingPage(
  event: ParsedEvent,
  date: string,
  notionPages: any[],
  config: ScheduleDbConfig,
): { page: any; matchType: "tsu-id" | "title" | "time-slot" } | null {
  // Priority 1: TSU-ID match
  if (event.tsuId && config.descProp) {
    for (const page of notionPages) {
      const richText = page.properties?.[config.descProp]?.rich_text || [];
      const desc = richText.map((seg: any) => seg.plain_text || "").join("");
      if (desc.includes(event.tsuId)) {
        return { page, matchType: "tsu-id" };
      }
    }
  }

  // Priority 2: Title similarity
  const notionTitle = (p: any) =>
    (p.properties?.[config.titleProp]?.title || []).map((t: any) => t.plain_text || "").join("");

  for (const page of notionPages) {
    if (titlesMatch(event.title, notionTitle(page))) {
      return { page, matchType: "title" };
    }
  }

  // Priority 3: Time-slot match (same start+end time → same event, title may have changed)
  if (event.startTime && event.endTime) {
    const expectedStart = `${date}T${event.startTime}:00+09:00`;
    const expectedEnd = `${date}T${event.endTime}:00+09:00`;
    for (const page of notionPages) {
      const dateInfo = page.properties?.[config.dateProp]?.date;
      if (!dateInfo?.start) continue;
      const pageStart = dateInfo.start.replace(/\.000\+/, "+");
      const pageEnd = dateInfo.end?.replace(/\.000\+/, "+");
      if (pageStart === expectedStart && pageEnd === expectedEnd) {
        return { page, matchType: "time-slot" };
      }
    }
  }

  return null;
}

// --- Notion property builders ---

function buildProperties(event: ParsedEvent, date: string, config: ScheduleDbConfig): Record<string, unknown> {
  const properties: Record<string, unknown> = {
    [config.titleProp]: { title: [{ text: { content: event.title } }] },
  };

  if (event.allDay) {
    properties[config.dateProp] = { date: { start: date } };
  } else {
    const dateObj: Record<string, string> = {
      start: `${date}T${event.startTime}:00+09:00`,
    };
    if (event.endTime) {
      dateObj.end = `${date}T${event.endTime}:00+09:00`;
    }
    properties[config.dateProp] = { date: dateObj };
  }

  if (event.description && config.descProp) {
    properties[config.descProp] = { rich_text: [{ text: { content: event.description } }] };
  }

  if (event.done && config.statusProp) {
    properties[config.statusProp] = { status: { name: config.statusDone } };
  }

  return properties;
}

function diffProperties(
  event: ParsedEvent,
  date: string,
  existingPage: any,
  config: ScheduleDbConfig,
): Record<string, unknown> | null {
  const updates: Record<string, unknown> = {};
  let hasChanges = false;

  // Compare title
  const existingTitle = (existingPage.properties?.[config.titleProp]?.title || [])
    .map((t: any) => t.plain_text || "").join("");
  if (existingTitle !== event.title) {
    updates[config.titleProp] = { title: [{ text: { content: event.title } }] };
    hasChanges = true;
  }

  // Compare date (normalize to ignore .000 milliseconds from Notion)
  const normalizeDate = (d: string | undefined) => d?.replace(/\.000\+/, "+");
  const existingDate = existingPage.properties?.[config.dateProp]?.date;
  if (event.allDay) {
    if (existingDate?.start !== date || existingDate?.end) {
      updates[config.dateProp] = { date: { start: date } };
      hasChanges = true;
    }
  } else {
    const expectedStart = `${date}T${event.startTime}:00+09:00`;
    const expectedEnd = event.endTime ? `${date}T${event.endTime}:00+09:00` : undefined;
    if (normalizeDate(existingDate?.start) !== expectedStart || normalizeDate(existingDate?.end) !== expectedEnd) {
      const dateObj: Record<string, string> = { start: expectedStart };
      if (expectedEnd) dateObj.end = expectedEnd;
      updates[config.dateProp] = { date: dateObj };
      hasChanges = true;
    }
  }

  // Compare description
  if (config.descProp) {
    const existingDesc = (existingPage.properties?.[config.descProp]?.rich_text || [])
      .map((t: any) => t.plain_text || "").join("");
    if (event.description && existingDesc !== event.description) {
      updates[config.descProp] = { rich_text: [{ text: { content: event.description } }] };
      hasChanges = true;
    }
  }

  // Compare status (only set to done, never revert)
  if (event.done && config.statusProp) {
    const existingStatus = existingPage.properties?.[config.statusProp]?.status?.name;
    if (existingStatus !== config.statusDone) {
      updates[config.statusProp] = { status: { name: config.statusDone } };
      hasChanges = true;
    }
  }

  return hasChanges ? updates : null;
}

// --- Main ---

async function main() {
  const { flags, opts } = parseArgs();
  const dryRun = flags.has("dry-run");
  const filePath = opts.file;

  if (!filePath) {
    console.error("Usage: bun run scripts/notion-sync-event-file.ts --file <path> [--dry-run]");
    process.exit(1);
  }

  const absPath = filePath.startsWith("/") ? filePath : join(ROOT, filePath);
  if (!existsSync(absPath)) {
    console.error(`File not found: ${absPath}`);
    process.exit(1);
  }

  if (dryRun) {
    console.log("[DRY RUN] Preview mode - no changes will be made\n");
  }

  const { date, events } = parseEventFile(absPath);
  if (events.length === 0) {
    console.log(`No events found in ${filePath}`);
    return;
  }

  const defaultDbName = resolveDbFromPath(filePath);

  // Group events by target DB (per-item #db tag overrides path-based default)
  const grouped = new Map<ScheduleDbName, ParsedEvent[]>();
  for (const event of events) {
    const db = event.dbOverride || defaultDbName;
    if (!grouped.has(db)) grouped.set(db, []);
    grouped.get(db)!.push(event);
  }

  // Fetch all schedule DB entries for cross-DB duplicate checking
  const allExistingTitles = new Set<string>();
  const dbNames = Object.keys(SCHEDULE_DB_CONFIGS) as ScheduleDbName[];
  await Promise.all(dbNames.map(async (name) => {
    const conf = getScheduleDbConfig(name);
    try {
      const data = await queryDbByDateCached(conf.apiKey, conf.dbId, conf.config, date, date);
      const entries = normalizePages(data.results, conf.config, name);
      for (const e of entries) allExistingTitles.add(normalizeTitle(e.title));
    } catch { /* DB may not exist */ }
  }));

  let created = 0, updated = 0, skipped = 0;

  for (const [dbName, dbEvents] of grouped) {
    const { apiKey, dbId, config } = getScheduleDbConfig(dbName);
    console.log(`Syncing ${dbEvents.length} event(s) from ${date} → Notion [${dbName}]...`);

    // Query target DB for matching
    const data = await notionFetch(apiKey, `/databases/${dbId}/query`, {
      filter: {
        and: [
          { property: config.dateProp, date: { on_or_after: `${date}T00:00:00+09:00` } },
          { property: config.dateProp, date: { on_or_before: `${date}T23:59:59+09:00` } },
        ],
      },
    });
    const notionPages: any[] = data.results || [];

    for (const event of dbEvents) {
      const match = findMatchingPage(event, date, notionPages, config);

      if (match) {
        // Time-slot match + completed → Notion side is truth, skip
        if (match.matchType === "time-slot") {
          const existingStatus = match.page.properties?.[config.statusProp]?.status?.name;
          if (existingStatus === config.statusDone) {
            const existingTitle = (match.page.properties?.[config.titleProp]?.title || [])
              .map((t: any) => t.plain_text || "").join("");
            console.log(`  SKIP: ${event.title} (completed as "${existingTitle}" at same time slot)`);
            skipped++;
            continue;
          }
        }

        // Existing page in target DB — check for diff
        const diff = diffProperties(event, date, match.page, config);
        if (diff) {
          console.log(`  UPDATE (${match.matchType}): ${event.title}`);
          if (!dryRun) {
            await notionFetch(apiKey, `/pages/${match.page.id}`, { properties: diff }, "PATCH");
          }
          updated++;
        } else {
          console.log(`  SKIP: ${event.title} (no changes)`);
          skipped++;
        }
      } else if (allExistingTitles.has(normalizeTitle(event.title))) {
        // Exists in another DB — skip to avoid cross-DB duplicates
        console.log(`  SKIP: ${event.title} (exists in another DB)`);
        skipped++;
      } else {
        // New event — create
        const properties = buildProperties(event, date, config);
        const icon = pickTaskIcon(event.title);
        const cover = pickCover();
        console.log(`  CREATE: ${event.title}`);
        if (!dryRun) {
          await notionFetch(apiKey, "/pages", { parent: { database_id: dbId }, properties, icon, cover });
        }
        created++;
      }
    }
  }

  if (created > 0 || updated > 0) {
    clearNotionCache();
  }

  console.log(`\nDone! Created: ${created}, Updated: ${updated}, Skipped: ${skipped}`);
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
