#!/usr/bin/env bun
/**
 * Notion ジム DB → ローカル md 同期
 *
 * Notion ジム DB の各ページを `aspects/gym/logs/YYYY-MM-DD.md` に書き出す。
 * デフォルトでは「ローカル最新ログの翌日以降」のページのみ同期する（差分・冪等）。
 *
 * 使い方:
 *   bun run scripts/gym/sync-notion-to-md.ts                  # 差分のみ
 *   bun run scripts/gym/sync-notion-to-md.ts --since 2026-04-01
 *   bun run scripts/gym/sync-notion-to-md.ts --all            # 全件
 *   bun run scripts/gym/sync-notion-to-md.ts --dry-run        # 書き込まない
 *   bun run scripts/gym/sync-notion-to-md.ts --force          # 既存ファイル上書き
 */

import { readdirSync, existsSync, writeFileSync, readFileSync } from "fs";
import { join } from "path";
import { getApiKey, notionFetch, getGymDbId, parseArgs, todayJST } from "../lib/notion";

const ROOT = join(import.meta.dir, "../..");
const LOGS_DIR = join(ROOT, "aspects/gym/logs");

interface StrengthExercise {
  type: "strength";
  name: string;
  weight: string;
  sets: string;
  reps: string;
  feedback: string;
}

interface CardioExercise {
  type: "cardio";
  name: string;
  duration: string;
  incline: string;
  speed: string;
  feedback: string;
}

type Exercise = StrengthExercise | CardioExercise;

interface SessionData {
  pageId: string;
  date: string; // YYYY-MM-DD
  startTime: string | null; // HH:MM JST
  endTime: string | null;
  exercises: Exercise[];
}

function cellText(cell: any[]): string {
  return cell.map((t: any) => t.plain_text ?? "").join("");
}

function isBlankCell(c: any[]): boolean {
  return cellText(c).trim() === "";
}

async function listChildren(apiKey: string, blockId: string): Promise<any[]> {
  const results: any[] = [];
  let cursor: string | undefined;
  do {
    const q = cursor ? `?page_size=100&start_cursor=${cursor}` : "?page_size=100";
    const res = await notionFetch(apiKey, `/blocks/${blockId}/children${q}`, undefined, "GET");
    results.push(...(res.results || []));
    cursor = res.has_more ? res.next_cursor : undefined;
  } while (cursor);
  return results;
}

function detectSectionFromHeader(headerCells: string[]): "strength" | "cardio" | "unknown" {
  if (headerCells.some((h) => /重量/.test(h))) return "strength";
  if (headerCells.some((h) => /時間/.test(h))) return "cardio";
  return "unknown";
}

function parseExercisesFromTable(
  section: "strength" | "cardio",
  headerCells: string[],
  rows: any[],
): Exercise[] {
  const idx = {
    fb: headerCells.findIndex((h) => /^(FB|フィードバック)/.test(h)),
    name: headerCells.findIndex((h) => /^種目/.test(h)),
    weight: headerCells.findIndex((h) => /重量/.test(h)),
    sets: headerCells.findIndex((h) => /^セット/.test(h)),
    reps: headerCells.findIndex((h) => /^回数/.test(h)),
    duration: headerCells.findIndex((h) => /^時間/.test(h)),
    incline: headerCells.findIndex((h) => /(傾斜|incline)/i.test(h)),
    speed: headerCells.findIndex((h) => /(スピード|速度|speed)/i.test(h)),
  };

  const exercises: Exercise[] = [];
  for (const row of rows) {
    const cells = row.table_row?.cells ?? [];
    if (cells.length === 0) continue;

    if (section === "strength") {
      const name = idx.name >= 0 ? cellText(cells[idx.name]).trim() : "";
      const weight = idx.weight >= 0 ? cellText(cells[idx.weight]).trim() : "";
      const sets = idx.sets >= 0 ? cellText(cells[idx.sets]).trim() : "";
      const reps = idx.reps >= 0 ? cellText(cells[idx.reps]).trim() : "";
      const feedback = idx.fb >= 0 ? cellText(cells[idx.fb]) : "";
      if (!name && !weight && !sets && !reps) continue; // skip empty rows
      exercises.push({ type: "strength", name, weight, sets, reps, feedback });
    } else {
      const name = idx.name >= 0 ? cellText(cells[idx.name]).trim() : "";
      const duration = idx.duration >= 0 ? cellText(cells[idx.duration]).trim() : "";
      const incline = idx.incline >= 0 ? cellText(cells[idx.incline]).trim() : "";
      const speed = idx.speed >= 0 ? cellText(cells[idx.speed]).trim() : "";
      const feedback = idx.fb >= 0 ? cellText(cells[idx.fb]) : "";
      if (!name && !duration) continue;
      exercises.push({ type: "cardio", name, duration, incline, speed, feedback });
    }
  }
  return exercises;
}

async function fetchPageExercises(apiKey: string, pageId: string): Promise<Exercise[]> {
  const topBlocks = await listChildren(apiKey, pageId);
  const exercises: Exercise[] = [];

  for (const b of topBlocks) {
    if (b.type !== "table") continue;
    const rowBlocks = await listChildren(apiKey, b.id);
    if (rowBlocks.length === 0) continue;
    const headerCells = (rowBlocks[0].table_row?.cells ?? []).map(cellText);
    const section = detectSectionFromHeader(headerCells);
    if (section === "unknown") continue;
    const dataRows = rowBlocks.slice(1);
    exercises.push(...parseExercisesFromTable(section, headerCells, dataRows));
  }
  return exercises;
}

