#!/usr/bin/env bun
/**
 * /gym plan 自動化
 *
 * 毎朝 GitHub Actions から呼ばれる。今日〜+2日にジム DB エントリが
 * 1件もなければ、今日 07:00–08:30 にジムセッションを Notion に登録する。
 *
 * 使い方:
 *   bun run scripts/gym/gym-auto.ts            # 本番実行
 *   bun run scripts/gym/gym-auto.ts --dry-run  # 登録せずログのみ
 */

import { existsSync, readFileSync, readdirSync } from "fs";
import { join, resolve } from "path";
import { spawnSync } from "child_process";
import { fileURLToPath } from "url";

import {
  getApiKey,
  getGymDbId,
  getScheduleDbConfig,
  notionFetch,
  queryDbByDate,
  todayJST,
  parseArgs,
  pickCover,
  GYM_DATA_SOURCE_ID,
  type ScheduleDbName,
} from "../notion/lib/notion";
import { pickEmptySlot, type Busy } from "./lib/empty-slot";
import {
  generateMenu,
  type MenuContext,
  type PrevSession,
  type SuggestedExercise,
} from "./lib/generate-menu";
import { buildNotionBlocks, type Exercise } from "./format-menu";

const REPO_ROOT = resolve(fileURLToPath(import.meta.url), "../../..");
const DISABLE_FLAG = join(REPO_ROOT, ".gym-auto.disabled");
const LOGS_DIR = join(REPO_ROOT, "aspects/gym/logs");
const MACHINES_PATH = join(REPO_ROOT, "aspects/gym/gyms/fitplace/minatomirai.md");
const DIARY_DIR = join(REPO_ROOT, "aspects/daily/diary");

const WINDOW_DAYS = 3;

const CONFLICT_DBS: ScheduleDbName[] = ["events", "todo", "meals", "devotion", "study"];

