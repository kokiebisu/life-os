#!/usr/bin/env bun
/**
 * Notion meals DB の過去エントリから作り置きの消費を検出し、fridge.md を更新する
 *
 * 使い方:
 *   bun run scripts/notion/notion-fridge-consume.ts              # 昨日分を処理
 *   bun run scripts/notion/notion-fridge-consume.ts --from 2026-04-13 --to 2026-04-14
 *   bun run scripts/notion/notion-fridge-consume.ts --dry-run    # 確認のみ（書き込まない）
 *
 * 検出ロジック:
 *   Notion meals タイトルに fridge.md の作り置き名が含まれる場合に消費とみなす。
 *   例: fridge.md「豚こまのしぐれ煮風」 ↔ Notion「豚こまのしぐれ煮風 + 玄米」→ 検出
 *   作り置きが1種類のみの場合に限り、名前不一致でも手動で --count N を指定して強制減算できる。
 *
 * オプション:
 *   --from YYYY-MM-DD  開始日（デフォルト: 昨日）
 *   --to   YYYY-MM-DD  終了日（デフォルト: 昨日）
 *   --dry-run          書き込まずに検出結果を表示
 *   --count N          検出をスキップして N 食分を強制減算（作り置きが1種類のみの場合）
 */

import { join } from "path";
import { readFileSync, writeFileSync } from "fs";
import {
  getScheduleDbConfig,
  queryDbByDateCached,
  normalizePages,
  parseArgs,
  todayJST,
} from "./lib/notion";

const FRIDGE_PATH = join(import.meta.dir, "../../aspects/diet/fridge.md");

interface StorageItem {
  name: string;
  quantity: number;
  unit: string;
  notes: string;
  lineIdx: number;
}

function parseFridgeStorage(content: string): { items: StorageItem[]; lines: string[] } {
  const lines = content.split("\n");
  const items: StorageItem[] = [];
  let inStorage = false;
  let inTable = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === "## 作り置き") { inStorage = true; inTable = false; continue; }
    if (inStorage && line.startsWith("## ")) { inStorage = false; continue; }
    if (!inStorage) continue;
    if (line.match(/^\|\s*食材/)) { inTable = true; continue; }
    if (line.match(/^\|\s*[-–|]+/)) continue;
    if (!inTable || !line.startsWith("|")) continue;

    const cols = line.split("|").map(c => c.trim()).filter((_, i, a) => i > 0 && i < a.length - 1);
    if (cols.length < 2) continue;

    const name = cols[0];
    const quantityStr = cols[1];
    const notes = cols[2] || "";

    const qMatch = quantityStr.match(/^(\d+)\s*(.*)$/);
    if (!qMatch) continue;

    items.push({ name, quantity: parseInt(qMatch[1], 10), unit: qMatch[2].trim(), notes, lineIdx: i });
  }

  return { items, lines };
}

function updateFridgeLines(lines: string[], item: StorageItem, newQty: number | "delete", today: string): string {
  const result = [...lines];

  if (newQty === "delete") {
    result.splice(item.lineIdx, 1);
  } else {
    const cols = result[item.lineIdx].split("|");
    if (cols.length >= 4) {
      cols[2] = cols[2].replace(/\d+/, String(newQty));
      result[item.lineIdx] = cols.join("|");
    }
  }

  return result.join("\n").replace(
    /^> 最終更新: \d{4}-\d{2}-\d{2}/m,
    `> 最終更新: ${today}`,
  );
}

async function main() {
  const { flags, opts } = parseArgs();
  const dryRun = flags.has("dry-run");
  const forceCount = opts.count ? parseInt(opts.count, 10) : null;
  const today = todayJST();

  const yesterday = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Tokyo" }));
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = yesterday.toLocaleDateString("sv-SE");

  const fromDate = opts.from || yesterdayStr;
  const toDate = opts.to || yesterdayStr;

  console.log(`[fridge-consume] ${fromDate} 〜 ${toDate}${dryRun ? " (dry-run)" : ""}`);

  // fridge.md の作り置きを読み込む
  const fridgeContent = readFileSync(FRIDGE_PATH, "utf-8");
  const { items: storageItems, lines } = parseFridgeStorage(fridgeContent);

  if (storageItems.length === 0) {
    console.log("作り置きエントリなし。スキップ。");
    return;
  }

  console.log(`在庫: ${storageItems.map(i => `${i.name} ${i.quantity}${i.unit}`).join(", ")}`);

  // --count で強制指定された場合
  if (forceCount !== null) {
    if (storageItems.length !== 1) {
      console.error(`❌ --count は作り置きが1種類のときのみ使用できます（現在: ${storageItems.map(i => i.name).join(", ")}）`);
      process.exit(1);
    }
    const item = storageItems[0];
    const newQty = item.quantity - forceCount;
    const action = newQty <= 0 ? "delete" : newQty;
    console.log(`  ${item.name}: ${item.quantity}${item.unit} - ${forceCount}食 → ${action === "delete" ? "0（削除）" : `${newQty}${item.unit}`}`);
    if (!dryRun) {
      writeFileSync(FRIDGE_PATH, updateFridgeLines(lines, item, action, today), "utf-8");
      console.log("✅ fridge.md 更新完了");
      console.log("次のステップ: /fridge-sync で Notion に反映してください");
    } else {
      console.log("[dry-run] fridge.md は更新されません");
    }
    return;
  }

  // Notion meals DB を日付でクエリ
  const { apiKey, dbId, config } = getScheduleDbConfig("meals");
  const data = await queryDbByDateCached(apiKey, dbId, config, fromDate, toDate);
  const entries = normalizePages(data.results || [], config, "meals");

  // タイトルに作り置き名が含まれるエントリを検出
  const consumptionByItem = new Map<string, number>();
  for (const entry of entries) {
    for (const item of storageItems) {
      if (entry.title.includes(item.name)) {
        consumptionByItem.set(item.name, (consumptionByItem.get(item.name) || 0) + 1);
        console.log(`  検出: "${entry.title}" → ${item.name} 1食消費`);
        break;
      }
    }
  }

  if (consumptionByItem.size === 0) {
    console.log("作り置き消費なし。");
    console.log("タイトルに作り置き名が含まれない場合は --count N で手動指定できます。");
    return;
  }

  // fridge.md を更新
  let currentContent = fridgeContent;
  let currentLines = lines;
  let currentItems = storageItems;

  for (const [name, count] of consumptionByItem) {
    const item = currentItems.find(i => i.name === name);
    if (!item) continue;

    const newQty = item.quantity - count;
    const action = newQty <= 0 ? "delete" : newQty;
    console.log(`  ${item.name}: ${item.quantity}${item.unit} - ${count}食 → ${action === "delete" ? "0（削除）" : `${newQty}${item.unit}`}`);

    if (!dryRun) {
      currentContent = updateFridgeLines(currentLines, item, action, today);
      const reparsed = parseFridgeStorage(currentContent);
      currentLines = reparsed.lines;
      currentItems = reparsed.items;
    }
  }

  if (dryRun) {
    console.log("[dry-run] fridge.md は更新されません");
    return;
  }

  writeFileSync(FRIDGE_PATH, currentContent, "utf-8");
  console.log("✅ fridge.md 更新完了");
  console.log("次のステップ: /fridge-sync で Notion に反映してください");
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
