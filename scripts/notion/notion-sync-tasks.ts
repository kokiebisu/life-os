#!/usr/bin/env bun
/**
 * tasks.md ↔ Notion やることDB 同期
 *
 * Notion が source of truth。
 * - Notion 未着手 → tasks.md Inbox に反映
 * - Notion 完了 → tasks.md で [x] にして Archive へ
 * - tasks.md にあって Notion にないもの → Notion に新規作成
 *
 * 使い方:
 *   bun run scripts/notion-sync-tasks.ts              # 同期実行
 *   bun run scripts/notion-sync-tasks.ts --dry-run     # プレビュー
 */

import { readFileSync, writeFileSync } from "fs";
import { join } from "path";
import {
  getScheduleDbConfig, notionFetch, parseArgs, todayJST, pickTaskIcon, pickCover, clearNotionCache,
} from "./lib/notion";

const ROOT = join(import.meta.dir, "..", "..");
const TASKS_FILE = join(ROOT, "aspects/tasks.md");

// --- Types ---

interface TaskLine {
  done: boolean;
  title: string;
  captureDate: string;     // "2026-02-12"
  aspect: string | null;   // "#planning" → "planning"
  deadline: string | null;  // "2026-02-14"
  raw: string;              // original markdown line
}

interface NotionTodo {
  id: string;
  title: string;
  status: string;           // "未着手" | "完了"
  deadline: string | null;  // "2026-02-13" (date only)
  description: string;
  createdTime: string;      // ISO string
}

// --- Parse tasks.md ---