function formatFeedbackBlock(raw: string): string {
  // Normalize <br> tags and \r to newlines, trim
  const normalized = raw.replace(/<br\s*\/?>/gi, "\n").replace(/\r\n?/g, "\n").trim();
  if (!normalized) return "- FB:";
  const lines = normalized.split("\n").map((l) => l.trim()).filter((l) => l !== "");
  if (lines.length <= 1) return `- FB: ${lines[0] ?? ""}`;
  return ["- FB:", ...lines.map((l) => `  ${l}`)].join("\n");
}

function renderLocalMd(date: string, exercises: Exercise[]): string {
  const parts: string[] = [`# ジムログ ${date}`, ""];
  for (const e of exercises) {
    parts.push(`## ${e.name}`);
    if (e.type === "strength") {
      const segs: string[] = [];
      if (e.weight) segs.push(`${e.weight}kg`);
      if (e.reps) segs.push(`${e.reps}回`);
      if (e.sets) segs.push(`${e.sets}セット`);
      parts.push(`- 重量: ${segs.join(" × ")}`);
    } else {
      const segs: string[] = [];
      if (e.duration) segs.push(e.duration);
      if (e.incline) segs.push(`傾斜 ${e.incline}`);
      if (e.speed) segs.push(`スピード ${e.speed}`);
      parts.push(`- 内容: ${segs.join(" / ")}`);
    }
    parts.push(formatFeedbackBlock(e.feedback));
    parts.push("");
  }
  return parts.join("\n").replace(/\n+$/, "\n");
}

function getLatestLocalLogDate(): string | null {
  if (!existsSync(LOGS_DIR)) return null;
  const files = readdirSync(LOGS_DIR)
    .filter((f) => /^\d{4}-\d{2}-\d{2}\.md$/.test(f))
    .sort();
  if (files.length === 0) return null;
  return files[files.length - 1].replace(/\.md$/, "");
}

function isoToJST(iso: string | undefined | null): { date: string; time: string | null } | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  const fmt = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Tokyo",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  });
  const parts = fmt.formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const date = `${get("year")}-${get("month")}-${get("day")}`;
  const hh = get("hour");
  const mm = get("minute");
  const time = hh && mm ? `${hh}:${mm}` : null;
  return { date, time };
}

async function querySessionsSince(apiKey: string, dbId: string, sinceDate: string): Promise<SessionData[]> {
  const sessions: SessionData[] = [];
  let cursor: string | undefined;
  do {
    const body: any = {
      filter: { property: "日付", date: { on_or_after: `${sinceDate}T00:00:00+09:00` } },
      sorts: [{ property: "日付", direction: "ascending" }],
      page_size: 100,
    };
    if (cursor) body.start_cursor = cursor;
    const res = await notionFetch(apiKey, `/databases/${dbId}/query`, body);
    for (const page of res.results ?? []) {
      const dateObj = page.properties?.["日付"]?.date;
      const startInfo = isoToJST(dateObj?.start);
      const endInfo = isoToJST(dateObj?.end);
      if (!startInfo) continue;
      sessions.push({
        pageId: page.id,
        date: startInfo.date,
        startTime: startInfo.time,
        endTime: endInfo?.time ?? null,
        exercises: [],
      });
    }
    cursor = res.has_more ? res.next_cursor : undefined;
  } while (cursor);
  return sessions;
}

async function main() {
  const { flags, opts } = parseArgs();
  const dryRun = flags.has("dry-run");
  const force = flags.has("force");
  const all = flags.has("all");
  const sinceArg = opts["since"];

  const apiKey = getApiKey();
  const dbId = getGymDbId();

  // 同期対象の起点日を決定
  let sinceDate: string;
  if (sinceArg) {
    sinceDate = sinceArg;
  } else if (all) {
    sinceDate = "2020-01-01";
  } else {
    const latest = getLatestLocalLogDate();
    sinceDate = latest ?? "2020-01-01";
  }

  console.log(`${dryRun ? "[DRY RUN] " : ""}Notion ジム DB → ローカル md 同期`);
  console.log(`  起点日: ${sinceDate}（含む）`);
  console.log(`  出力先: ${LOGS_DIR}`);
  console.log(`  上書き: ${force ? "ON" : "OFF（既存はスキップ）"}`);
  console.log("");

  const sessions = await querySessionsSince(apiKey, dbId, sinceDate);
  console.log(`取得: ${sessions.length} セッション\n`);

  let written = 0, skipped = 0, fetched = 0;

  for (const s of sessions) {
    const filePath = join(LOGS_DIR, `${s.date}.md`);
    const exists = existsSync(filePath);

    if (exists && !force) {
      console.log(`  ⏭  ${s.date}  (既存・--force でなし)`);
      skipped++;
      continue;
    }

    s.exercises = await fetchPageExercises(apiKey, s.pageId);
    fetched++;

    if (s.exercises.length === 0) {
      console.log(`  ⚠️  ${s.date}  (種目データなし。スキップ)`);
      skipped++;
      continue;
    }

    const md = renderLocalMd(s.date, s.exercises);
    const action = exists ? "上書き" : "新規";
    console.log(`  ${dryRun ? "📋" : "✍️ "} ${s.date}  ${action}  ${s.exercises.length} 種目`);

    if (!dryRun) {
      writeFileSync(filePath, md, "utf-8");
    }
    written++;
  }

  console.log("");
  console.log("─".repeat(60));
  console.log(`${dryRun ? "[DRY RUN] " : ""}完了`);
  console.log(`  取得: ${sessions.length}  / 本文取得: ${fetched}  / 書き込み: ${written}  / スキップ: ${skipped}`);
}

main().catch((err) => {
  console.error("Error:", err.message ?? err);
  process.exit(1);
});
