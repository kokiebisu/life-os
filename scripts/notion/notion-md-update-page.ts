#!/usr/bin/env bun
/**
 * MarkdownファイルをNotionページに書き込む（既存コンテンツを置換）
 *
 * 使い方:
 *   bun run scripts/notion/notion-md-update-page.ts --page-id <PAGE_ID> --file <MD_FILE>
 */

import { readFileSync } from "fs";
import { notionFetch, getApiKey, parseArgs } from "./lib/notion";

// --- MD → Notion block converter ---

function richText(text: string): any[] {
  const segments: any[] = [];
  // Handle bold (**text**)
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

function mdToNotionBlocks(md: string): any[] {
  const lines = md.split("\n");
  const blocks: any[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // H1
    if (line.startsWith("# ")) {
      blocks.push({ object: "block", type: "heading_1", heading_1: { rich_text: richText(line.slice(2).trim()) } });
      i++;
      continue;
    }

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

    // Horizontal rule
    if (/^---+$/.test(line.trim())) {
      blocks.push({ object: "block", type: "divider", divider: {} });
      i++;
      continue;
    }

    // Table — collect table lines and render as paragraph (Notion API doesn't support tables easily)
    if (line.startsWith("|")) {
      const tableLines: string[] = [];
      while (i < lines.length && lines[i].startsWith("|")) {
        tableLines.push(lines[i]);
        i++;
      }
      // Skip separator row (|---|---|)
      const filtered = tableLines.filter(l => !l.match(/^\|[\s\-|]+\|$/));
      for (const tline of filtered) {
        const cells = tline.split("|").map(c => c.trim()).filter(Boolean);
        const text = cells.join(" | ");
        blocks.push({ object: "block", type: "paragraph", paragraph: { rich_text: richText(text) } });
      }
      continue;
    }

    // Bullet list
    if (line.startsWith("- ") || line.startsWith("* ")) {
      const text = line.slice(2).trim();
      blocks.push({ object: "block", type: "bulleted_list_item", bulleted_list_item: { rich_text: richText(text) } });
      i++;
      continue;
    }

    // Numbered list (Q: or **Q:** style — treat as paragraph)
    // Quote / blockquote
    if (line.startsWith("> ")) {
      blocks.push({ object: "block", type: "quote", quote: { rich_text: richText(line.slice(2).trim()) } });
      i++;
      continue;
    }

    // Empty line
    if (line.trim() === "") {
      i++;
      continue;
    }

    // Regular paragraph
    blocks.push({ object: "block", type: "paragraph", paragraph: { rich_text: richText(line.trim()) } });
    i++;
  }

  return blocks;
}

async function clearPageContent(apiKey: string, pageId: string): Promise<number> {
  const response = await notionFetch(apiKey, `/blocks/${pageId}/children`);
  const blocks = response.results || [];
  let deleted = 0;
  for (const block of blocks) {
    await notionFetch(apiKey, `/blocks/${block.id}`, undefined, "DELETE");
    deleted++;
  }
  return deleted;
}

async function appendBlocks(apiKey: string, pageId: string, blocks: any[]): Promise<void> {
  const BATCH_SIZE = 100;
  for (let i = 0; i < blocks.length; i += BATCH_SIZE) {
    const batch = blocks.slice(i, i + BATCH_SIZE);
    await notionFetch(apiKey, `/blocks/${pageId}/children`, { children: batch }, "PATCH");
  }
}

// --- Main ---

async function main() {
  const { opts } = parseArgs();
  const pageId = opts["page-id"];
  const filePath = opts["file"];

  if (!pageId || !filePath) {
    console.error("Usage: bun run scripts/notion/notion-md-update-page.ts --page-id <PAGE_ID> --file <MD_FILE>");
    process.exit(1);
  }

  const apiKey = getApiKey();
  const md = readFileSync(filePath, "utf-8");

  console.log(`Converting ${filePath} to Notion blocks...`);
  const blocks = mdToNotionBlocks(md);
  console.log(`  ${blocks.length} blocks generated`);

  console.log(`Clearing existing content from page ${pageId}...`);
  const deleted = await clearPageContent(apiKey, pageId);
  console.log(`  ${deleted} blocks deleted`);

  console.log("Writing new blocks...");
  await appendBlocks(apiKey, pageId, blocks);
  console.log(`  Done! ${blocks.length} blocks written`);
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
