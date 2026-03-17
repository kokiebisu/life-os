#!/usr/bin/env bun
/**
 * Notion アイコン・カバー画像の一括設定（全DB対応）
 *
 * 既存のページにアイコンとカバー画像を追加する。
 * すでに設定済みのページはスキップ。
 *
 * 使い方:
 *   bun run scripts/notion-backfill-icons.ts              # 全DB対象
 *   bun run scripts/notion-backfill-icons.ts --dry-run    # プレビューのみ
 *   bun run scripts/notion-backfill-icons.ts --db tasks   # タスクDBのみ
 *   bun run scripts/notion-backfill-icons.ts --db events  # イベントDBのみ
 *   bun run scripts/notion-backfill-icons.ts --db guitar  # ギターDBのみ
 *   bun run scripts/notion-backfill-icons.ts --db meals   # 食事DBのみ
 *   bun run scripts/notion-backfill-icons.ts --force      # 設定済みも上書き
 */

import {
  getApiKey, getDbId, getDbIdOptional, getScheduleDbConfigOptional,
  notionFetch, parseArgs,
  pickTaskIcon, pickArticleIcon, pickCover,
} from "./lib/notion";

const apiKey = getApiKey();

async function queryAll(dbId: string): Promise<any[]> {
  const results: any[] = [];
  let cursor: string | undefined;
  do {
    const body: Record<string, unknown> = {};
    if (cursor) body.start_cursor = cursor;
    const data = await notionFetch(apiKey, `/databases/${dbId}/query`, body);
    results.push(...data.results);
    cursor = data.has_more ? data.next_cursor : undefined;
  } while (cursor);
  return results;
}

async function updatePage(pageId: string, icon: unknown, cover: unknown) {
  const res = await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
    method: "PATCH",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Notion-Version": "2022-06-28",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ icon, cover }),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(`PATCH ${pageId}: ${(err as any).message}`);
  }
}

async function backfillTasks(dryRun: boolean, force: boolean) {
  const dbId = getDbId("NOTION_DEVOTION_DB");
  const pages = await queryAll(dbId);
  console.log(`\n📌 Tasks (習慣): ${pages.length} pages`);

  let updated = 0;
  for (const page of pages) {
    if (!force && page.icon && page.cover) continue;
    const title = page.properties.Name?.title?.[0]?.plain_text || "";
    const icon = pickTaskIcon(title);
    const cover = pickCover();

    updated++;
    if (dryRun) {
      console.log(`  [DRY] ${icon.emoji} ${title}`);
    } else {
      await updatePage(page.id, icon, cover);
      console.log(`  ${icon.emoji} ${title}`);
    }
  }
  console.log(`  → ${dryRun ? "would update" : "updated"} ${updated}/${pages.length}`);
}

async function backfillEvents(dryRun: boolean, force: boolean) {
  const dbConf = getScheduleDbConfigOptional("events");
  if (!dbConf) { console.log("\n📅 Events (イベント): スキップ（DB未設定）"); return; }
  const pages = await queryAll(dbConf.dbId);
  console.log(`\n📅 Events (イベント): ${pages.length} pages`);

  let updated = 0;
  for (const page of pages) {
    if (!force && page.icon && page.cover) continue;
    const title = (page.properties[dbConf.config.titleProp]?.title || [])
      .map((t: any) => t.plain_text || "").join("");
    const icon = pickTaskIcon(title);
    const cover = pickCover();

    updated++;
    if (dryRun) {
      console.log(`  [DRY] ${icon.emoji} ${title}`);
    } else {
      await updatePage(page.id, icon, cover);
      console.log(`  ${icon.emoji} ${title}`);
    }
  }
  console.log(`  → ${dryRun ? "would update" : "updated"} ${updated}/${pages.length}`);
}

async function backfillGuitar(dryRun: boolean, force: boolean) {
  const dbConf = getScheduleDbConfigOptional("guitar");
  if (!dbConf) { console.log("\n🎸 Guitar (ギター): スキップ（DB未設定）"); return; }
  const pages = await queryAll(dbConf.dbId);
  console.log(`\n🎸 Guitar (ギター): ${pages.length} pages`);

  let updated = 0;
  for (const page of pages) {
    if (!force && page.icon && page.cover) continue;
    const title = (page.properties[dbConf.config.titleProp]?.title || [])
      .map((t: any) => t.plain_text || "").join("");
    const icon = pickTaskIcon(title);
    const cover = pickCover();

    updated++;
    if (dryRun) {
      console.log(`  [DRY] ${icon.emoji} ${title}`);
    } else {
      await updatePage(page.id, icon, cover);
      console.log(`  ${icon.emoji} ${title}`);
    }
  }
  console.log(`  → ${dryRun ? "would update" : "updated"} ${updated}/${pages.length}`);
}

