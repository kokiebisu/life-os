#!/usr/bin/env bun
/**
 * Notion → aspects/daily/ 同期スクリプト
 * 指定日範囲の Notion エントリを取得し、daily md を上書きする
 *
 * 使い方:
 *   bun run scripts/sync-daily-from-notion.ts                          # 全 daily ファイルを同期
 *   bun run scripts/sync-daily-from-notion.ts --date 2026-03-18        # 指定日のみ
 */

import { join } from "path";
import {
  type NormalizedEntry,
  type ScheduleDbName,
  queryDbByDateCached,
  normalizePages,
  SCHEDULE_DB_CONFIGS,
  getScheduleDbConfigOptional,
  parseArgs,
} from "./lib/notion";

const DAILY_DIR = join(import.meta.dir, "../aspects/daily");

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString("ja-JP", {
    timeZone: "Asia/Tokyo",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const DB_EMOJI: Record<string, string> = {
  routine: "🔄",
  events: "📅",
  guitar: "🎸",
  sound: "🎛️",
  meals: "🍽️",
  groceries: "🛒",
  todo: "✅",
  other: "📌",
};

async function fetchEntriesForDate(date: string): Promise<NormalizedEntry[]> {
  const allEntries: NormalizedEntry[] = [];

  for (const dbName of Object.keys(SCHEDULE_DB_CONFIGS) as ScheduleDbName[]) {
    const setup = getScheduleDbConfigOptional(dbName);
    if (!setup) continue;
    const { apiKey, dbId, config } = setup;

    try {
      const data = await queryDbByDateCached(apiKey, dbId, config, date, date);
      const entries = normalizePages(data.results || [], config, dbName);
      allEntries.push(...entries);
    } catch { continue; }
  }

  return allEntries.sort((a, b) => {
    if (!a.start) return 1;
    if (!b.start) return -1;
    return a.start.localeCompare(b.start);
  });
}

function generateDailyMd(date: string, entries: NormalizedEntry[]): string {
  const d = new Date(date + "T12:00:00+09:00");
  const dow = d.toLocaleDateString("ja-JP", { timeZone: "Asia/Tokyo", weekday: "short" }).replace("曜日", "");

  let md = `# ${date}（${dow}）\n\n`;

  if (entries.length === 0) {
    md += "_Notion エントリなし_\n";
    return md;
  }

  for (const entry of entries) {
    const emoji = DB_EMOJI[entry.source] ?? "•";
    let timeStr = "";
    if (entry.start) {
      timeStr = formatTime(entry.start);
      if (entry.end) timeStr += `-${formatTime(entry.end)}`;
      timeStr += " ";
    }
    const status = entry.status === "完了" ? " ✅" : "";
    md += `- ${emoji} ${timeStr}${entry.title}${status}\n`;
  }

  return md;
}

async function main() {
  const { opts } = parseArgs();

  let dates: string[] = [];

  if (opts.date) {
    dates = [opts.date];
  } else {
    // aspects/daily/ の全 md ファイルから日付を収集
    const glob = new Bun.Glob("*.md");
    for await (const file of glob.scan(DAILY_DIR)) {
      const match = file.match(/^(\d{4}-\d{2}-\d{2})\.md$/);
      if (match?.[1]) dates.push(match[1]);
    }
    dates.sort();
  }

  console.log(`同期対象: ${dates.length} 日`);

  for (const date of dates) {
    process.stdout.write(`  ${date} ... `);
    const entries = await fetchEntriesForDate(date);
    const md = generateDailyMd(date, entries);
    const filePath = join(DAILY_DIR, `${date}.md`);
    await Bun.write(filePath, md);
    console.log(`${entries.length} 件`);
  }

  console.log("完了");
}

main().catch(console.error);
