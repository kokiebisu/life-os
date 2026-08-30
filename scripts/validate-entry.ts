#!/usr/bin/env bun
/**
 * Notion エントリ重複バリデーション
 *
 * 使い方:
 *   bun run scripts/validate-entry.ts --date YYYY-MM-DD --title "タイトル"
 *   bun run scripts/validate-entry.ts --date YYYY-MM-DD --title "Devotion" --start 08:00 --end 08:30
 *   bun run scripts/validate-entry.ts --date YYYY-MM-DD --title "Devotion" --db devotion
 *
 * 終了コード:
 *   0 = 類似エントリなし（登録OK）
 *   1 = 類似エントリあり（登録中止すべき）
 */

import { type ScheduleDbName, parseArgs, findSimilarEntries } from "./lib/notion";

const DB_LABELS: Record<ScheduleDbName, string> = {
  devotion: "デボーション", events: "イベント", todo: "やること",
  guitar: "ギター", sound: "音響", meals: "食事", groceries: "買い出し", other: "その他",
  study: "学習", interview: "面接対策",
};

async function main() {
  const { opts } = parseArgs();
  if (!opts.date || !opts.title) {
    console.error("Usage: bun run scripts/validate-entry.ts --date YYYY-MM-DD --title \"タイトル\" [--db devotion] [--start HH:MM] [--end HH:MM]");
    process.exit(2);
  }

  const similar = await findSimilarEntries(opts.date, opts.title, {
    db: opts.db as ScheduleDbName | undefined,
    start: opts.start,
    end: opts.end,
  });

  if (similar.length === 0) {
    console.log(`✅ 類似エントリなし。登録OK。`);
    process.exit(0);
  }

  console.error(`⚠️ 類似エントリ検出:`);
  for (const entry of similar) {
    const time = entry.start ? ` (${entry.start}${entry.end ? `-${entry.end}` : ""})` : "";
    const match = entry.matchType === "exact" ? "完全一致" : "類似";
    console.error(`  [${DB_LABELS[entry.db] || entry.db}] "${entry.title}"${time} — ${match}`);
  }
  console.error(`登録を中止してください。`);
  process.exit(1);
}

main();