function addDays(dateStr: string, n: number): string {
  const d = new Date(dateStr + "T12:00:00+09:00");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function readOrEmpty(path: string): string {
  return existsSync(path) ? readFileSync(path, "utf-8") : "";
}

function timeFromIso(iso: string | null | undefined): string | null {
  if (!iso || !iso.includes("T")) return null;
  return new Date(iso).toLocaleTimeString("ja-JP", {
    timeZone: "Asia/Tokyo",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function runSubprocess(
  cmd: string[],
  opts: { stdin?: string } = {},
): { stdout: string; stderr: string; status: number } {
  const r = spawnSync(cmd[0]!, cmd.slice(1), {
    cwd: REPO_ROOT,
    encoding: "utf-8",
    input: opts.stdin,
  });
  return { stdout: r.stdout ?? "", stderr: r.stderr ?? "", status: r.status ?? 1 };
}

async function fetchGymRange(
  startDate: string,
  endDate: string,
): Promise<{ start: string; end: string | null }[]> {
  const apiKey = getApiKey();
  const dbId = getGymDbId();
  const res = await notionFetch(apiKey, `/databases/${dbId}/query`, {
    filter: {
      and: [
        { property: "日付", date: { on_or_after: startDate + "T00:00:00+09:00" } },
        { property: "日付", date: { on_or_before: endDate + "T23:59:59+09:00" } },
      ],
    },
    sorts: [{ property: "日付", direction: "ascending" }],
  });
  return (res.results ?? []).map((p: any) => {
    const d = p.properties?.["日付"]?.date;
    return { start: d?.start ?? "", end: d?.end ?? null };
  });
}

async function fetchBusyForDay(date: string): Promise<Busy[]> {
  const busy: Busy[] = [];
  for (const dbName of CONFLICT_DBS) {
    let cfg;
    try {
      cfg = getScheduleDbConfig(dbName);
    } catch {
      continue;
    }
    try {
      const res = await queryDbByDate(cfg.apiKey, cfg.dbId, cfg.config, date, date);
      for (const p of res.results ?? []) {
        const d = p.properties?.[cfg.config.dateProp]?.date;
        if (!d) continue;
        const s = timeFromIso(d.start);
        const e = timeFromIso(d.end ?? d.start);
        if (s && e) busy.push({ start: s, end: e });
      }
    } catch (err) {
      console.warn(`[warn] ${dbName} query failed: ${(err as Error).message}`);
    }
  }
  return busy;
}

function readPrevSessionFromLogs(): PrevSession | null {
  if (!existsSync(LOGS_DIR)) return null;
  const files = readdirSync(LOGS_DIR)
    .filter((f) => /^\d{4}-\d{2}-\d{2}\.md$/.test(f))
    .sort();
  if (files.length === 0) return null;
  const latest = files[files.length - 1]!;
  const date = latest.replace(/\.md$/, "");
  const today = todayJST();
  if (date !== addDays(today, -1)) return null;
  const content = readFileSync(join(LOGS_DIR, latest), "utf-8");
  const bodyParts: PrevSession["bodyParts"] = [];
  if (/ダンベルプレス|ベンチ|ショルダープレス|プレス/i.test(content)) bodyParts.push("push");
  if (/プルダウン|ロー|ラット|プル/i.test(content)) bodyParts.push("pull");
  if (/スクワット|レッグ|脚/i.test(content)) bodyParts.push("legs");
  if (/ウォーキング|有酸素|ランニング|バイク/i.test(content)) bodyParts.push("cardio");
  return { date, bodyParts };
}

function readLastThreeAux(): string[] {
  if (!existsSync(LOGS_DIR)) return [];
  const files = readdirSync(LOGS_DIR)
    .filter((f) => /^\d{4}-\d{2}-\d{2}\.md$/.test(f))
    .sort()
    .slice(-3);
  const aux = new Set<string>();
  const main = /^(ダンベルプレス|フィックスドプルダウン|スクワットマシン|ウォーキング)$/;
  for (const f of files) {
    const c = readFileSync(join(LOGS_DIR, f), "utf-8");
    for (const m of c.matchAll(/^##\s+(.+)$/gm)) {
      const name = m[1]!.trim();
      if (!main.test(name)) aux.add(name);
    }
  }
  return [...aux];
}

function readSuggestedWeights(): SuggestedExercise[] {
  const r = runSubprocess(["bun", "run", "scripts/gym/suggest-next-menu.ts", "--json"]);
  if (r.status !== 0) {
    console.warn(`[warn] suggest-next-menu failed: ${r.stderr}`);
    return [];
  }
  try {
    const j = JSON.parse(r.stdout);
    return (j.suggestions ?? []).map((s: any) => ({
      name: s.name,
      prevWeight: s.prevWeight,
      suggestedWeight: s.suggestedWeight,
      reps: s.prevReps ? Number(s.prevReps) : null,
      sets: s.prevSets ? Number(s.prevSets) : null,
      fb: s.fbCategory ?? "",
    }));
  } catch {
    return [];
  }
}

function readCondition(date: string): "low" | "normal" | "high" {
  const path = join(DIARY_DIR, `${date}.md`);
  const content = readOrEmpty(path);
  const m = content.match(/##\s*コンディション\s*\n+\s*(low|normal|high)/i);
  return ((m?.[1]?.toLowerCase() as "low" | "normal" | "high") ?? "normal");
}

function formatJpDateLabel(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00+09:00");
  const dow = ["日", "月", "火", "水", "木", "金", "土"][d.getUTCDay()];
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}（${dow}）`;
}

function toFormatExercises(
  raw: {
    type: "strength" | "cardio";
    name: string;
    weight?: string;
    sets?: number;
    reps?: number;
    duration?: string;
  }[],
): Exercise[] {
  return raw.map((e) =>
    e.type === "strength"
      ? {
          type: "strength" as const,
          name: e.name,
          weight: e.weight ?? "",
          sets: e.sets ?? 0,
          reps: e.reps ?? 0,
        }
      : {
          type: "cardio" as const,
          name: e.name,
          duration: e.duration ?? "",
        },
  );
}

async function createGymPage(args: {
  date: string;
  start: string;
  end: string;
}): Promise<{ pageId: string; url: string }> {
  const apiKey = getApiKey();
  const startIso = `${args.date}T${args.start}:00+09:00`;
  const endIso = `${args.date}T${args.end}:00+09:00`;
  const res = await notionFetch(apiKey, `/pages`, {
    parent: { type: "data_source_id", data_source_id: GYM_DATA_SOURCE_ID },
    icon: { type: "emoji", emoji: "🏋️" },
    cover: pickCover(),
    properties: {
      名前: { title: [{ text: { content: "ジム" } }] },
      日付: { date: { start: startIso, end: endIso } },
    },
  });
  return { pageId: res.id, url: res.url };
}

async function writePageBlocks(pageId: string, blocks: any[]): Promise<void> {
  const apiKey = getApiKey();
  for (let i = 0; i < blocks.length; i += 100) {
    await notionFetch(
      apiKey,
      `/blocks/${pageId}/children`,
      { children: blocks.slice(i, i + 100) },
      "PATCH",
    );
  }
}

async function main() {
  const { flags } = parseArgs();
  const dryRun = flags.has("dry-run");
  const today = todayJST();
  const endDate = addDays(today, WINDOW_DAYS - 1);

  if (existsSync(DISABLE_FLAG)) {
    console.log("[skip] .gym-auto.disabled exists");
    return;
  }

  const sync = runSubprocess(["bun", "run", "scripts/gym/sync-notion-to-md.ts"]);
  if (sync.status !== 0) {
    console.warn(`[warn] sync-notion-to-md failed: ${sync.stderr}`);
  }

  const existing = await fetchGymRange(today, endDate);
  console.log(`[check] ${today}..${endDate}: ${existing.length} entries`);
  if (existing.length > 0) {
    console.log(`[skip] ${existing.length} entries already in window`);
    return;
  }

  const busy = await fetchBusyForDay(today);
  const slot = pickEmptySlot(busy);
  if (!slot) {
    console.log("[skip] no slot today (07:00–12:30 all conflict)");
    return;
  }
  console.log(`[slot] ${today} ${slot.start}–${slot.end}`);

  const ctx: MenuContext = {
    date: today,
    startTime: slot.start,
    endTime: slot.end,
    prevSession: readPrevSessionFromLogs(),
    lastThreeAux: readLastThreeAux(),
    suggestedWeights: readSuggestedWeights(),
    condition: readCondition(today),
    machines: readOrEmpty(MACHINES_PATH),
  };

  console.log("[generate] calling Claude API...");
  const menu = await generateMenu(ctx);
  console.log(`[generated] ${menu.exercises.length} exercises — ${menu.rationale}`);

  if (dryRun) {
    console.log("[dry-run] menu JSON:");
    console.log(JSON.stringify(menu, null, 2));
    return;
  }

  const recheck = await fetchGymRange(today, endDate);
  if (recheck.length > 0) {
    console.log(`[skip] re-check: ${recheck.length} entries (race)`);
    return;
  }

  const validate = runSubprocess([
    "bun", "run", "scripts/validate-entry.ts",
    "--date", today, "--title", "ジム",
    "--start", slot.start, "--end", slot.end,
  ]);
  if (validate.status === 1) {
    console.log("[skip] validate-entry found a duplicate");
    return;
  }

  const page = await createGymPage({ date: today, start: slot.start, end: slot.end });
  console.log(`[created] page ${page.pageId} ${page.url}`);

  const blocks = buildNotionBlocks(
    { date: formatJpDateLabel(today), time: `${slot.start}〜${slot.end}` },
    toFormatExercises(menu.exercises),
  );
  await writePageBlocks(page.pageId, blocks);

  runSubprocess(["bun", "run", "scripts/cache-status.ts", "--clear"]);

  console.log(`[done] ${today} ${slot.start}–${slot.end}: ${menu.exercises.length} exercises`);
}

main().catch((e) => {
  console.error("[error]", e);
  process.exit(1);
});
