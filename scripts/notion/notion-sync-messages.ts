#!/usr/bin/env bun
/**
 * aspects/church/messages/*.md → Notion メッセージDB 同期
 *
 * 使い方:
 *   bun run scripts/notion/notion-sync-messages.ts              # 全ファイル同期
 *   bun run scripts/notion/notion-sync-messages.ts --dry-run    # プレビュー
 *   bun run scripts/notion/notion-sync-messages.ts --date 2026-04-03  # 特定日のみ
 */

import { readdirSync, readFileSync } from "fs";
import { join, basename } from "path";
import { getApiKey, getDbId, notionFetch, parseArgs } from "./lib/notion";

const ROOT = join(import.meta.dir, "../..");
const MESSAGES_DIR = join(ROOT, "aspects/church/messages");

// --- Types ---

interface ParsedMessage {
  date: string;       // "2026-04-03"
  title: string;      // 「十字架の元へ行こう」
  series: string;     // Good Friday 礼拝
  points: string;     // ポイントセクションの内容
  notes: string;      // メモセクションの内容
  raw: string;        // 元のMarkdown全文
}

interface NotionMessage {
  id: string;
  date: string | null;    // Normalized to YYYY-MM-DD
  dateRaw: string | null; // Original start value (may include time)
  title: string;
  seriesName: string | null;
}

// Canonical series select option names in Notion メッセージDB
const SERIES_SELECT_OPTIONS = [
  "Stay Tuned!",
  "Good Friday 礼拝",
  "イースター礼拝",
  "Growth",
  "Series Break",
];

function normalizeSeries(raw: string): string | null {
  if (!raw) return null;
  const exact = SERIES_SELECT_OPTIONS.find((opt) => opt === raw);
  if (exact) return exact;
  if (/stay\s*tuned/i.test(raw)) return "Stay Tuned!";
  for (const opt of SERIES_SELECT_OPTIONS) {
    if (raw.includes(opt) || opt.includes(raw)) return opt;
  }
  return null;
}

// --- Parse message MD file ---

function parseMessageFile(content: string, filename: string): ParsedMessage {
  const dateMatch = filename.match(/^(\d{4}-\d{2}-\d{2})\.md$/);
  const date = dateMatch ? dateMatch[1] : "";

  const titleMatch = content.match(/^\*\*タイトル:\*\*\s*(.+)$/m);
  const seriesMatch = content.match(/^\*\*シリーズ:\*\*\s*(.+)$/m);

  const title = titleMatch ? titleMatch[1].trim().replace(/^「|」$/g, "") : "";
  const series = seriesMatch ? seriesMatch[1].trim().replace(/^[""]|[""]$/g, "") : "";

  // Extract ポイント section
  const pointsMatch = content.match(/## ポイント\n([\s\S]*?)(?=\n---|\n## |$)/);
  const points = pointsMatch ? pointsMatch[1].trim() : "";

  // Extract メモ section
  const notesMatch = content.match(/## メモ\n([\s\S]*?)(?=\n---|\n## |$)/);
  const notes = notesMatch ? notesMatch[1].trim() : "";

  return { date, title, series, points, notes, raw: content };
}

// --- List existing Notion entries ---

async function listNotionMessages(apiKey: string, dbId: string): Promise<NotionMessage[]> {
  const data = await notionFetch(apiKey, `/databases/${dbId}/query`, {
    page_size: 100,
  });

  return data.results.map((page: any) => {
    const rawStart = page.properties["日付"]?.date?.start ?? null;
    return {
      id: page.id,
      date: rawStart ? rawStart.slice(0, 10) : null,
      dateRaw: rawStart,
      title: page.properties["タイトル"]?.title?.[0]?.plain_text ?? "",
      seriesName: page.properties["シリーズ"]?.select?.name ?? null,
    };
  });
}

// Pick the right entry when multiple Notion entries share a date.
// Preference: same series > earliest time of day > any.
function pickBestMatch(candidates: NotionMessage[], targetSeries: string | null): NotionMessage | null {
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0];

  if (targetSeries) {
    const seriesMatch = candidates.filter((c) => c.seriesName === targetSeries);
    if (seriesMatch.length === 1) return seriesMatch[0];
    if (seriesMatch.length > 1) candidates = seriesMatch;
  }

  // Earliest time of day (Sunday morning service typically earliest)
  return [...candidates].sort((a, b) => (a.dateRaw ?? "").localeCompare(b.dateRaw ?? ""))[0];
}

// --- Update page body ---
//
// ポリシー: Notion ページのプロパティ（タイトル・シリーズ・テーマ・日付）は一切触らない。
// それらはカレンダー同期・手動設定が source of truth。
// このスクリプトはページ本文（ブロック）のみを MD から同期する。
// 対応する Notion ページが存在しない場合はスキップ（作成しない）。

async function syncMessageBody(
  apiKey: string,
  msg: ParsedMessage,
  existingId: string | null,
  dryRun: boolean
): Promise<void> {
  if (!existingId) {
    console.log(`  スキップ: ${msg.date} 「${msg.title}」（Notion ページ未作成）`);
    return;
  }

  console.log(`  更新: ${msg.date} 「${msg.title}」`);
  if (dryRun) return;

  const bodyBlocks = buildBlocks(msg.raw);
  if (bodyBlocks.length === 0) return;

  // Clear existing body blocks, then append new ones
  const existing = await notionFetch(apiKey, `/blocks/${existingId}/children`);
  for (const block of existing.results ?? []) {
    await notionFetch(apiKey, `/blocks/${block.id}`, undefined, "DELETE");
  }
  await notionFetch(apiKey, `/blocks/${existingId}/children`, {
    children: bodyBlocks,
  }, "PATCH");
}

// --- Build Notion blocks from Markdown ---

/** Remove lone surrogates and truncate to Notion's 2000-char rich_text limit */
function rt(str: string, max = 2000): string {
  // Strip lone surrogates (would produce invalid JSON in some runtimes)
  let s = "";
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);
    if (code >= 0xD800 && code <= 0xDBFF) {
      const next = str.charCodeAt(i + 1);
      if (next >= 0xDC00 && next <= 0xDFFF) { s += str[i] + str[i + 1]; i++; }
      // else lone high surrogate — skip
    } else if (code >= 0xDC00 && code <= 0xDFFF) {
      // lone low surrogate — skip
    } else {
      s += str[i];
    }
  }
  return s.slice(0, max);
}

