#!/usr/bin/env bun
/**
 * Notion タスク・イベント一覧取得（全4 DB対応）
 *
 * 使い方:
 *   bun run scripts/notion-list.ts                    # 今日のタスク（全DB）
 *   bun run scripts/notion-list.ts --date 2026-02-14  # 指定日のタスク
 *   bun run scripts/notion-list.ts --days 7           # 今後7日間
 *   bun run scripts/notion-list.ts --json             # JSON出力
 *   bun run scripts/notion/notion-list.ts --db events    # イベントDBのみ
 *   bun run scripts/notion/notion-list.ts --db todo      # やることDBのみ
 */

import {
  type ScheduleDbName, type NormalizedEntry, SCHEDULE_DB_CONFIGS,
  getScheduleDbConfigOptional, queryDbByDateCached, queryDbByStatus, normalizePages,
  parseArgs, todayJST,
} from "./lib/notion";

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString("ja-JP", {
    timeZone: "Asia/Tokyo",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const DB_LABEL: Record<ScheduleDbName, string> = {
  devotion: "デボーション",
  events: "イベント",
  meals: "食事",
  groceries: "買い出し",
  todo: "やること",
  other: "その他",
  study: "学習",
  topic: "学習トピック",
  interview: "面接対策",
};

async function main() {
  const { flags, opts } = parseArgs();
  const days = opts.days ? parseInt(opts.days, 10) : 1;
  const date = opts.date || null;
  const json = flags.has("json");
  const dbFilter = opts.db as ScheduleDbName | undefined;

  let startDate: string, endDate: string;
  if (date) {
    startDate = date;
    endDate = date;
  } else {
    const now = new Date();
    startDate = todayJST();
    const end = new Date(now.getTime() + (days - 1) * 86400000);
    endDate = end.toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });
  }

  const dbNames: ScheduleDbName[] = dbFilter ? [dbFilter] : (Object.keys(SCHEDULE_DB_CONFIGS) as ScheduleDbName[]);

  // Query all configured DBs in parallel
  const allEntries: NormalizedEntry[] = [];
  const useTodoStatusQuery = !date && !opts.days;
  const queries = dbNames.map(async (name) => {
    const dbConf = getScheduleDbConfigOptional(name);
    if (!dbConf) return;
    const { apiKey, dbId, config } = dbConf;
    try {
      // todo DB: default to status-based query (show all open items)
      const data = name === "todo" && useTodoStatusQuery
        ? await queryDbByStatus(apiKey, dbId, config, ["未着手"])
        : await queryDbByDateCached(apiKey, dbId, config, startDate, endDate);
      allEntries.push(...normalizePages(data.results, config, name));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("404") || msg.includes("Could not find database")) {
        console.warn(`  SKIP [${name}] (${dbId}): not shared with integration`);
        return;
      }
      throw err;
    }
  });
  await Promise.all(queries);

  // Sort by start time
  allEntries.sort((a, b) => (a.start || "").localeCompare(b.start || ""));

  if (json) {
    console.log(JSON.stringify(allEntries, null, 2));
    return;
  }

  if (allEntries.length === 0) {
    console.log("タスクなし");
    return;
  }

  // Group by date
  const byDate = new Map<string, NormalizedEntry[]>();
  for (const entry of allEntries) {
    const dateKey = entry.start.includes("T")
      ? new Date(entry.start).toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" })
      : entry.start;
    if (!byDate.has(dateKey)) byDate.set(dateKey, []);
    byDate.get(dateKey)!.push(entry);
  }

  for (const [dateKey, dayEntries] of byDate) {
    let label: string;
    if (!dateKey) {
      label = "日付なし";
    } else {
      const dateObj = new Date(dateKey + "T12:00:00+09:00");
      label = dateObj.toLocaleDateString("ja-JP", {
        timeZone: "Asia/Tokyo",
        year: "numeric",
        month: "numeric",
        day: "numeric",
        weekday: "short",
      });
    }
    console.log(`\n${label}`);
    for (const entry of dayEntries) {
      const check = entry.status === "Done" ? "✅" : "⬜";
      const time = entry.start.includes("T")
        ? `${formatTime(entry.start)}${entry.end ? "-" + formatTime(entry.end) : ""}`
        : "[終日]";
      const dbTag = `[${DB_LABEL[entry.source]}]`;
      const fb = entry.feedback ? ` 💬 ${entry.feedback}` : "";
      const actual = entry.actualStart ? ` (実際 ${entry.actualStart}${entry.actualEnd ? "-" + entry.actualEnd : ""})` : "";
      console.log(`  ${check} ${time}  ${dbTag} ${entry.title}${actual}${fb}`);
    }
  }
  console.log("");
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