async function backfillSound(dryRun: boolean, force: boolean) {
  const dbConf = getScheduleDbConfigOptional("sound");
  if (!dbConf) { console.log("\n🎛️ Sound (音響): スキップ（DB未設定）"); return; }
  const pages = await queryAll(dbConf.dbId);
  // Filter to sound curriculum pages only
  const soundPages = pages.filter((p: any) => p.properties?.["カリキュラム"]?.select?.name === "音響");
  console.log(`\n🎛️ Sound (音響): ${soundPages.length} pages`);

  let updated = 0;
  for (const page of soundPages) {
    if (!force && page.icon && page.cover) continue;
    const title = (page.properties[dbConf.config.titleProp]?.title || [])
      .map((t: any) => t.plain_text || "").join("");
    const icon = pickTaskIcon(title, "🎛️");
    const cover = pickCover();

    updated++;
    if (dryRun) {
      console.log(`  [DRY] ${icon.emoji} ${title}`);
    } else {
      await updatePage(page.id, icon, cover);
      console.log(`  ${icon.emoji} ${title}`);
    }
  }
  console.log(`  → ${dryRun ? "would update" : "updated"} ${updated}/${soundPages.length}`);
}

async function backfillMeals(dryRun: boolean, force: boolean) {
  const dbConf = getScheduleDbConfigOptional("meals");
  if (!dbConf) { console.log("\n🍽️ Meals (食事): スキップ（DB未設定）"); return; }
  const pages = await queryAll(dbConf.dbId);
  console.log(`\n🍽️ Meals (食事): ${pages.length} pages`);

  let updated = 0;
  for (const page of pages) {
    if (!force && page.icon && page.cover) continue;
    const title = (page.properties[dbConf.config.titleProp]?.title || [])
      .map((t: any) => t.plain_text || "").join("");
    const icon = pickTaskIcon(title, "🍽️");
    const cover = pickCover();

    updated++;
    if (dryRun) {
      console.log(`  [DRY] ${icon.emoji} ${title}`);
    } else {
      await updatePage(page.id, icon, cover);
      console.log(`  ${icon.emoji} ${title}`);
    }
  }
  console.log(`  → ${dryRun ? "would update" : "updated"} ${updated}/${pages.length}`);
}

async function backfillTodo(dryRun: boolean, force: boolean) {
  const dbConf = getScheduleDbConfigOptional("todo");
  if (!dbConf) { console.log("\n✅ Todo (やること): スキップ（DB未設定）"); return; }
  const pages = await queryAll(dbConf.dbId);
  console.log(`\n✅ Todo (やること): ${pages.length} pages`);

  let updated = 0;
  for (const page of pages) {
    if (!force && page.icon && page.cover) continue;
    const title = (page.properties[dbConf.config.titleProp]?.title || [])
      .map((t: any) => t.plain_text || "").join("");
    const icon = pickTaskIcon(title);
    const cover = pickCover();

    updated++;
    if (dryRun) {
      console.log(`  [DRY] ${icon.emoji} ${title}`);
    } else {
      await updatePage(page.id, icon, cover);
      console.log(`  ${icon.emoji} ${title}`);
    }
  }
  console.log(`  → ${dryRun ? "would update" : "updated"} ${updated}/${pages.length}`);
}

async function backfillArticles(dryRun: boolean, force: boolean) {
  const dbId = getDbIdOptional("NOTION_ARTICLES_DB");
  if (!dbId) { console.log("\n📰 Articles: スキップ（DB未設定）"); return; }
  const pages = await queryAll(dbId);
  console.log(`\n📰 Articles: ${pages.length} pages`);

  let updated = 0;
  for (const page of pages) {
    if (!force && page.icon && page.cover) continue;
    const title = page.properties["タイトル"]?.title?.[0]?.plain_text || "";
    const source = page.properties["ソース"]?.select?.name || "";
    const aspects = (page.properties.Aspect?.multi_select || []).map((s: any) => s.name).join(",");
    const icon = pickArticleIcon(source);
    const cover = pickCover();

    updated++;
    if (dryRun) {
      console.log(`  [DRY] ${icon.emoji} ${title.slice(0, 50)}`);
    } else {
      await updatePage(page.id, icon, cover);
      console.log(`  ${icon.emoji} ${title.slice(0, 50)}`);
    }
  }
  console.log(`  → ${dryRun ? "would update" : "updated"} ${updated}/${pages.length}`);
}

async function main() {
  const { flags, opts } = parseArgs();
  const dryRun = flags.has("dry-run");
  const force = flags.has("force");
  const db = opts.db;

  if (dryRun) console.log("🔍 Dry run mode - no changes will be made\n");
  if (force) console.log("⚡ Force mode - overwriting existing icons/covers\n");

  const targets = db ? [db] : ["tasks", "events", "guitar", "sound", "meals", "todo", "articles"];

  for (const target of targets) {
    switch (target) {
      case "tasks": await backfillTasks(dryRun, force); break;
      case "events": await backfillEvents(dryRun, force); break;
      case "guitar": await backfillGuitar(dryRun, force); break;
      case "sound": await backfillSound(dryRun, force); break;
      case "meals": await backfillMeals(dryRun, force); break;
      case "todo": await backfillTodo(dryRun, force); break;
      case "articles": await backfillArticles(dryRun, force); break;
      default: console.error(`Unknown db: ${target}`); process.exit(1);
    }
  }

  console.log("\n✅ Done!");
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
