#!/usr/bin/env bun
/**
 * Notion → repo 逆同期
 *
 * Notion 上の変更（時間変更・完了マーク・フィードバック）をリポジトリのイベントファイルに反映する。
 *
 * 対象 DB:
 *   events  → planning/events/YYYY-MM-DD.md
 *   guitar  → aspects/guitar/events/YYYY-MM-DD.md
 *   sound   → aspects/sound/events/YYYY-MM-DD.md
 *   meals   → aspects/diet/events/YYYY-MM-DD.md
 *   todo    → planning/tasks.md (Inbox/Archive)
 *
 * 使い方:
 *   bun run scripts/notion-pull.ts                     # 今日
 *   bun run scripts/notion-pull.ts --date 2026-02-16   # 指定日
 *   bun run scripts/notion-pull.ts --days 7            # 複数日
 *   bun run scripts/notion-pull.ts --db events         # DB 指定
 *   bun run scripts/notion-pull.ts --dry-run           # プレビュー
 *   bun run scripts/notion-pull.ts --no-enrich         # 移動時間エンリッチなし
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import {
  type ScheduleDbName, type NormalizedEntry,
  SCHEDULE_DB_CONFIGS, getScheduleDbConfigOptional, queryDbByDate, queryDbByDateCached, normalizePages,
  notionFetch, getApiKey, clearNotionCache,
  parseArgs, todayJST, loadEnv, getHomeAddress,
  pickTaskIcon, pickCover,
} from "./lib/notion";
import { estimateTravelTime } from "./lib/travel";

const ROOT = join(import.meta.dir, "..");

// --- DB → file path mapping ---

const EVENT_DBS: ScheduleDbName[] = ["events", "guitar", "sound", "meals", "routine", "groceries"];
const TASKS_FILE = join(ROOT, "planning/tasks.md");

function dbToDir(db: ScheduleDbName): string {
  switch (db) {
    case "events": return "planning/events";
    case "guitar": return "aspects/guitar/events";
    case "sound": return "aspects/sound/events";
    case "meals": return "aspects/diet/events";
    case "routine": return "aspects/routine/events";
    case "groceries": return "aspects/diet/groceries";
    default: throw new Error(`Unsupported DB for pull: ${db}`);
  }
}

function eventFilePath(db: ScheduleDbName, date: string): string {
  return join(ROOT, dbToDir(db), `${date}.md`);
}

// --- Parsing (same regex as notion-sync-event-file.ts) ---

interface FileEntry {
  done: boolean;
  startTime: string;
  endTime: string;
  allDay: boolean;
  title: string;
  tags: string;       // e.g. " #todo #groceries"
  descLines: string[];
  feedbackLine: string;
}

function parseEventFile(filePath: string): FileEntry[] {
  if (!existsSync(filePath)) return [];
  const content = readFileSync(filePath, "utf-8");
  const lines = content.split("\n");
  const entries: FileEntry[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const m = line.match(/^- \[([ x])\]\s+(?:(\d{1,2}:\d{2})\s*[-–〜]\s*(\d{1,2}:\d{2})\s+|終日\s+)?(.+)$/);
    if (!m) continue;

    const done = m[1] === "x";
    const startTime = m[2] ? m[2].padStart(5, "0") : "";
    const endTime = m[3] ? m[3].padStart(5, "0") : "";
    const allDay = !m[2];
    const rawTitle = m[4].trim();

    // Extract tags (#todo, #groceries, etc.)
    const tagMatch = rawTitle.match(/(\s+#\w+(?:\s+#\w+)*)$/);
    const tags = tagMatch ? tagMatch[1] : "";
    const title = tagMatch ? rawTitle.slice(0, -tags.length) : rawTitle;

    // Collect sub-bullet lines
    const descLines: string[] = [];
    let feedbackLine = "";
    let j = i + 1;
    while (j < lines.length && lines[j].match(/^\s{2,}-\s/)) {
      const sub = lines[j].replace(/^\s{2,}-\s/, "").trim();
      if (sub.startsWith("💬")) {
        feedbackLine = sub.replace(/^💬\s*/, "");
      } else if (sub.startsWith("🕐")) {
        // Skip travel time annotation (regenerated from actualStart/actualEnd)
      } else {
        descLines.push(sub);
      }
      j++;
    }

    entries.push({ done, startTime, endTime, allDay, title, tags, descLines, feedbackLine });
  }

  return entries;
}

// --- Title matching (same logic as notion-sync-event-file.ts) ---

function normalizeTitle(title: string): string {
  return title.replace(/[（）()]/g, "").replace(/\s+/g, "").toLowerCase();
}

// Meal prefixes that can change between sync cycles (朝食→昼食 etc.)
const MEAL_PREFIXES = /^(朝食|昼食|夕食|間食|おやつ|ブランチ)/;

