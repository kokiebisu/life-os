#!/usr/bin/env bun
/**
 * notion-update-sound-lessons.ts
 *
 * Reads sound lesson markdown files and updates corresponding Notion pages
 * with the lesson content (stripping title, 復習メニュー, 次回予告, and Phase まとめ sections).
 *
 * Usage: bun run scripts/notion-update-sound-lessons.ts
 */

const NOTION_API_KEY = process.env.NOTION_API_KEY;
if (!NOTION_API_KEY) {
  console.error("Error: NOTION_API_KEY environment variable is not set");
  process.exit(1);
}

const NOTION_VERSION = "2022-06-28";
const API_BASE = "https://api.notion.com/v1";

// Lesson number → Notion page ID mapping
const LESSON_PAGE_IDS: Record<number, string> = {
  1: "313ce17f-7b98-816f-a8d4-e412e6294c2a",
  2: "313ce17f-7b98-8161-b1d3-fa496202d3d8",
  3: "313ce17f-7b98-8176-bfed-d88f9f584206",
  4: "313ce17f-7b98-810b-874d-f1c3e694bc29",
  5: "313ce17f-7b98-81f8-b283-e016c467baf7",
  6: "313ce17f-7b98-8153-9f5a-efd0bd91f7f1",
  7: "313ce17f-7b98-81a8-b525-de4854c4e18b",
  8: "313ce17f-7b98-8196-9a57-e0994b68f772",
  9: "313ce17f-7b98-8133-8e20-f5f97d57c9cd",
  10: "313ce17f-7b98-81d7-b91d-d053b493db9d",
  11: "313ce17f-7b98-81fa-8e26-e86d3f459e72",
  12: "313ce17f-7b98-81aa-8469-df4811770ea6",
  13: "313ce17f-7b98-810e-a505-d3b5d89f224d",
  14: "313ce17f-7b98-8144-83f8-f50f24ed5c40",
  15: "313ce17f-7b98-81f4-86cc-e91d2b397a79",
  16: "313ce17f-7b98-815e-9f4e-dbaf0b966fda",
  17: "313ce17f-7b98-81ab-89e2-cfcc0a3602f9",
  18: "313ce17f-7b98-8134-8353-d12ce4649027",
  19: "313ce17f-7b98-8145-92f7-edace9dc3ed5",
  20: "313ce17f-7b98-81b8-bb03-d383069f21c7",
  21: "313ce17f-7b98-81fb-899b-c242fd71e4cc",
  22: "313ce17f-7b98-81c0-a543-dc7d0b38c632",
  23: "313ce17f-7b98-8114-b2a2-eaad4b1e1fbc",
  24: "313ce17f-7b98-810a-9008-e9ef057e3002",
};

// Lesson number → file path mapping
function getLessonFilePath(lessonNum: number): string {
  const phases: Record<string, [number, number]> = {
    "phase1-fundamentals": [1, 4],
    "phase2-gear": [5, 8],
    "phase3-setup": [9, 12],
    "phase4-mixing": [13, 16],
    "phase5-streaming": [17, 20],
    "phase6-troubleshooting": [21, 24],
  };

  for (const [phase, [start, end]] of Object.entries(phases)) {
    if (lessonNum >= start && lessonNum <= end) {
      const paddedNum = String(lessonNum).padStart(2, "0");
      return `/workspaces/life/aspects/sound/${phase}/lesson-${paddedNum}.md`;
    }
  }
  throw new Error(`Invalid lesson number: ${lessonNum}`);
}

/**
 * Strip unwanted sections from the markdown:
 * 1. Title line (first line starting with # Lesson)
 * 2. 復習メニュー section (from "## 復習メニュー" to the next "---")
 * 3. 次回予告 section (from "## 次回予告" to the end)
 * 4. Phase X のまとめ / 24レッスンの総まとめ / カリキュラム完了 sections after practical drills
 */
