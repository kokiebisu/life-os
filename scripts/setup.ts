#!/usr/bin/env bun
/**
 * Life OS setup wizard.
 * Usage: bun run setup
 */

import { writeFileSync, existsSync } from "fs";
import { join } from "path";
import { createInterface } from "readline";
import { loadAspectManifests, generateEnvLocal, generateLifeConfig } from "./lib/setup-helpers";
import type { AspectManifest } from "./lib/setup-helpers";

const ROOT = join(import.meta.dir, "..");
const NOTION_API = "https://api.notion.com/v1";
const NOTION_VERSION = "2022-06-28";

function prompt(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function notionRequest(
  method: string,
  path: string,
  apiKey: string,
  body?: unknown
): Promise<unknown> {
  const res = await fetch(`${NOTION_API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Notion-Version": NOTION_VERSION,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Notion API error (${res.status}): ${err}`);
  }
  return res.json();
}

async function validateToken(apiKey: string): Promise<boolean> {
  try {
    await notionRequest("GET", "/users/me", apiKey);
    return true;
  } catch {
    return false;
  }
}

async function createNotionPage(apiKey: string, title: string): Promise<string> {
  const res = await notionRequest("POST", "/pages", apiKey, {
    parent: { type: "workspace", workspace: true },
    properties: {
      title: { title: [{ type: "text", text: { content: title } }] },
    },
  }) as { id: string };
  return res.id;
}

async function createNotionDatabase(
  apiKey: string,
  parentPageId: string,
  displayName: string,
  schema: Record<string, string>
): Promise<string> {
  const properties: Record<string, unknown> = {};
  for (const [colName, colType] of Object.entries(schema)) {
    if (colType === "title") {
      properties[colName] = { title: {} };
    } else if (colType === "date") {
      properties[colName] = { date: {} };
    }
  }
  const res = await notionRequest("POST", "/databases", apiKey, {
    parent: { type: "page_id", page_id: parentPageId },
    title: [{ type: "text", text: { content: displayName } }],
    properties,
  }) as { id: string };
  return res.id;
}

async function main() {
  console.log("\n🚀 Life OS セットアップ\n");

  if (existsSync(join(ROOT, ".env.local"))) {
    const overwrite = await prompt("⚠️  .env.local がすでに存在します。上書きしますか？ [y/N]: ");
    if (overwrite.toLowerCase() !== "y") {
      console.log("セットアップを中止しました。");
      process.exit(0);
    }
  }

  const apiKey = await prompt("? Notion API トークンを入力してください (secret_...): ");
  if (!apiKey.startsWith("secret_")) {
    console.error("❌ トークンは secret_ で始まる必要があります。");
    process.exit(1);
  }
  process.stdout.write("  トークンを確認中...");
  const valid = await validateToken(apiKey);
  if (!valid) {
    console.error("\n❌ トークンが無効です。Notion の Integration ページで確認してください。");
    process.exit(1);
  }
  console.log(" ✅");

  console.log('\n? DB の親ページを指定してください');
  const parentInput = await prompt('  (Notion ページ URL を貼るか、Enter で "Life OS" ページを自動作成): ');
  let parentPageId: string;
  if (!parentInput) {
    process.stdout.write('  "Life OS" ページを作成中...');
    parentPageId = await createNotionPage(apiKey, "Life OS");
    console.log(` ✅ (id: ${parentPageId})`);
  } else {
    const match = parentInput.match(/([a-f0-9]{32}|[a-f0-9-]{36})(?:\?|$)/);
    if (!match) {
      console.error("❌ ページ URL からIDを抽出できませんでした。");
      process.exit(1);
    }
    parentPageId = match[1];
    console.log(`  ✅ 親ページID: ${parentPageId}`);
  }

  const allManifests = await loadAspectManifests(ROOT);
  console.log("\n? 使用する aspects を選択してください:");
  const selected: AspectManifest[] = [];
  for (const manifest of allManifests) {
    const answer = await prompt(`  ${manifest.name.padEnd(10)} — ${manifest.description} [Y/n]: `);
    if (answer.toLowerCase() !== "n") {
      selected.push(manifest);
      console.log(`  ✅ ${manifest.name}`);
    } else {
      console.log(`  ❌ ${manifest.name}`);
    }
  }

  const userName = await prompt("\n? あなたの名前: ");
  const tzAnswer = await prompt("? タイムゾーン [Asia/Tokyo]: ");
  const timezone = tzAnswer || "Asia/Tokyo";
  const langAnswer = await prompt("? 言語設定 [ja]: ");
  const language = langAnswer || "ja";

  console.log("\n📦 Notion DB を作成中...");
  const dbMap: Record<string, string> = {};
  const postSetupNotes: string[] = [];

  for (const manifest of selected) {
    for (const db of manifest.notion.databases) {
      process.stdout.write(`  ${db.displayName} DB...`);
      try {
        const dbId = await createNotionDatabase(apiKey, parentPageId, db.displayName, db.schema);
        dbMap[db.envKey] = dbId;
        console.log(` ✅ (id: ${dbId})`);
      } catch (e) {
        console.error(` ❌ 失敗: ${(e as Error).message}`);
        process.exit(1);
      }
    }
    postSetupNotes.push(...(manifest.postSetupNotes ?? []));
  }

  const envContent = generateEnvLocal(apiKey, dbMap);
  writeFileSync(join(ROOT, ".env.local"), envContent, "utf-8");
  console.log("\n✅ .env.local を生成しました");

  const configContent = generateLifeConfig(
    selected.map((m) => m.name),
    { name: userName, timezone, language }
  );
  writeFileSync(join(ROOT, "life.config.json"), configContent, "utf-8");
  console.log("✅ life.config.json を生成しました");

  if (postSetupNotes.length > 0) {
    console.log("\n📋 手動セットアップが必要な項目:");
    for (const note of postSetupNotes) {
      console.log(`  • ${note}`);
    }
  }

  console.log("\n🎉 セットアップ完了！");
  console.log("   次のステップ: ./dev でdevcontainerを起動してください\n");
}

main().catch((e) => {
  console.error("❌ 予期せぬエラー:", e.message);
  process.exit(1);
});