function titlesMatch(a: string, b: string): boolean {
  const na = normalizeTitle(a);
  const nb = normalizeTitle(b);
  if (na.includes(nb) || nb.includes(na)) return true;

  // Meal content match: 朝食（X）vs 昼食（X）→ match if food content X is the same
  const contentA = a.replace(MEAL_PREFIXES, "");
  const contentB = b.replace(MEAL_PREFIXES, "");
  if (contentA !== a && contentB !== b) {
    return normalizeTitle(contentA) === normalizeTitle(contentB);
  }

  return false;
}

// --- Time extraction from ISO string ---

function extractTime(iso: string): string {
  if (!iso || !iso.includes("T")) return "";
  const d = new Date(iso);
  const h = d.toLocaleString("ja-JP", { timeZone: "Asia/Tokyo", hour: "2-digit", minute: "2-digit", hour12: false });
  return h;
}

// --- Merge ---

interface MergedEntry {
  done: boolean;
  startTime: string;
  endTime: string;
  allDay: boolean;
  title: string;
  tags: string;
  descLines: string[];
  feedbackLine: string;
  source: "both" | "notion" | "file";
  actualStart: string;
  actualEnd: string;
  location: string;
  notionId: string;
  hasIcon: boolean;
  hasCover: boolean;
  dbName: ScheduleDbName | "";
  changed: boolean;
  // before→after diff tracking (populated for UPDATE entries)
  oldStartTime: string;
  oldEndTime: string;
  oldDone: boolean;
  oldFeedbackLine: string;
}

function mergeEntries(notionEntries: NormalizedEntry[], fileEntries: FileEntry[], dbName: ScheduleDbName): { merged: MergedEntry[]; added: number; updated: number; kept: number; dropped: string[] } {
  const used = new Set<number>();
  const merged: MergedEntry[] = [];
  let added = 0, updated = 0, kept = 0;
  const dropped: string[] = [];

  // Match Notion entries to file entries
  for (const ne of notionEntries) {
    let matchIdx = -1;
    for (let i = 0; i < fileEntries.length; i++) {
      if (used.has(i)) continue;
      if (titlesMatch(ne.title, fileEntries[i].title)) {
        matchIdx = i;
        break;
      }
    }

    const notionStart = extractTime(ne.start);
    const notionEnd = ne.end ? extractTime(ne.end) : "";
    const isAllDay = !ne.start.includes("T");
    const isDone = ne.status === "Done" || ne.status === "完了";

    if (matchIdx >= 0) {
      // Matched — Notion values win for time/status, keep file tags
      used.add(matchIdx);
      const fe = fileEntries[matchIdx];
      const changed = fe.startTime !== notionStart || fe.endTime !== notionEnd || fe.done !== isDone || (ne.feedback && fe.feedbackLine !== ne.feedback);
      if (changed) updated++;
      else kept++;

      merged.push({
        done: isDone,
        startTime: notionStart || fe.startTime,
        endTime: notionEnd || fe.endTime,
        allDay: isAllDay && fe.allDay,
        title: ne.title,
        tags: fe.tags,
        descLines: fe.descLines,
        feedbackLine: ne.feedback || fe.feedbackLine,
        source: "both",
        actualStart: ne.actualStart || "",
        actualEnd: ne.actualEnd || "",
        location: ne.location || "",
        notionId: ne.id,
        hasIcon: ne.hasIcon,
        hasCover: ne.hasCover,
        dbName,
        changed,
        oldStartTime: fe.startTime,
        oldEndTime: fe.endTime,
        oldDone: fe.done,
        oldFeedbackLine: fe.feedbackLine,
      });
    } else {
      // Notion only — new entry
      added++;
      merged.push({
        done: isDone,
        startTime: notionStart,
        endTime: notionEnd,
        allDay: isAllDay,
        title: ne.title,
        tags: "",
        descLines: ne.description ? [ne.description] : [],
        feedbackLine: ne.feedback || "",
        source: "notion",
        actualStart: ne.actualStart || "",
        actualEnd: ne.actualEnd || "",
        location: ne.location || "",
        notionId: ne.id,
        hasIcon: ne.hasIcon,
        hasCover: ne.hasCover,
        dbName,
        changed: true,
        oldStartTime: "",
        oldEndTime: "",
        oldDone: false,
        oldFeedbackLine: "",
      });
    }
  }

  // File-only entries (not matched to Notion) — drop them
  // If Notion has entries for this date but a local entry has no match,
  // it was likely deleted from Notion and should be removed locally too.
  // Only keep file-only entries when Notion returned zero entries (offline/error safety).
  if (notionEntries.length === 0) {
    for (let i = 0; i < fileEntries.length; i++) {
      if (used.has(i)) continue;
      kept++;
      const fe = fileEntries[i];
      merged.push({
        done: fe.done,
        startTime: fe.startTime,
        endTime: fe.endTime,
        allDay: fe.allDay,
        title: fe.title,
        tags: fe.tags,
        descLines: fe.descLines,
        feedbackLine: fe.feedbackLine,
        source: "file",
        actualStart: "",
        actualEnd: "",
        location: "",
        notionId: "",
        hasIcon: true,
        hasCover: true,
        dbName: "",
        changed: false,
        oldStartTime: "",
        oldEndTime: "",
        oldDone: false,
        oldFeedbackLine: "",
      });
    }
  }

  // File-only entries: drop timed entries (deleted from Notion), keep all-day (local-only data)
  for (let i = 0; i < fileEntries.length; i++) {
    if (used.has(i)) continue;
    const fe = fileEntries[i];
    if (notionEntries.length > 0 && !fe.allDay) {
      // Timed entry not in Notion — likely deleted, drop it
      dropped.push(fe.title);
    } else {
      // All-day or no Notion data — keep as local-only
      kept++;
      merged.push({
        done: fe.done,
        startTime: fe.startTime,
        endTime: fe.endTime,
        allDay: fe.allDay,
        title: fe.title,
        tags: fe.tags,
        descLines: fe.descLines,
        feedbackLine: fe.feedbackLine,
        source: "file",
        actualStart: "",
        actualEnd: "",
        location: "",
        notionId: "",
        hasIcon: true,
        hasCover: true,
        dbName: "",
        changed: false,
        oldStartTime: "",
        oldEndTime: "",
        oldDone: false,
        oldFeedbackLine: "",
      });
    }
  }

  return { merged, added, updated, kept, dropped };
}