function stripContent(markdown: string): string {
  const lines = markdown.split("\n");
  const result: string[] = [];
  let skip = false;
  let skipUntilHr = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // 1. Skip the title line (first # Lesson line)
    if (i === 0 && line.startsWith("# Lesson")) {
      continue;
    }

    // 3. Strip 次回予告 section (from ## 次回予告 to end)
    if (line.match(/^## 次回予告/)) {
      break;
    }

    // 4. Strip Phase summary sections and カリキュラム完了
    if (
      line.match(/^## Phase \d+\s*(の|)まとめ/) ||
      line.match(/^## 24レッスンの総まとめ/) ||
      line.match(/^## カリキュラム完了/)
    ) {
      skip = true;
      continue;
    }

    // 2. Strip 復習メニュー section (from ## 復習メニュー to next ---)
    if (line.match(/^## 復習メニュー/)) {
      skipUntilHr = true;
      continue;
    }

    if (skipUntilHr) {
      if (line.trim() === "---") {
        skipUntilHr = false;
      }
      continue;
    }

    if (skip) {
      // Skip until we hit a new ## heading that isn't also stripped
      if (line.match(/^## /) && !line.match(/^## (次回予告|復習メニュー|Phase|24レッスン|カリキュラム完了)/)) {
        skip = false;
        result.push(line);
      }
      continue;
    }

    result.push(line);
  }

  // Trim trailing blank lines and ---
  let text = result.join("\n").trimEnd();
  // Remove trailing ---
  while (text.endsWith("\n---") || text.endsWith("---")) {
    text = text.replace(/\n?---$/, "").trimEnd();
  }

  return text;
}

// ----- Notion Block Builders -----

interface RichText {
  type: "text";
  text: { content: string; link?: { url: string } | null };
  annotations?: {
    bold?: boolean;
    italic?: boolean;
    strikethrough?: boolean;
    underline?: boolean;
    code?: boolean;
  };
}

function parseInlineFormatting(text: string): RichText[] {
  const result: RichText[] = [];
  // Simple regex to handle **bold**, `code`, and plain text
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);

  for (const part of parts) {
    if (!part) continue;

    if (part.startsWith("**") && part.endsWith("**")) {
      result.push({
        type: "text",
        text: { content: part.slice(2, -2) },
        annotations: { bold: true },
      });
    } else if (part.startsWith("`") && part.endsWith("`")) {
      result.push({
        type: "text",
        text: { content: part.slice(1, -1) },
        annotations: { code: true },
      });
    } else {
      result.push({
        type: "text",
        text: { content: part },
      });
    }
  }

  return result.length > 0 ? result : [{ type: "text", text: { content: text } }];
}

function makeParagraph(text: string): any {
  return {
    object: "block",
    type: "paragraph",
    paragraph: {
      rich_text: parseInlineFormatting(text),
    },
  };
}

function makeHeading2(text: string): any {
  return {
    object: "block",
    type: "heading_2",
    heading_2: {
      rich_text: parseInlineFormatting(text),
    },
  };
}

function makeHeading3(text: string): any {
  return {
    object: "block",
    type: "heading_3",
    heading_3: {
      rich_text: parseInlineFormatting(text),
    },
  };
}

function makeCode(code: string, language: string = "plain text"): any {
  // Notion API has a 2000 char limit per rich_text element
  const truncated = code.length > 2000 ? code.substring(0, 1997) + "..." : code;
  return {
    object: "block",
    type: "code",
    code: {
      rich_text: [{ type: "text", text: { content: truncated } }],
      language: language,
    },
  };
}

function makeBulletedList(text: string): any {
  return {
    object: "block",
    type: "bulleted_list_item",
    bulleted_list_item: {
      rich_text: parseInlineFormatting(text),
    },
  };
}

function makeNumberedList(text: string): any {
  return {
    object: "block",
    type: "numbered_list_item",
    numbered_list_item: {
      rich_text: parseInlineFormatting(text),
    },
  };
}

function makeCallout(text: string): any {
  return {
    object: "block",
    type: "callout",
    callout: {
      rich_text: parseInlineFormatting(text),
      icon: { type: "emoji", emoji: "💡" },
    },
  };
}

function makeDivider(): any {
  return {
    object: "block",
    type: "divider",
    divider: {},
  };
}

function makeTable(rows: string[][]): any {
  if (rows.length === 0) return null;

  const tableWidth = rows[0].length;
  const tableRows = rows.map((row, idx) => ({
    object: "block",
    type: "table_row",
    table_row: {
      cells: row.map((cell) => [{ type: "text", text: { content: cell.trim() } }]),
    },
  }));

  return {
    object: "block",
    type: "table",
    table: {
      table_width: tableWidth,
      has_column_header: true,
      has_row_header: false,
      children: tableRows,
    },
  };
}

/**
 * Convert stripped markdown into Notion block objects.
 */
function markdownToBlocks(markdown: string): any[] {
  const lines = markdown.split("\n");
  const blocks: any[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Skip empty lines
    if (line.trim() === "") {
      i++;
      continue;
    }

    // Horizontal rule
    if (line.trim() === "---") {
      blocks.push(makeDivider());
      i++;
      continue;
    }

    // Code blocks
    if (line.trim().startsWith("```")) {
      const lang = line.trim().slice(3).trim() || "plain text";
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith("```")) {
        codeLines.push(lines[i]);
        i++;
      }
      i++; // skip closing ```
      blocks.push(makeCode(codeLines.join("\n"), lang));
      continue;
    }

    // Heading 2
    if (line.startsWith("## ")) {
      blocks.push(makeHeading2(line.slice(3)));
      i++;
      continue;
    }

    // Heading 3
    if (line.startsWith("### ")) {
      blocks.push(makeHeading3(line.slice(4)));
      i++;
      continue;
    }

    // Table detection
    if (line.includes("|") && line.trim().startsWith("|")) {
      const tableLines: string[] = [];
      while (i < lines.length && lines[i].includes("|") && lines[i].trim().startsWith("|")) {
        tableLines.push(lines[i]);
        i++;
      }
      // Parse table
      const rows: string[][] = [];
      for (let t = 0; t < tableLines.length; t++) {
        const cells = tableLines[t]
          .split("|")
          .slice(1, -1) // remove leading/trailing empty strings from split
          .map((c) => c.trim());
        // Skip separator row (e.g., |------|------|)
        if (cells.every((c) => /^[-:]+$/.test(c))) continue;
        rows.push(cells);
      }
      if (rows.length > 0) {
        const table = makeTable(rows);
        if (table) blocks.push(table);
      }
      continue;
    }

    // Blockquote / Callout - collect consecutive > lines
    if (line.startsWith("> ")) {
      const quoteLines: string[] = [];
      while (i < lines.length && lines[i].startsWith("> ")) {
        quoteLines.push(lines[i].slice(2));
        i++;
      }
      blocks.push(makeCallout(quoteLines.join("\n")));
      continue;
    }

    // Bulleted list
    if (line.match(/^- /)) {
      blocks.push(makeBulletedList(line.slice(2)));
      i++;
      continue;
    }

    // Numbered list
    if (line.match(/^\d+\.\s/)) {
      const text = line.replace(/^\d+\.\s/, "");
      blocks.push(makeNumberedList(text));
      i++;
      continue;
    }

    // Regular paragraph
    // Collect consecutive non-special lines as one paragraph
    const paraLines: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      lines[i].trim() !== "---" &&
      !lines[i].startsWith("## ") &&
      !lines[i].startsWith("### ") &&
      !lines[i].startsWith("```") &&
      !lines[i].startsWith("> ") &&
      !lines[i].startsWith("- ") &&
      !lines[i].match(/^\d+\.\s/) &&
      !(lines[i].includes("|") && lines[i].trim().startsWith("|"))
    ) {
      paraLines.push(lines[i]);
      i++;
    }
    if (paraLines.length > 0) {
      const paraText = paraLines.join("\n");
      // Notion paragraph rich_text has 2000 char limit per element
      if (paraText.length > 2000) {
        // Split into chunks
        const chunks = paraText.match(/.{1,2000}/gs) || [paraText];
        for (const chunk of chunks) {
          blocks.push(makeParagraph(chunk));
        }
      } else {
        blocks.push(makeParagraph(paraText));
      }
    }
  }

  return blocks;
}

/**
 * Delete all existing blocks from a Notion page.
 * Uses concurrent deletion (batches of 10) for speed.
 */
async function clearPageContent(pageId: string): Promise<void> {
  // Get all existing blocks (paginated)
  const allBlockIds: string[] = [];
  let hasMore = true;
  let startCursor: string | undefined;

  while (hasMore) {
    const url = new URL(`${API_BASE}/blocks/${pageId}/children`);
    url.searchParams.set("page_size", "100");
    if (startCursor) url.searchParams.set("start_cursor", startCursor);

    const response = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${NOTION_API_KEY}`,
        "Notion-Version": NOTION_VERSION,
      },
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`Failed to get blocks for ${pageId}: ${response.status}\n${errorBody}`);
    }

    const data = await response.json();
    for (const b of data.results) {
      allBlockIds.push(b.id);
    }

    hasMore = data.has_more;
    startCursor = data.next_cursor;
  }

  if (allBlockIds.length === 0) return;

  console.log(`  Found ${allBlockIds.length} blocks to delete...`);

  // Delete in concurrent batches of 10
  const concurrency = 10;
  for (let i = 0; i < allBlockIds.length; i += concurrency) {
    const batch = allBlockIds.slice(i, i + concurrency);
    await Promise.all(
      batch.map(async (blockId) => {
        const delResponse = await fetch(`${API_BASE}/blocks/${blockId}`, {
          method: "DELETE",
          headers: {
            Authorization: `Bearer ${NOTION_API_KEY}`,
            "Notion-Version": NOTION_VERSION,
          },
        });
        if (!delResponse.ok && delResponse.status !== 404) {
          console.warn(`  Warning: Failed to delete block ${blockId}: ${delResponse.status}`);
        }
      })
    );
    // Small delay between batches to avoid rate limiting
    if (i + concurrency < allBlockIds.length) {
      await new Promise((r) => setTimeout(r, 200));
    }
  }
}

/**
 * Append blocks to a Notion page using the Notion API.
 * The API has a 100-block limit per request, so we batch.
 */
async function appendBlocksToPage(pageId: string, blocks: any[]): Promise<void> {
  const batchSize = 100;
  for (let i = 0; i < blocks.length; i += batchSize) {
    const batch = blocks.slice(i, i + batchSize);
    const response = await fetch(`${API_BASE}/blocks/${pageId}/children`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${NOTION_API_KEY}`,
        "Notion-Version": NOTION_VERSION,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ children: batch }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(
        `Notion API error for page ${pageId} (batch ${Math.floor(i / batchSize) + 1}): ${response.status} ${response.statusText}\n${errorBody}`
      );
    }

    if (i + batchSize < blocks.length) {
      // Small delay between batches
      await new Promise((r) => setTimeout(r, 500));
    }
  }
}