function parseTasksFile(content: string): {
  header: string;
  inbox: TaskLine[];
  archive: string;
  inboxComment: string;
} {
  const lines = content.split("\n");

  let inboxStart = -1;
  let archiveStart = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].match(/^## Inbox/)) inboxStart = i;
    if (lines[i].match(/^## Archive/)) archiveStart = i;
  }

  if (inboxStart === -1) throw new Error("## Inbox section not found in tasks.md");

  const inboxEnd = archiveStart !== -1 ? archiveStart : lines.length;
  const header = lines.slice(0, inboxStart + 1).join("\n");
  const inboxLines = lines.slice(inboxStart + 1, inboxEnd);
  const archive = archiveStart !== -1 ? lines.slice(archiveStart).join("\n") : "## Archive\n\n<!-- 完了タスクが月別に整理される -->";

  // Parse inbox task lines
  const inbox: TaskLine[] = [];
  let inboxComment = "";

  for (const line of inboxLines) {
    const taskMatch = line.match(/^- \[([ x])\] (.+)$/);
    if (taskMatch) {
      const done = taskMatch[1] === "x";
      const rest = taskMatch[2];

      // Extract capture date: (YYYY-MM-DD)
      const dateMatch = rest.match(/\((\d{4}-\d{2}-\d{2})\)/);
      const captureDate = dateMatch ? dateMatch[1] : "";

      // Extract aspect: #aspect
      const aspectMatch = rest.match(/#(\w+)/);
      const aspect = aspectMatch ? aspectMatch[1] : null;

      // Extract deadline: 📅 YYYY-MM-DD
      const deadlineMatch = rest.match(/📅\s*(\d{4}-\d{2}-\d{2})/);
      const deadline = deadlineMatch ? deadlineMatch[1] : null;

      // Extract title (remove date, aspect, deadline markers)
      const title = rest
        .replace(/\s*\(\d{4}-\d{2}-\d{2}\)/, "")
        .replace(/\s*#\w+/, "")
        .replace(/\s*📅\s*\d{4}-\d{2}-\d{2}/, "")
        .trim();

      inbox.push({ done, title, captureDate, aspect, deadline, raw: line });
    } else if (line.includes("<!-- ") && line.includes("-->")) {
      inboxComment = line;
    }
  }

  return { header, inbox, archive, inboxComment };
}

// --- Format task line ---

function formatTaskLine(task: { done: boolean; title: string; captureDate: string; aspect?: string | null; deadline?: string | null }): string {
  let line = `- [${task.done ? "x" : " "}] ${task.title} (${task.captureDate})`;
  if (task.aspect) line += ` #${task.aspect}`;
  if (task.deadline) line += ` 📅 ${task.deadline}`;
  return line;
}

// --- Notion queries ---

async function fetchAllTodos(apiKey: string, dbId: string): Promise<NotionTodo[]> {
  const todos: NotionTodo[] = [];
  let cursor: string | undefined = undefined;

  do {
    const body: Record<string, unknown> = {
      sorts: [{ property: "日付", direction: "ascending" }],
      page_size: 100,
    };
    if (cursor) body.start_cursor = cursor;

    const data = await notionFetch(apiKey, `/databases/${dbId}/query`, body);

    for (const page of data.results) {
      const titleArr = page.properties["タスク名"]?.title || [];
      const dateObj = page.properties["日付"]?.date;
      const descArr = page.properties["説明"]?.rich_text || [];
      const status = page.properties["ステータス"]?.status?.name || "";

      todos.push({
        id: page.id,
        title: titleArr.map((t: any) => t.plain_text || "").join(""),
        status,
        deadline: dateObj?.start ? dateObj.start.split("T")[0] : null,
        description: descArr.map((t: any) => t.plain_text || "").join(""),
        createdTime: page.created_time,
      });
    }

    cursor = data.has_more ? data.next_cursor : undefined;
  } while (cursor);

  return todos;
}

// --- Title matching ---

function normTitle(s: string): string {
  return s
    .replace(/[（）()【】\[\]]/g, "")
    .replace(/\s+/g, "")
    .toLowerCase();
}

function titlesMatch(a: string, b: string): boolean {
  const na = normTitle(a);
  const nb = normTitle(b);
  if (na === nb) return true;
  if (na.length > 3 && nb.length > 3) {
    return na.includes(nb) || nb.includes(na);
  }
  return false;
}

// --- Build archive section ---

function addToArchive(archive: string, taskLine: string, month: string): string {
  const monthHeader = `### ${month}`;
  if (archive.includes(monthHeader)) {
    // Add under existing month header
    const idx = archive.indexOf(monthHeader);
    const nextHeaderIdx = archive.indexOf("\n### ", idx + monthHeader.length);
    const insertPos = nextHeaderIdx !== -1 ? nextHeaderIdx : archive.length;
    return archive.slice(0, insertPos).trimEnd() + "\n" + taskLine + "\n" + archive.slice(insertPos);
  } else {
    // Add new month section at end
    return archive.trimEnd() + "\n\n" + monthHeader + "\n\n" + taskLine + "\n";
  }
}

// --- Main ---

async function main() {
  const { flags } = parseArgs();
  const dryRun = flags.has("dry-run");
  const today = todayJST();
  const currentMonth = today.slice(0, 7); // "2026-02"

  if (dryRun) {
    console.log("[DRY RUN] Preview mode - no changes will be made\n");
  }

  // 1. Fetch all todos from Notion
  const { apiKey, dbId } = getScheduleDbConfig("todo");
  console.log("Fetching Notion やることDB...");
  const notionTodos = await fetchAllTodos(apiKey, dbId);
  console.log(`  ${notionTodos.length} 件取得\n`);

  // 2. Parse tasks.md
  const content = readFileSync(TASKS_FILE, "utf-8");
  const { header, inbox, archive, inboxComment } = parseTasksFile(content);

  let updatedArchive = archive;
  const newInbox: TaskLine[] = [];
  let created = 0, archived = 0, kept = 0, added = 0;

  // 3. Match Notion todos against tasks.md inbox
  const matchedNotionIds = new Set<string>();
  const matchedInboxIndices = new Set<number>();

  for (const todo of notionTodos) {
    // Find matching inbox item
    let matchIdx = -1;
    for (let i = 0; i < inbox.length; i++) {
      if (matchedInboxIndices.has(i)) continue;
      if (titlesMatch(inbox[i].title, todo.title)) {
        matchIdx = i;
        break;
      }
    }

    if (todo.status === "完了") {
      if (matchIdx !== -1) {
        // Move completed task to archive
        const task = inbox[matchIdx];
        const archiveLine = formatTaskLine({ done: true, title: task.title, captureDate: task.captureDate, aspect: task.aspect, deadline: task.deadline });
        updatedArchive = addToArchive(updatedArchive, archiveLine, currentMonth);
        matchedInboxIndices.add(matchIdx);
        matchedNotionIds.add(todo.id);
        console.log(`  ARCHIVE: ${todo.title}`);
        archived++;
      } else {
        // Completed but not in inbox — just track as matched
        matchedNotionIds.add(todo.id);
      }
    } else {
      // 未着手 → should be in inbox
      matchedNotionIds.add(todo.id);
      if (matchIdx !== -1) {
        // Already in inbox — keep it (update deadline if changed)
        const task = inbox[matchIdx];
        matchedInboxIndices.add(matchIdx);
        newInbox.push({
          ...task,
          deadline: todo.deadline || task.deadline,
        });
        console.log(`  KEEP: ${todo.title}`);
        kept++;
      } else {
        // Not in inbox — add it
        const captureDate = todo.createdTime.split("T")[0];
        newInbox.push({
          done: false,
          title: todo.title,
          captureDate,
          aspect: null,
          deadline: todo.deadline,
          raw: "",
        });
        console.log(`  ADD: ${todo.title}`);
        added++;
      }
    }
  }

  // 4. Tasks in inbox but NOT in Notion → create in Notion
  for (let i = 0; i < inbox.length; i++) {
    if (matchedInboxIndices.has(i)) continue;
    const task = inbox[i];
    if (task.done) {
      // Already done in tasks.md — move to archive
      const archiveLine = formatTaskLine({ done: true, title: task.title, captureDate: task.captureDate, aspect: task.aspect, deadline: task.deadline });
      updatedArchive = addToArchive(updatedArchive, archiveLine, currentMonth);
      console.log(`  ARCHIVE (local): ${task.title}`);
      archived++;
    } else {
      // Create in Notion
      console.log(`  CREATE in Notion: ${task.title}`);
      if (!dryRun) {
        const properties: Record<string, unknown> = {
          "タスク名": { title: [{ text: { content: task.title } }] },
        };
        if (task.deadline) {
          properties["日付"] = { date: { start: task.deadline } };
        }
        if (task.aspect) {
          properties["説明"] = { rich_text: [{ text: { content: `#${task.aspect}` } }] };
        }
        const icon = pickTaskIcon(task.title);
        const cover = pickCover();
        await notionFetch(apiKey, "/pages", { parent: { database_id: dbId }, properties, icon, cover });
      }
      newInbox.push(task);
      created++;
    }
  }

  // 5. Write updated tasks.md
  // Sort inbox: tasks with deadlines first (by deadline), then by capture date
  newInbox.sort((a, b) => {
    if (a.deadline && !b.deadline) return -1;
    if (!a.deadline && b.deadline) return 1;
    if (a.deadline && b.deadline) return a.deadline.localeCompare(b.deadline);
    return a.captureDate.localeCompare(b.captureDate);
  });

  const inboxLines = newInbox.map((t) => formatTaskLine(t));
  const output = [
    header,
    "",
    ...inboxLines,
    inboxComment || "<!-- 新しいタスクはここに追加される -->",
    "",
    updatedArchive,
  ].join("\n");

  if (!dryRun) {
    writeFileSync(TASKS_FILE, output);
    if (created > 0 || archived > 0) {
      clearNotionCache();
    }
  }

  console.log(`\n--- Summary ---`);
  console.log(`  Keep:     ${kept}`);
  console.log(`  Add:      ${added}`);
  console.log(`  Archive:  ${archived}`);
  console.log(`  Create:   ${created} (→ Notion)`);
  if (dryRun) {
    console.log("\n[DRY RUN] No changes written.");
    console.log("\nPreview tasks.md Inbox:");
    for (const line of inboxLines) {
      console.log(`  ${line}`);
    }
  } else {
    console.log(`\ntasks.md updated.`);
  }
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