// --- Cross-DB overlap resolution ---

const DB_PRIORITY: Record<ScheduleDbName, number> = {
  events: 100,
  todo: 80,
  guitar: 60,
  sound: 60,
  meals: 40,
  routine: 20,
  groceries: 10,
};

function timeToMinutes(time: string): number {
  if (!time) return 0;
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

function hasTimeOverlap(a: MergedEntry, b: MergedEntry): boolean {
  if (a.allDay || b.allDay) return false;
  if (!a.startTime || !b.startTime || !a.endTime || !b.endTime) return false;
  const aStart = timeToMinutes(a.startTime);
  const aEnd = timeToMinutes(a.endTime);
  const bStart = timeToMinutes(b.startTime);
  const bEnd = timeToMinutes(b.endTime);
  return aStart < bEnd && bStart < aEnd;
}

interface OverlapRemoval {
  entry: MergedEntry;
  db: ScheduleDbName;
  reason: string;
}

/**
 * Cross-DB overlap resolution: higher-priority DB entries win.
 * Modifies entriesByDb in-place (removes losers).
 */
function resolveOverlaps(
  entriesByDb: Map<ScheduleDbName, MergedEntry[]>,
): OverlapRemoval[] {
  const allEntries: { entry: MergedEntry; db: ScheduleDbName }[] = [];
  for (const [db, entries] of entriesByDb) {
    for (const entry of entries) {
      if (!entry.allDay && entry.startTime && entry.endTime) {
        allEntries.push({ entry, db });
      }
    }
  }

  // Sort by priority descending
  allEntries.sort((a, b) => (DB_PRIORITY[b.db] || 0) - (DB_PRIORITY[a.db] || 0));

  const removals: OverlapRemoval[] = [];
  const removedSet = new Set<MergedEntry>();

  for (let i = 0; i < allEntries.length; i++) {
    if (removedSet.has(allEntries[i].entry)) continue;
    for (let j = i + 1; j < allEntries.length; j++) {
      if (removedSet.has(allEntries[j].entry)) continue;
      if (allEntries[i].db === allEntries[j].db) continue;

      if (hasTimeOverlap(allEntries[i].entry, allEntries[j].entry)) {
        removedSet.add(allEntries[j].entry);
        removals.push({
          entry: allEntries[j].entry,
          db: allEntries[j].db,
          reason: `${allEntries[i].entry.title}（${allEntries[i].db}）と時間が重複`,
        });
      }
    }
  }

  // Remove losers from entriesByDb
  for (const [db, entries] of entriesByDb) {
    entriesByDb.set(db, entries.filter(e => !removedSet.has(e)));
  }

  return removals;
}

// --- Render ---

function renderFile(date: string, entries: MergedEntry[]): string {
  // Sort: timed entries by startTime, then all-day at end
  entries.sort((a, b) => {
    if (a.allDay && !b.allDay) return 1;
    if (!a.allDay && b.allDay) return -1;
    return (a.startTime || "").localeCompare(b.startTime || "");
  });

  const lines: string[] = [`# ${date}`, ""];
  for (const e of entries) {
    const check = e.done ? "[x]" : "[ ]";
    let timePart: string;
    if (e.allDay) {
      timePart = "終日";
    } else {
      timePart = `${e.startTime}-${e.endTime}`;
    }
    const tagPart = e.tags || "";
    lines.push(`- ${check} ${timePart} ${e.title}${tagPart}`);
    if (e.actualStart && e.actualEnd) {
      const actualMinutes = parseInt(e.actualStart.split(":")[0]) * 60 + parseInt(e.actualStart.split(":")[1]);
      const startMinutes = parseInt(e.startTime.split(":")[0]) * 60 + parseInt(e.startTime.split(":")[1]);
      const travelMinutes = actualMinutes - startMinutes;
      lines.push(`  - 🕐 ${e.actualStart}-${e.actualEnd}（移動${travelMinutes}分）`);
    }
    for (const desc of e.descLines) {
      lines.push(`  - ${desc}`);
    }
    if (e.feedbackLine) {
      lines.push(`  - 💬 ${e.feedbackLine}`);
    }
  }
  lines.push("");
  return lines.join("\n");
}

// --- Travel time enrichment ---

function extractLocation(title: string): string | null {
  const m = title.match(/\s*@\s*(.+)$/);
  return m ? m[1].trim() : null;
}

async function resolveAddress(placeName: string): Promise<string> {
  const env = loadEnv();
  const apiKey = env["GOOGLE_MAPS_API_KEY"] || process.env.GOOGLE_MAPS_API_KEY;
  if (apiKey) {
    try {
      const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(placeName)}&key=${apiKey}&language=ja`;
      const res = await fetch(url);
      const data = await res.json() as { results?: Array<{ formatted_address?: string }> };
      if (data.results?.[0]?.formatted_address) {
        return data.results[0].formatted_address;
      }
    } catch {
      // fall through to return original
    }
  }
  return placeName;
}

function subtractMinutes(time: string, minutes: number): string {
  const [h, m] = time.split(":").map(Number);
  const total = h * 60 + m - minutes;
  const newH = Math.floor(total / 60);
  const newM = total % 60;
  return `${String(newH).padStart(2, "0")}:${String(newM).padStart(2, "0")}`;
}

function addMinutes(time: string, minutes: number): string {
  const [h, m] = time.split(":").map(Number);
  const total = h * 60 + m + minutes;
  const newH = Math.floor(total / 60);
  const newM = total % 60;
  return `${String(newH).padStart(2, "0")}:${String(newM).padStart(2, "0")}`;
}

async function enrichEntries(entries: MergedEntry[], date: string, dryRun: boolean): Promise<number> {
  const homeAddress = getHomeAddress();
  let enriched = 0;

  for (const entry of entries) {
    if (entry.allDay) continue;

    const needsIconCover = !entry.hasIcon || !entry.hasCover;
    const needsTravelTime = !entry.actualStart && (entry.location || extractLocation(entry.title));

    if (!needsIconCover && !needsTravelTime) continue;

    // Icon/cover enrichment
    if (needsIconCover && !dryRun && entry.notionId) {
      const updates: Record<string, unknown> = {};
      if (!entry.hasIcon) updates.icon = pickTaskIcon(entry.title);
      if (!entry.hasCover) updates.cover = pickCover();
      if (Object.keys(updates).length > 0) {
        console.log(`  ENRICH: ${entry.title} — adding icon/cover`);
        await notionFetch(getApiKey(), `/pages/${entry.notionId}`, updates, "PATCH");
        entry.hasIcon = true;
        entry.hasCover = true;
      }
    } else if (needsIconCover && dryRun) {
      console.log(`  ENRICH: ${entry.title} — would add icon/cover`);
    }

    // Travel time enrichment
    if (!needsTravelTime) continue;

    const location = entry.location || extractLocation(entry.title)!;
    const eventStart = entry.startTime;
    const eventEnd = entry.endTime;
    if (!eventStart) continue;

    console.log(`  ENRICH: ${entry.title} — calculating travel time...`);

    try {
      const departureIso = `${date}T${eventStart}:00+09:00`;
      const result = await estimateTravelTime(homeAddress, location, departureIso);
      const travelMinutes = result.minutes;

      const newStart = subtractMinutes(eventStart, travelMinutes);
      const newEnd = addMinutes(eventEnd || eventStart, travelMinutes);

      console.log(`    🚃 移動${travelMinutes}分 → ${newStart}-${newEnd}（実際: ${eventStart}-${eventEnd}）`);

      // Update merged entry
      entry.actualStart = eventStart;
      entry.actualEnd = eventEnd;
      entry.startTime = newStart;
      entry.endTime = newEnd;

      // Resolve address
      const resolvedAddress = await resolveAddress(location);
      if (!entry.location) entry.location = resolvedAddress;

      // Update Notion page
      if (!dryRun && entry.notionId) {
        // Determine the date property name for this DB
        const dateProp = entry.dbName
          ? SCHEDULE_DB_CONFIGS[entry.dbName as ScheduleDbName]?.dateProp || "日付"
          : "日付";

        const properties: Record<string, unknown> = {
          [dateProp]: {
            date: {
              start: `${date}T${newStart}:00+09:00`,
              end: `${date}T${newEnd}:00+09:00`,
            },
          },
        };

        // Only set 開始時間/終了時間/場所 for events DB (other DBs may not have these properties)
        if (entry.dbName === "events") {
          properties["開始時間"] = { rich_text: [{ text: { content: eventStart } }] };
          properties["終了時間"] = { rich_text: [{ text: { content: eventEnd } }] };
          properties["場所"] = { rich_text: [{ text: { content: resolvedAddress } }] };
        }

        const updates: Record<string, unknown> = { properties };
        if (!entry.hasIcon) updates.icon = pickTaskIcon(entry.title);
        if (!entry.hasCover) updates.cover = pickCover();

        await notionFetch(getApiKey(), `/pages/${entry.notionId}`, updates, "PATCH");
      }

      enriched++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`    ⚠ Travel time error: ${msg}`);
    }
  }

  return enriched;
}

// --- Tasks.md parsing & merge (todo DB) ---

interface TaskEntry {
  done: boolean;
  title: string;
  rawLine: string; // original line for preservation
}

function parseTasksFile(): { header: string; inbox: TaskEntry[]; footer: string } {
  if (!existsSync(TASKS_FILE)) return { header: "", inbox: [], footer: "" };
  const content = readFileSync(TASKS_FILE, "utf-8");
  const lines = content.split("\n");

  let inboxStart = -1;
  let archiveStart = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].match(/^## Inbox/)) inboxStart = i;
    if (lines[i].match(/^## Archive/)) archiveStart = i;
  }
  if (inboxStart === -1) return { header: content, inbox: [], footer: "" };

  const headerEnd = inboxStart + 1; // line after "## Inbox"
  const inboxEnd = archiveStart !== -1 ? archiveStart : lines.length;
  const header = lines.slice(0, headerEnd).join("\n");
  const footer = archiveStart !== -1 ? lines.slice(archiveStart).join("\n") : "## Archive\n\n<!-- 完了タスクが月別に整理される -->";

  const inbox: TaskEntry[] = [];
  for (let i = headerEnd; i < inboxEnd; i++) {
    const m = lines[i].match(/^- \[([ x])\]\s+(.+)$/);
    if (!m) continue;
    // Extract title (strip date/tag/deadline suffixes for matching)
    const rawTitle = m[2];
    const cleanTitle = rawTitle
      .replace(/\s*\(\d{4}-\d{2}-\d{2}\)/, "")  // (2026-02-13)
      .replace(/\s*📅\s*\d{4}-\d{2}-\d{2}/, "")  // 📅 2026-02-13
      .replace(/\s*#\w+/g, "")                     // #tag
      .trim();
    inbox.push({ done: m[1] === "x", title: cleanTitle, rawLine: lines[i] });
  }

  return { header, inbox, footer };
}

function mergeTaskEntries(
  notionEntries: NormalizedEntry[],
  inbox: TaskEntry[],
): { updatedInbox: TaskEntry[]; newEntries: NormalizedEntry[]; completed: number; added: number; kept: number } {
  const used = new Set<number>();
  let completed = 0, kept = 0;
  const updatedInbox = inbox.map((task, idx) => ({ ...task, _idx: idx }));
  const newEntries: NormalizedEntry[] = [];

  for (const ne of notionEntries) {
    const isDone = ne.status === "Done" || ne.status === "完了";
    let matchIdx = -1;
    for (let i = 0; i < updatedInbox.length; i++) {
      if (used.has(i)) continue;
      if (titlesMatch(ne.title, updatedInbox[i].title)) {
        matchIdx = i;
        break;
      }
    }

    if (matchIdx >= 0) {
      used.add(matchIdx);
      const task = updatedInbox[matchIdx];
      if (isDone && !task.done) {
        // Mark as completed
        task.done = true;
        task.rawLine = task.rawLine.replace("- [ ]", "- [x]");
        completed++;
      } else {
        kept++;
      }
    } else {
      // New entry from Notion not in tasks.md
      newEntries.push(ne);
    }
  }

  // Count unmatched file entries as kept
  kept += inbox.length - used.size - completed;

  return { updatedInbox, newEntries, completed, added: newEntries.length, kept };
}

function renderTasksFile(header: string, inbox: TaskEntry[], footer: string, newEntries: NormalizedEntry[], today: string): string {
  const activeInbox = inbox.filter(t => !t.done);
  const completedInbox = inbox.filter(t => t.done);

  const lines: string[] = [header, ""];

  // Active inbox items
  for (const t of activeInbox) {
    lines.push(t.rawLine);
  }

  // New entries from Notion
  for (const ne of newEntries) {
    const isDone = ne.status === "Done" || ne.status === "完了";
    const check = isDone ? "[x]" : "[ ]";
    const dateStr = ne.start ? ne.start.split("T")[0] : today;
    lines.push(`- ${check} ${ne.title} (${today}) 📅 ${dateStr}`);
    if (isDone) {
      completedInbox.push({ done: true, title: ne.title, rawLine: `- [x] ${ne.title} (${today}) 📅 ${dateStr}` });
    }
  }

  // Preserve the marker comment
  lines.push("<!-- 新しいタスクはここに追加される -->");
  lines.push("");

  // Build archive
  const footerLines = footer.split("\n");
  const archiveLines: string[] = [];
  // Find existing archive content
  let inArchiveHeader = false;
  for (const l of footerLines) {
    if (l.match(/^## Archive/)) {
      archiveLines.push(l);
      inArchiveHeader = true;
      continue;
    }
    archiveLines.push(l);
  }
  if (archiveLines.length === 0) {
    archiveLines.push("## Archive", "");
  }

  // Add newly completed items to archive under current month
  if (completedInbox.length > 0) {
    const monthKey = today.slice(0, 7); // YYYY-MM
    const monthHeader = `### ${monthKey}`;

    // Check if month header exists
    const monthIdx = archiveLines.findIndex(l => l.trim() === monthHeader);
    if (monthIdx === -1) {
      // Add month header after "## Archive" line
      const archiveIdx = archiveLines.findIndex(l => l.match(/^## Archive/));
      const insertAt = archiveIdx + 1;
      const toInsert = ["", monthHeader, ""];
      for (const t of completedInbox) {
        toInsert.push(t.rawLine);
      }
      archiveLines.splice(insertAt, 0, ...toInsert);
    } else {
      // Find end of this month's section
      let insertAt = monthIdx + 1;
      while (insertAt < archiveLines.length && !archiveLines[insertAt].match(/^###\s/)) {
        insertAt++;
      }
      for (const t of completedInbox) {
        // Avoid duplicates
        const exists = archiveLines.some(l => l.includes(t.title));
        if (!exists) {
          archiveLines.splice(insertAt, 0, t.rawLine);
          insertAt++;
        }
      }
    }
  }

  lines.push(...archiveLines);
  lines.push("");
  return lines.join("\n");
}

// --- Main ---

async function main() {
  const { flags, opts } = parseArgs();
  const dryRun = flags.has("dry-run");
  const noEnrich = flags.has("no-enrich");
  const dbFilter = opts.db as ScheduleDbName | undefined;
  const days = opts.days ? parseInt(opts.days, 10) : 1;

  const baseDate = opts.date || todayJST();
  const dates: string[] = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(baseDate + "T12:00:00+09:00");
    d.setDate(d.getDate() + i);
    dates.push(d.toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" }));
  }

  const eventDbs = dbFilter
    ? (dbFilter === "todo" ? [] : [dbFilter])
    : EVENT_DBS;
  const pullTodo = !dbFilter || dbFilter === "todo";

  if (dryRun) {
    console.log("[DRY RUN] Preview mode — no files will be written\n");
  }

  let totalAdded = 0, totalUpdated = 0, totalKept = 0, totalRemoved = 0, totalEnriched = 0;

  const today = todayJST();

  // --- Event DBs → event files ---
  for (const date of dates) {
    const isPast = date < today;

    // Phase 1: Pull and merge all DBs (defer file writing)
    interface DbResult {
      merged: MergedEntry[];
      final: MergedEntry[];
      filePath: string;
      added: number;
      updated: number;
      kept: number;
      pastRemoved: number;
      dropped: string[];
      db: ScheduleDbName;
    }
    const dateResults: DbResult[] = [];

    for (const db of eventDbs) {
      const dbConf = getScheduleDbConfigOptional(db);
      if (!dbConf) continue;
      const { apiKey, dbId, config } = dbConf;

      const data = await queryDbByDateCached(apiKey, dbId, config, date, date);
      const notionEntries = normalizePages(data.results, config, db);

      const filePath = eventFilePath(db, date);
      const fileEntries = parseEventFile(filePath);

      if (notionEntries.length === 0 && fileEntries.length === 0) continue;

      const { merged, added, updated, kept, dropped } = mergeEntries(notionEntries, fileEntries, db);

      let final = merged;
      let pastRemoved = 0;
      if (isPast) {
        final = merged.filter(e => e.done);
        pastRemoved = merged.length - final.length;
      }

      dateResults.push({
        merged, final: [...final], filePath, added, updated,
        kept: kept - pastRemoved, pastRemoved, dropped, db,
      });
    }

    // Phase 2: Cross-DB overlap resolution (future dates only)
    let overlapRemovals: OverlapRemoval[] = [];
    if (!isPast && dateResults.length > 1) {
      const entriesByDb = new Map<ScheduleDbName, MergedEntry[]>();
      for (const r of dateResults) {
        entriesByDb.set(r.db, r.final);
      }
      overlapRemovals = resolveOverlaps(entriesByDb);
      for (const r of dateResults) {
        r.final = entriesByDb.get(r.db) || r.final;
      }
    }

    // Phase 3: Enrich, log, and write files
    for (const r of dateResults) {
      if (!noEnrich && !isPast) {
        const enrichCount = await enrichEntries(r.final, date, dryRun);
        totalEnriched += enrichCount;
      }

      totalAdded += r.added;
      totalUpdated += r.updated;
      totalKept += r.kept;
      totalRemoved += r.pastRemoved;

      const relPath = r.filePath.replace(ROOT + "/", "");
      console.log(`${relPath} [${r.db}]:`);
      const logEntries = isPast ? r.merged : r.final;
      for (const e of logEntries) {
        const isRemoved = isPast && !e.done;
        const tag = isRemoved ? "REMOVE"
          : e.source === "notion" ? "ADD"
          : e.source === "both" ? (e.changed ? "UPDATE" : "KEEP")
          : "KEEP";
        const time = e.allDay ? "終日" : `${e.startTime}-${e.endTime}`;
        const fb = e.feedbackLine ? ` 💬 ${e.feedbackLine}` : "";
        const travel = e.actualStart && e.changed ? ` (実際: ${e.actualStart}-${e.actualEnd})` : "";
        console.log(`  ${tag}: ${e.done ? "✅" : "⬜"} ${time} ${e.title}${travel}${fb}`);

        // Show before→after diff for UPDATE entries
        if (tag === "UPDATE" && e.source === "both") {
          const diffs: string[] = [];
          const oldTime = e.oldStartTime && e.oldEndTime ? `${e.oldStartTime}-${e.oldEndTime}` : "";
          const newTime = e.startTime && e.endTime ? `${e.startTime}-${e.endTime}` : "";
          if (oldTime && newTime && oldTime !== newTime) {
            diffs.push(`時間: ${oldTime} → ${newTime}`);
          }
          if (e.oldDone !== e.done) {
            diffs.push(`ステータス: ${e.oldDone ? "✅" : "⬜"} → ${e.done ? "✅" : "⬜"}`);
          }
          if (e.feedbackLine && e.oldFeedbackLine !== e.feedbackLine) {
            if (e.oldFeedbackLine) {
              diffs.push(`💬: "${e.oldFeedbackLine}" → "${e.feedbackLine}"`);
            } else {
              diffs.push(`💬 追加: "${e.feedbackLine}"`);
            }
          }
          if (diffs.length > 0) {
            console.log(`    ↳ ${diffs.join(" / ")}`);
          }
        }
      }
      for (const d of r.dropped) {
        console.log(`  DROP: ${d} (not in Notion)`);
      }

      if (!dryRun) {
        const content = renderFile(date, r.final);
        const dir = dirname(r.filePath);
        if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
        writeFileSync(r.filePath, content);
      }
    }

    // Phase 4: Delete overlapping entries from Notion
    if (overlapRemovals.length > 0) {
      console.log(`\n⚡ Overlap resolution for ${date}:`);
      for (const removal of overlapRemovals) {
        const time = `${removal.entry.startTime}-${removal.entry.endTime}`;
        console.log(`  DELETE: ${time} ${removal.entry.title} [${removal.db}] — ${removal.reason}`);
        if (!dryRun && removal.entry.notionId) {
          clearNotionCache();
          await notionFetch(getApiKey(), `/pages/${removal.entry.notionId}`, {
            archived: true,
          }, "PATCH");
        }
      }
      totalRemoved += overlapRemovals.length;
    }
  }

  // --- Todo DB → planning/tasks.md ---
  if (pullTodo) {
    const todoConf = getScheduleDbConfigOptional("todo");
    if (todoConf) {
      const { apiKey, dbId, config } = todoConf;

      // Fetch all dates in range
      const allNotionTodos: NormalizedEntry[] = [];
      for (const date of dates) {
        const data = await queryDbByDateCached(apiKey, dbId, config, date, date);
        allNotionTodos.push(...normalizePages(data.results, config, "todo"));
      }

      if (allNotionTodos.length > 0) {
        const { header, inbox, footer } = parseTasksFile();
        const { updatedInbox, newEntries, completed, added, kept } = mergeTaskEntries(allNotionTodos, inbox);

        // Past uncompleted todos: clear date in Notion so they leave the calendar
        const pastUncompleted = allNotionTodos.filter(ne => {
          const isDone = ne.status === "Done" || ne.status === "完了";
          const entryDate = ne.start ? ne.start.split("T")[0] : "";
          return !isDone && entryDate < today;
        });

        totalUpdated += completed;
        totalAdded += added;
        totalKept += kept;

        console.log(`planning/tasks.md [todo]:`);
        for (const ne of allNotionTodos) {
          const isDone = ne.status === "Done" || ne.status === "完了";
          const matchedTask = updatedInbox.find(t => titlesMatch(ne.title, t.title));
          const isNew = newEntries.some(n => n.id === ne.id);
          const isPastUncompleted = pastUncompleted.some(p => p.id === ne.id);
          const tag = isPastUncompleted ? "UNSCHEDULE"
            : isNew ? "ADD"
            : (matchedTask && isDone ? "DONE" : "KEEP");
          console.log(`  ${tag}: ${isDone ? "✅" : "⬜"} ${ne.title}`);
          // Show diff for DONE (was unchecked → now completed)
          if (tag === "DONE" && matchedTask && !inbox.find(t => titlesMatch(ne.title, t.title))?.done) {
            console.log(`    ↳ ステータス: ⬜ → ✅`);
          }
        }

        if (!dryRun) {
          const content = renderTasksFile(header, updatedInbox, footer, newEntries, baseDate);
          writeFileSync(TASKS_FILE, content);

          // Delete past uncompleted todos from Notion (archive page)
          clearNotionCache();
          for (const ne of pastUncompleted) {
            console.log(`  → Deleting: ${ne.title}`);
            await notionFetch(getApiKey(), `/pages/${ne.id}`, {
              archived: true,
            }, "PATCH");
          }
        }
      }
    }
  }

  // --- Enrich future unenriched pages (icon/cover) across all DBs ---
  if (!noEnrich) {
    const futureEnd = new Date(today + "T12:00:00+09:00");
    futureEnd.setDate(futureEnd.getDate() + 60);
    const futureEndDate = futureEnd.toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });
    // Dates already processed above — skip them in the enrich pass
    const processedSet = new Set(dates);

    for (const db of EVENT_DBS) {
      const dbConf = getScheduleDbConfigOptional(db);
      if (!dbConf) continue;
      const data = await queryDbByDate(dbConf.apiKey, dbConf.dbId, dbConf.config, today, futureEndDate);
      const pages = (data.results || []) as any[];
      for (const page of pages) {
        // Skip pages already enriched in the date-based pass
        const dateStr = page.properties?.[dbConf.config.dateProp]?.date?.start?.split("T")[0] || "";
        if (processedSet.has(dateStr)) continue;

        const hasIcon = !!page.icon;
        const hasCover = !!page.cover;
        if (hasIcon && hasCover) continue;

        const titleArr = page.properties?.[dbConf.config.titleProp]?.title || [];
        const title = titleArr.map((t: any) => t.plain_text || "").join("");

        if (!dryRun) {
          const updates: Record<string, unknown> = {};
          if (!hasIcon) updates.icon = pickTaskIcon(title);
          if (!hasCover) updates.cover = pickCover();
          console.log(`  ENRICH: ${title} [${db}] — adding icon/cover`);
          await notionFetch(getApiKey(), `/pages/${page.id}`, updates, "PATCH");
        } else {
          console.log(`  ENRICH: ${title} [${db}] — would add icon/cover`);
        }
        totalEnriched++;
      }
    }
  }

  const parts = [`Added: ${totalAdded}`, `Updated: ${totalUpdated}`, `Kept: ${totalKept}`];
  if (totalEnriched > 0) parts.push(`Enriched: ${totalEnriched}`);
  if (totalRemoved > 0) parts.push(`Removed: ${totalRemoved}`);
  console.log(`\nDone! ${parts.join(", ")}`);

  // --- Regenerate daily plan from current Notion state ---
  if (!dryRun) {
    console.log(`\nRegenerating daily plan for ${baseDate}...`);
    const planProc = Bun.spawn(
      ["bun", "run", "scripts/notion-daily-plan.ts", "--date", baseDate],
      { stdout: "pipe", stderr: "pipe", cwd: ROOT },
    );
    const planOutput = await new Response(planProc.stdout).text();
    const planErr = await new Response(planProc.stderr).text();
    await planProc.exited;
    if (planProc.exitCode === 0 && planOutput.trim()) {
      const dailyPath = join(ROOT, "planning", "daily", `${baseDate}.md`);
      const dir = dirname(dailyPath);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      writeFileSync(dailyPath, planOutput);
      console.log(`Updated planning/daily/${baseDate}.md`);
    } else if (planErr) {
      console.error(`Daily plan generation failed: ${planErr}`);
    }
  }

  // --- Push local event changes back to Notion ---
  if (!dryRun) {
    console.log(`\nSyncing local events → Notion...`);
    for (const date of dates) {
      const eventFiles = [
        join(ROOT, "planning", "events", `${date}.md`),
        join(ROOT, "aspects", "diet", "events", `${date}.md`),
        join(ROOT, "aspects", "guitar", "events", `${date}.md`),
      ];
      for (const f of eventFiles) {
        if (!existsSync(f)) continue;
        const relPath = f.replace(ROOT + "/", "");
        const syncProc = Bun.spawn(
          ["bun", "run", "scripts/notion-sync-event-file.ts", "--file", relPath],
          { stdout: "pipe", stderr: "pipe", cwd: ROOT },
        );
        const syncOut = await new Response(syncProc.stdout).text();
        await syncProc.exited;
        if (syncOut.trim()) {
          for (const line of syncOut.trim().split("\n")) {
            if (line.includes("SKIP") && line.includes("no changes")) continue;
            console.log(`  ${line}`);
          }
        }
      }
    }

    // Sync routine schedule
    for (const date of dates) {
      const schedProc = Bun.spawn(
        ["bun", "run", "scripts/notion-sync-schedule.ts", "--date", date],
        { stdout: "pipe", stderr: "pipe", cwd: ROOT },
      );
      const schedOut = await new Response(schedProc.stdout).text();
      await schedProc.exited;
      if (schedOut.trim() && !schedOut.includes("全てのルーティンは登録済み")) {
        for (const line of schedOut.trim().split("\n")) {
          console.log(`  ${line}`);
        }
      }
    }
  }
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
