#!/usr/bin/env bun
/**
 * 学習ノートの復習ステータスを1行で出力する。
 * SessionStart hook から呼ばれる軽量サマリ。
 *
 * 出力例:
 *   📚 復習: 期日 5件 ・ 滞留 forgot 3 / fuzzy 2 ・ 未復習 4件
 *
 * すべて 0 件のときは何も出力しない（セッション開始のノイズを避けるため）。
 */

import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { Glob } from "bun";

type ReviewLogEntry = {
  last_reviewed: string;
  interval_days: number;
  review_count: number;
  confidence?: "perfect" | "fuzzy" | "forgot";
};
type ReviewLog = Record<string, ReviewLogEntry>;

const REPO_ROOT = process.env.LIFE_REPO_ROOT ?? "/workspaces/life";
const LOG_PATH = join(REPO_ROOT, "aspects/study/review-log.json");

const EXCLUDE_BASENAMES = new Set([
  "CLAUDE.md",
  "README.md",
  "roadmap.md",
  "tracker.md",
  "qa-bank.md",
  "system-design-chapters.md",
]);

function todayJST(): string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return fmt.format(new Date());
}

function daysBetween(fromISO: string, toISO: string): number {
  const from = new Date(fromISO + "T00:00:00Z").getTime();
  const to = new Date(toISO + "T00:00:00Z").getTime();
  return Math.round((to - from) / 86_400_000);
}

async function listNotes(): Promise<string[]> {
  const glob = new Glob("aspects/study/**/*.md");
  const out: string[] = [];
  for await (const rel of glob.scan({ cwd: REPO_ROOT, onlyFiles: true })) {
    const base = rel.split("/").pop() ?? "";
    if (EXCLUDE_BASENAMES.has(base)) continue;
    if (rel.startsWith("aspects/study/team/")) continue;
    out.push(rel);
  }
  return out;
}

function loadLog(): ReviewLog {
  if (!existsSync(LOG_PATH)) return {};
  return JSON.parse(readFileSync(LOG_PATH, "utf8")) as ReviewLog;
}

async function main() {
  const today = todayJST();
  const log = loadLog();
  const notes = await listNotes();

  let due = 0;
  let unreviewed = 0;
  let stuckForgot = 0;
  let stuckFuzzy = 0;

  for (const note of notes) {
    const entry = log[note];
    if (!entry) {
      unreviewed += 1;
      continue;
    }
    if (entry.last_reviewed === today) continue;
    if (daysBetween(entry.last_reviewed, today) >= entry.interval_days) {
      due += 1;
    }
    if (entry.review_count === 0) {
      if (entry.confidence === "forgot") stuckForgot += 1;
      else if (entry.confidence === "fuzzy") stuckFuzzy += 1;
    }
  }

  if (due === 0 && unreviewed === 0 && stuckForgot === 0 && stuckFuzzy === 0) {
    return;
  }

  const parts: string[] = [];
  if (due > 0) parts.push(`期日 ${due}件`);
  if (stuckForgot > 0 || stuckFuzzy > 0) {
    const stuck: string[] = [];
    if (stuckForgot > 0) stuck.push(`forgot ${stuckForgot}`);
    if (stuckFuzzy > 0) stuck.push(`fuzzy ${stuckFuzzy}`);
    parts.push(`滞留 ${stuck.join(" / ")}`);
  }
  if (unreviewed > 0) parts.push(`未復習 ${unreviewed}件`);

  console.log(`📚 復習: ${parts.join(" ・ ")}`);
}

main().catch((e) => {
  console.error("study-status error:", e);
  process.exit(1);
});