/**
 * Parse inline markdown (currently **bold**) into Notion rich_text segments.
 * Drops lone surrogates and truncates total length to Notion's 2000-char limit per segment.
 */
function parseInlineRichText(text: string): any[] {
  const segments: any[] = [];
  const re = /\*\*([^*]+)\*\*/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) {
      segments.push({
        type: "text",
        text: { content: rt(text.slice(last, m.index)) },
      });
    }
    segments.push({
      type: "text",
      text: { content: rt(m[1]) },
      annotations: { bold: true },
    });
    last = m.index + m[0].length;
  }
  if (last < text.length) {
    segments.push({
      type: "text",
      text: { content: rt(text.slice(last)) },
    });
  }
  return segments.length > 0 ? segments : [{ type: "text", text: { content: rt(text) } }];
}

function buildBlocks(content: string): any[] {
  const blocks: any[] = [];
  const lines = content.split("\n");
  let i = 0;

  // Skip frontmatter: everything up to and including the first `---` divider
  // (H1 title, **シリーズ:**, **タイトル:**, **場所:** etc. are already captured as DB properties)
  const firstDivider = lines.findIndex((l) => l.startsWith("---"));
  if (firstDivider >= 0) i = firstDivider + 1;

  while (i < lines.length) {
    const line = lines[i];

    if (line.startsWith("## ")) {
      blocks.push({
        type: "heading_2",
        heading_2: { rich_text: parseInlineRichText(line.slice(3).trim()) },
      });
      i++;
      continue;
    }

    if (line.startsWith("### ")) {
      blocks.push({
        type: "heading_3",
        heading_3: { rich_text: parseInlineRichText(line.slice(4).trim()) },
      });
      i++;
      continue;
    }

    if (line.startsWith("---")) {
      blocks.push({ type: "divider", divider: {} });
      i++;
      continue;
    }

    // Block quote (possibly multi-line)
    if (line.startsWith("> ")) {
      const quoteLines: string[] = [];
      while (i < lines.length && lines[i].startsWith("> ")) {
        quoteLines.push(lines[i].slice(2));
        i++;
      }
      blocks.push({
        type: "quote",
        quote: { rich_text: parseInlineRichText(quoteLines.join("\n")) },
      });
      continue;
    }

    if (line.startsWith("- ")) {
      blocks.push({
        type: "bulleted_list_item",
        bulleted_list_item: { rich_text: parseInlineRichText(line.slice(2).trim()) },
      });
      i++;
      continue;
    }

    if (line.match(/^\d+\. /)) {
      blocks.push({
        type: "numbered_list_item",
        numbered_list_item: { rich_text: parseInlineRichText(line.replace(/^\d+\. /, "").trim()) },
      });
      i++;
      continue;
    }

    if (line.trim() === "") {
      i++;
      continue;
    }

    // Paragraph
    blocks.push({
      type: "paragraph",
      paragraph: { rich_text: parseInlineRichText(line.trim()) },
    });
    i++;
  }

  // Notion API: max 100 blocks per request
  return blocks.slice(0, 100);
}

// --- Main ---

async function main() {
  const { flags, opts } = parseArgs();
  const dryRun = flags.has("dry-run");
  const targetDate = opts["date"] as string | undefined;

  const apiKey = getApiKey();
  const dbId = getDbId("NOTION_CHURCH_MESSAGES_DB");

  // Read message files
  const files = readdirSync(MESSAGES_DIR)
    .filter((f) => f.match(/^\d{4}-\d{2}-\d{2}\.md$/))
    .sort();

  const messages: ParsedMessage[] = files
    .filter((f) => !targetDate || f.startsWith(targetDate))
    .map((f) => parseMessageFile(readFileSync(join(MESSAGES_DIR, f), "utf-8"), f));

  if (messages.length === 0) {
    console.log("対象ファイルなし");
    return;
  }

  console.log(`${dryRun ? "[dry-run] " : ""}${messages.length} 件のメッセージを同期します...`);

  // Fetch existing Notion entries
  const existing = await listNotionMessages(apiKey, dbId);

  for (const msg of messages) {
    const sameDate = existing.filter((e) => e.date === msg.date);
    const found = pickBestMatch(sameDate, normalizeSeries(msg.series));
    await syncMessageBody(apiKey, msg, found?.id ?? null, dryRun);
  }

  console.log(`\n完了${dryRun ? "（dry-run）" : ""}。`);
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
