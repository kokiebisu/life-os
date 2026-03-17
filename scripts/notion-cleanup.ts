#!/usr/bin/env bun
/**
 * 過去の未完了エントリ取得
 *
 * 使い方:
 *   bun run scripts/notion-cleanup.ts           # 全期間の過去未完了（JSON）
 *   bun run scripts/notion-cleanup.ts --date 2026-03-01  # 指定日のみ
 *   bun run scripts/notion-cleanup.ts --no-date # 日付なし・未完了のエントリのみ
 */

import {
  type ScheduleDbName,
  SCHEDULE_DB_CONFIGS,
  getScheduleDbConfigOptional,
  normalizePages,
  todayJST,
  parseArgs,
  notionFetch,
  clearNotionCache,
} from "./lib/notion";

async function main() {
  const { opts, flags } = parseArgs();
  const targetDate = opts.date || null;
  const noDate = flags.has("no-date");
  const today = todayJST();

  clearNotionCache();

  const dbNames = Object.keys(SCHEDULE_DB_CONFIGS) as ScheduleDbName[];
  const allEntries: ReturnType<typeof normalizePages> = [];

  const queries = dbNames.map(async (dbName) => {
    const dbSetup = getScheduleDbConfigOptional(dbName);
    if (!dbSetup) return;
    const { apiKey, dbId, config } = dbSetup;

    // Exclude done statuses (config.statusDone + "完了" as fallback for DBs with Japanese status)
    const doneStatuses = new Set([config.statusDone, "完了"]);
    const statusFilters = [...doneStatuses].map((s) => ({
      property: config.statusProp,
      status: { does_not_equal: s },
    }));

    const filters: Record<string, unknown>[] = [...statusFilters];

    if (noDate) {
      // Date-less incomplete entries only
      filters.push({ property: config.dateProp, date: { is_empty: true } });
    } else {
      filters.push({ property: config.dateProp, date: { is_not_empty: true } });
      if (targetDate) {
        // Filter to specific date
        filters.push({ property: config.dateProp, date: { on_or_after: targetDate + "T00:00:00+09:00" } });
        filters.push({ property: config.dateProp, date: { on_or_before: targetDate + "T23:59:59+09:00" } });
      } else {
        // All past incomplete: date before today
        filters.push({ property: config.dateProp, date: { before: today + "T00:00:00+09:00" } });
      }
    }

    if (config.extraFilter) filters.push(config.extraFilter);

    const data = await notionFetch(apiKey, `/databases/${dbId}/query`, {
      filter: { and: filters },
      sorts: noDate ? [] : [{ property: config.dateProp, direction: "ascending" }],
    });

    allEntries.push(...normalizePages(data.results, config, dbName));
  });

  await Promise.all(queries);

  // Sort by start date ascending
  allEntries.sort((a, b) => (a.start || "").localeCompare(b.start || ""));

  console.log(JSON.stringify(allEntries, null, 2));
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
