#!/usr/bin/env bun
/**
 * ジム Notion ページのテーブルを目標スキーマに収束させる。
 *
 * 目標スキーマ:
 *   筋トレ: [FB, 種目, 重量（kg）, セット, 回数]
 *   有酸素: [FB, 種目, 時間, 傾斜, スピード]
 *
 * 動作:
 *   - 既存テーブルの行データを読み取り
 *   - 目標スキーマに並べ替え（# 列削除、傾斜/スピード は空で新設）
 *   - 新テーブルを旧テーブルの直後に追加
 *   - 旧テーブルを削除
 *
 * 使い方:
 *   bun run scripts/gym/migrate-fb-column.ts --dry-run
 *   bun run scripts/gym/migrate-fb-column.ts
 *   bun run scripts/gym/migrate-fb-column.ts --page <id>
 */

import { getApiKey, notionFetch, getGymDbId, parseArgs } from "../lib/notion";

type TableRowBlock = {
  id: string;
  type: "table_row";
  table_row: { cells: any[][] };
};

const STRENGTH_TARGET = ["FB", "種目", "重量（kg）", "セット", "回数"] as const;
const CARDIO_TARGET = ["FB", "種目", "時間", "傾斜", "スピード"] as const;

const HEADER_ALIASES: Array<{ key: string; re: RegExp }> = [
  { key: "FB", re: /^(FB|フィードバック)$/ },
  { key: "#", re: /^#$/ },
  { key: "種目", re: /^種目$/ },
  { key: "重量（kg）", re: /^重量/ },
  { key: "セット", re: /^セット$/ },
  { key: "回数", re: /^回数$/ },
  { key: "時間", re: /^時間$/ },
  { key: "傾斜", re: /^(傾斜|incline)$/i },
  { key: "スピード", re: /^(スピード|速度|speed)$/i },
];

function cellText(cell: any[]): string {
  return cell.map((t: any) => t.plain_text ?? "").join("").trim();
}

function normalizeHeader(text: string): string | null {
  const t = text.trim();
  for (const { key, re } of HEADER_ALIASES) {
    if (re.test(t)) return key;
  }
  return null;
}

function textCell(text: string): any[] {
  if (!text) return [];
  return [{
    type: "text",
    text: { content: text, link: null },
    annotations: { bold: false, italic: false, strikethrough: false, underline: false, code: false, color: "default" },
    plain_text: text,
    href: null,
  }];
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

async function deleteBlock(apiKey: string, blockId: string): Promise<void> {
  await notionFetch(apiKey, `/blocks/${blockId}`, undefined, "DELETE");
}

async function appendTableAfter(
  apiKey: string,
  parentId: string,
  afterBlockId: string,
  tableBlock: unknown,
): Promise<void> {
  await notionFetch(apiKey, `/blocks/${parentId}/children`, {
    children: [tableBlock],
    after: afterBlockId,
  }, "PATCH");
}

type Section = "strength" | "cardio" | "unknown";

function detectSection(normalizedHeader: (string | null)[]): Section {
  if (normalizedHeader.includes("重量（kg）")) return "strength";
  if (normalizedHeader.includes("時間")) return "cardio";
  return "unknown";
}

function targetFor(section: Section): readonly string[] | null {
  if (section === "strength") return STRENGTH_TARGET;
  if (section === "cardio") return CARDIO_TARGET;
  return null;
}

function isAlreadyTarget(currentKeys: (string | null)[], target: readonly string[]): boolean {
  if (currentKeys.length !== target.length) return false;
  for (let i = 0; i < target.length; i++) {
    if (currentKeys[i] !== target[i]) return false;
  }
  return true;
}

/** 旧 row cells → 目標列順の row cells（rich_text 配列保持） */
function transformRowCells(
  oldCells: any[][],
  currentKeys: (string | null)[],
  target: readonly string[],
  isHeader: boolean,
): any[][] {
  return target.map((k) => {
    const src = currentKeys.indexOf(k);
    if (src >= 0) return oldCells[src] ?? [];
    return isHeader ? textCell(k) : [];
  });
}

async function migratePage(apiKey: string, pageId: string, dryRun: boolean): Promise<{ tables: number; rows: number; skipped: number }> {
  const topBlocks = await listChildren(apiKey, pageId);
  let tables = 0, rows = 0, skipped = 0;

  for (const b of topBlocks) {
    if (b.type !== "table") continue;

    const rowBlocks = (await listChildren(apiKey, b.id)) as TableRowBlock[];
    if (rowBlocks.length === 0) continue;

    const headerRaw = rowBlocks[0].table_row.cells.map(cellText);
    const headerKeys = headerRaw.map(normalizeHeader);
    const section = detectSection(headerKeys);

    const target = targetFor(section);
    if (!target) {
      console.log(`  ⏭  table ${b.id.slice(0, 8)}… unknown [${headerRaw.join(" | ")}]`);
      skipped++;
      continue;
    }

    if (isAlreadyTarget(headerKeys, target)) {
      console.log(`  ✅ table ${b.id.slice(0, 8)}… already target (${section})`);
      skipped++;
      continue;
    }

    console.log(`  🔄 ${section} table ${b.id.slice(0, 8)}…  [${headerRaw.join(" | ")}] → [${target.join(" | ")}]  rows=${rowBlocks.length}`);
    tables++;

    const newRows = rowBlocks.map((row, idx) => ({
      object: "block" as const,
      type: "table_row" as const,
      table_row: {
        cells: transformRowCells(row.table_row.cells, headerKeys, target, idx === 0),
      },
    }));

    for (let i = 0; i < newRows.length; i++) {
      const before = rowBlocks[i].table_row.cells.map(cellText).join(" | ");
      const after = newRows[i].table_row.cells.map(cellText).join(" | ");
      console.log(`      ${dryRun ? "[DRY]" : "→   "} ${before}   ==>   ${after}`);
      rows++;
    }

    if (dryRun) continue;

    const newTableBlock = {
      object: "block",
      type: "table",
      table: {
        table_width: target.length,
        has_column_header: true,
        has_row_header: false,
        children: newRows,
      },
    };

    // 新テーブルを旧テーブルの直後に挿入
    await appendTableAfter(apiKey, pageId, b.id, newTableBlock);
    await new Promise(r => setTimeout(r, 150));

    // 旧テーブルを削除
    await deleteBlock(apiKey, b.id);
    await new Promise(r => setTimeout(r, 150));
  }

  return { tables, rows, skipped };
}

async function main() {
  const { flags, opts } = parseArgs();
  const dryRun = flags.has("dry-run");
  const singlePage = opts["page"];

  const apiKey = getApiKey();

  let pageIds: Array<{ id: string; date: string }>;

  if (singlePage) {
    pageIds = [{ id: singlePage, date: "(single)" }];
  } else {
    const dbId = getGymDbId();
    const res = await notionFetch(apiKey, `/databases/${dbId}/query`, { page_size: 100 });
    pageIds = (res.results || []).map((p: any) => ({
      id: p.id,
      date: p.properties?.["日付"]?.date?.start?.slice(0, 10) || "",
    }));
    pageIds.sort((a, b) => a.date.localeCompare(b.date));
  }

  console.log(`${dryRun ? "[DRY RUN] " : ""}Migrating ${pageIds.length} gym page(s) → target schema`);
  console.log(`  strength: [${STRENGTH_TARGET.join(", ")}]`);
  console.log(`  cardio:   [${CARDIO_TARGET.join(", ")}]`);
  console.log("");

  let totalTables = 0, totalRows = 0, totalSkipped = 0, failedPages = 0;

  for (const { id, date } of pageIds) {
    console.log(`📄 ${date}  ${id}`);
    try {
      const r = await migratePage(apiKey, id, dryRun);
      totalTables += r.tables;
      totalRows += r.rows;
      totalSkipped += r.skipped;
    } catch (e: any) {
      console.error(`  ❌ ${e.message}`);
      failedPages++;
    }
    console.log("");
  }

  console.log("─".repeat(60));
  console.log(`${dryRun ? "[DRY RUN] " : ""}Summary:`);
  console.log(`  pages:          ${pageIds.length}  (failed: ${failedPages})`);
  console.log(`  tables rebuilt: ${totalTables}`);
  console.log(`  rows:           ${totalRows}`);
  console.log(`  tables skipped: ${totalSkipped}`);
}

main();
