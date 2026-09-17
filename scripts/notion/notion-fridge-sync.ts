#!/usr/bin/env bun
/**
 * fridge.md を Notion の「冷蔵庫の在庫」ページに同期する
 *
 * 使い方:
 *   bun run scripts/notion/notion-fridge-sync.ts           # 同期実行
 *   bun run scripts/notion/notion-fridge-sync.ts --dry-run  # ブロック数の確認のみ
 *
 * PostToolUse hook から自動呼び出しされる（fridge.md への Write を検知）。
 */

import { join } from "path";
import { readFileSync } from "fs";
import { notionFetch, getApiKey, parseArgs } from "./lib/notion";

const FRIDGE_PATH = join(import.meta.dir, "../../aspects/diet/fridge.md");
const PAGE_ID = "328ce17f-7b98-8123-be6b-e0bacfc7622e";

// --- MD → Notion block converter ---

function richText(text: string): any[] {
  const segments: any[] = [];
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  for (const part of parts) {
    const boldMatch = part.match(/^\*\*(.+)\*\*$/);
    if (boldMatch) {
      segments.push({ type: "text", text: { content: boldMatch[1] }, annotations: { bold: true } });
    } else if (part) {
      segments.push({ type: "text", text: { content: part } });
    }
  }
  return segments.length ? segments : [{ type: "text", text: { content: text } }];
}

function tableToNotionBlock(tableLines: string[]): any | null {
  // 区切り行（| --- | --- |）を除外
  const dataLines = tableLines.filter(l => !l.match(/^\|\s*[-: ]+\|/));
  if (dataLines.length === 0) return null;

  const rows = dataLines.map(line =>
    line.split("|").slice(1, -1).map(c => c.trim())
  );

  const tableWidth = Math.max(...rows.map(r => r.length));

  return {
    object: "block",
    type: "table",
    table: {
      table_width: tableWidth,
      has_column_header: true,
      has_row_header: false,
    },
    children: rows.map(cells => ({
      object: "block",
      type: "table_row",
      table_row: {
        cells: Array.from({ length: tableWidth }, (_, i) =>
          richText(cells[i] ?? "")
        ),
      },
    })),
  };
}

function mdToNotionBlocks(md: string): any[] {
  const lines = md.split("\n");
  const blocks: any[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // H1（ページタイトル）はスキップ
    if (line.startsWith("# ")) { i++; continue; }

    // Notion ページ ID 行はスキップ
    if (line.includes("Notion ページ ID:")) { i++; continue; }

    // H2
    if (line.startsWith("## ")) {
      blocks.push({ object: "block", type: "heading_2", heading_2: { rich_text: richText(line.slice(3).trim()) } });
      i++;
      continue;
    }

    // H3
    if (line.startsWith("### ")) {
      blocks.push({ object: "block", type: "heading_3", heading_3: { rich_text: richText(line.slice(4).trim()) } });
      i++;
      continue;
    }

    // Blockquote
    if (line.startsWith("> ")) {
      blocks.push({ object: "block", type: "quote", quote: { rich_text: richText(line.slice(2).trim()) } });
      i++;
      continue;
    }

    // Table（ヘッダー行・区切り行・データ行をまとめて処理）
    if (line.startsWith("|")) {
      const tableLines: string[] = [];
      while (i < lines.length && lines[i].startsWith("|")) {
        tableLines.push(lines[i]);
        i++;
      }
      const tableBlock = tableToNotionBlock(tableLines);
      if (tableBlock) blocks.push(tableBlock);
      continue;
    }

    // 空行スキップ
    if (line.trim() === "") { i++; continue; }

    // 通常段落
    blocks.push({ object: "block", type: "paragraph", paragraph: { rich_text: richText(line.trim()) } });
    i++;
  }

  return blocks;
}

// --- Notion API helpers ---

async function clearPageContent(apiKey: string, pageId: string): Promise<number> {
  const response = await notionFetch(apiKey, `/blocks/${pageId}/children`);
  const blocks = response.results || [];
  for (const block of blocks) {
    await notionFetch(apiKey, `/blocks/${block.id}`, undefined, "DELETE");
  }
  return blocks.length;
}

async function appendBlocks(apiKey: string, pageId: string, blocks: any[]): Promise<void> {
  const BATCH = 100;
  for (let i = 0; i < blocks.length; i += BATCH) {
    await notionFetch(apiKey, `/blocks/${pageId}/children`, { children: blocks.slice(i, i + BATCH) }, "PATCH");
  }
}

// --- Main ---

async function main() {
  const { flags } = parseArgs();
  const dryRun = flags.has("dry-run");

  const md = readFileSync(FRIDGE_PATH, "utf-8");
  const blocks = mdToNotionBlocks(md);

  if (dryRun) {
    console.log(`[dry-run] ${blocks.length} ブロックに変換されます`);
    blocks.forEach((b, idx) => {
      const label = b.type === "table" ? `table (${b.children?.length ?? 0} rows)` : b.type;
      console.log(`  ${idx + 1}. ${label}`);
    });
    return;
  }

  const apiKey = getApiKey();

  const deleted = await clearPageContent(apiKey, PAGE_ID);
  await appendBlocks(apiKey, PAGE_ID, blocks);

  console.log(`fridge-sync: ${deleted} 削除 → ${blocks.length} ブロックを Notion に同期`);
}

main().catch(err => {
  console.error("fridge-sync エラー:", err.message);
  process.exit(1);
});