// ----- Main -----

async function processLesson(lessonNum: number): Promise<void> {
  const filePath = getLessonFilePath(lessonNum);
  const pageId = LESSON_PAGE_IDS[lessonNum];

  console.log(`\n📖 Lesson ${lessonNum}: Reading ${filePath}`);

  const file = Bun.file(filePath);
  const markdown = await file.text();

  console.log(`  Stripping sections...`);
  const stripped = stripContent(markdown);

  console.log(`  Converting to Notion blocks...`);
  const blocks = markdownToBlocks(stripped);
  console.log(`  Generated ${blocks.length} blocks`);

  console.log(`  Clearing existing content on page ${pageId}...`);
  await clearPageContent(pageId);

  console.log(`  Uploading to Notion page ${pageId}...`);
  await appendBlocksToPage(pageId, blocks);
  console.log(`  Done!`);
}

async function main() {
  console.log("=== Sound Lesson Notion Updater ===");
  console.log(`Processing ${Object.keys(LESSON_PAGE_IDS).length} lessons\n`);

  const lessonNums = Object.keys(LESSON_PAGE_IDS)
    .map(Number)
    .sort((a, b) => a - b);

  for (const lessonNum of lessonNums) {
    try {
      await processLesson(lessonNum);
      // Small delay between lessons to avoid rate limiting
      await new Promise((r) => setTimeout(r, 1000));
    } catch (error) {
      console.error(`\n❌ Error processing Lesson ${lessonNum}:`, error);
      // Continue with next lesson
    }
  }

  console.log("\n=== Complete! ===");
}

main();
