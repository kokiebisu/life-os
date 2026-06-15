#!/usr/bin/env bun
/**
 * Notion タスク・イベント追加（4 DB対応）
 *
 * 使い方:
 *   bun run scripts/notion-add.ts --title "ギター練習" --date 2026-02-14 --start 17:30 --end 18:30
 *   bun run scripts/notion-add.ts --title "買い出し" --date 2026-02-14 --start 10:00 --end 11:00
 *   bun run scripts/notion-add.ts --title "イベント" --date 2026-02-14 --start 14:00 --end 16:00 --db events
 *   bun run scripts/notion-add.ts --title "ギター練習" --date 2026-02-14 --start 17:00 --end 18:00 --db guitar
 *   bun run scripts/notion-add.ts --title "勉強" --date 2026-02-14 --start 10:00 --end 12:00 --db study --category "法律" --book "民法入門" --chapter "5"
 *
 * meals DB の場合、ページ作成後に自動で notion-recipe-gen.ts を実行してレシピを書き込む。
 * レシピ不要な場合（外食・他人作等）は --no-recipe を付ける。
 *
 * その他の DB（events / guitar / sound / study / other）はページ作成後に自動でテンプレートを書き込む。
 * テンプレート不要な場合は --no-template を付ける。
 */

import { type ScheduleDbName, getScheduleDbConfig, notionFetch, queryDbByDateCached, invalidateNotionCache, parseArgs, pickTaskIcon, pickCover, normalizeTitle, getTimeFromISO, findSimilarEntries } from "./lib/notion";
import { callLLM } from "../lib/llm";

// --- Page templates ---

type NotionBlock = Record<string, unknown>;

const h2 = (text: string): NotionBlock => ({
  type: "heading_2",
  heading_2: { rich_text: [{ type: "text", text: { content: text } }] },
});
const p = (text = ""): NotionBlock => ({
  type: "paragraph",
  paragraph: { rich_text: text ? [{ type: "text", text: { content: text } }] : [] },
});
const divider = (): NotionBlock => ({ type: "divider", divider: {} });
const callout = (text: string, emoji: string): NotionBlock => ({
  type: "callout",
  callout: { rich_text: [{ type: "text", text: { content: text } }], icon: { type: "emoji", emoji } },
});
const bullet = (text: string): NotionBlock => ({
  type: "bulleted_list_item",
  bulleted_list_item: { rich_text: [{ type: "text", text: { content: text } }] },
});

interface TemplateOpts {
  date: string;
  start: string;
  end: string;
  category?: string;
  book?: string;
  chapter?: string;
}

const DB_TEMPLATES: Partial<Record<ScheduleDbName, (opts: TemplateOpts) => NotionBlock[]>> = {
  events: () => [
    h2("今日の内容"),
    p(),
    h2("気づき・課題"),
    p(),
    h2("詳細"),
    bullet("場所: "),
    bullet("参加者: "),
  ],
  study: ({ date, start, end, category = "", book = "", chapter = "" }) => {
    const meta = [
      `📅 ${date}  ${start} → ${end}`,
      category ? `🏷 ${category}` : "",
      book ? `📗 ${book}` : "",
      chapter ? `📌 ${chapter}` : "",
    ].filter(Boolean).join("  |  ");
    return [
      callout(meta, "📚"),
      divider(),
      h2("🎯 今日の目標・疑問"),
      p(),
      divider(),
      h2("📝 ノート"),
      p(),
      divider(),
      h2("🔑 キーワード"),
      p(),
      divider(),
      h2("💡 まとめ"),
      p(),
      divider(),
      h2("❓ 残った疑問・次回へ"),
      p(),
    ];
  },
};

async function writeTemplate(apiKey: string, pageId: string, dbName: ScheduleDbName, opts: TemplateOpts): Promise<void> {
  const templateFn = DB_TEMPLATES[dbName];
  if (!templateFn) return;
  const blocks = templateFn(opts);
  await notionFetch(apiKey, `/blocks/${pageId}/children`, { children: blocks }, "PATCH");
  console.log(`📋 テンプレートを適用しました`);
}

// --- Title normalization ---

/**
 * タイトルキーワードリスト
 * キーワードが入力タイトルに含まれていれば、canonical タイトルに統一する。
 * 順番に評価し、最初にマッチしたものを使う。
 */
const TITLE_KEYWORD_LIST: { keywords: (string | RegExp)[]; canonical: string }[] = [
  { keywords: ["開発", "コーディング", "実装", "life-os", "プログラミング", "コード"], canonical: "開発" },
  { keywords: ["ジム", "筋トレ", "トレーニング", "ワークアウト"], canonical: "ジム" },
  { keywords: ["ランニング", "ジョギング", "走"], canonical: "ランニング" },
  { keywords: ["デボーション", "礼拝", "QT", "祈り"], canonical: "デボーション" },
  { keywords: ["勉強", "学習", "study"], canonical: "勉強（読書）" },
  { keywords: ["ギター", "練習"], canonical: "ギター練習" },
  { keywords: ["買い出し", "買い物", "スーパー"], canonical: "買い出し" },
  { keywords: ["散歩", "ウォーキング"], canonical: "散歩" },
];

/** タイトルを TITLE_KEYWORD_LIST に基づいて正規化する */
export function normalizeByKeywordList(title: string): string {
  for (const entry of TITLE_KEYWORD_LIST) {
    for (const kw of entry.keywords) {
      const matched = typeof kw === "string" ? title.includes(kw) : kw.test(title);
      if (matched) return entry.canonical;
    }
  }
  return title;
}

// --- Meals auto-recipe ---

/** レシピ不要と判断するキーワード（タイトルに含まれていたらスキップ） */
const SKIP_RECIPE_PATTERNS = [
  /作$/, /作）$/, /作\)$/,  // 「〇〇作」「〇〇作）」
  /外食/,
  /コンビニ/,
  /スキップ/,
  /カップ/,
  /買い食い/,
  /残り物/,
  /テイクアウト/,
  /出前/,
  /デリバリー/,
];

function shouldSkipRecipe(title: string): boolean {
  return SKIP_RECIPE_PATTERNS.some((p) => p.test(title));
}

async function runRecipeGen(pageId: string, servings?: number): Promise<void> {
  console.log(`\n🍳 レシピ自動生成中...`);
  const cmd = ["bun", "run", "notion/notion-recipe-gen.ts", "--page-id", pageId];
  if (servings && servings >= 2) {
    cmd.push("--servings", String(servings));
  }
  const proc = Bun.spawn(cmd, {
      cwd: import.meta.dir + "/..",
      env: process.env,
      stdout: "inherit",
      stderr: "inherit",
    },
  );
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    throw new Error(`レシピ生成に失敗しました（exit code: ${exitCode}）。ページは作成済みです。`);
  }
}

async function aiIsDuplicate(newTitle: string, existingTitle: string): Promise<boolean> {
  const prompt = `同じ予定かどうか判定してください。表記揺れ（長音、括弧、スペース等）は同一とみなします。ただし「買い出し」と「パーティ」のように活動内容が異なるものは別の予定です。

新規: "${newTitle}"
既存: "${existingTitle}"

同じ予定なら "yes"、別の予定なら "no" とだけ答えてください。`;
  try {
    const output = await callLLM(
      [{ role: "user", content: prompt }],
      { model: "claude-haiku-4-5-20251001" },
    );
    return output.trim().toLowerCase().includes("yes");
  } catch {
    return false;
  }
}

async function checkDuplicate(apiKey: string, dbId: string, config: any, date: string, title: string, newStart?: string, newEnd?: string): Promise<boolean> {
  const similar = await findSimilarEntries(date, title, {
    start: newStart,
    end: newEnd,
  });

  for (const entry of similar) {
    if (entry.matchType === "exact") {
      console.error(`重複検出: "${entry.title}" が既に存在します。スキップします。`);
      return true;
    }
    // 部分的に似ている場合 → AI で判定
    const isDup = await aiIsDuplicate(title, entry.title);
    if (isDup) {
      console.error(`重複検出（AI判定）: "${entry.title}" と同一の予定です。スキップします。`);
      return true;
    }
  }
  return false;
}

async function main() {
  const { flags, opts } = parseArgs();
  if (!opts.title || !opts.date) {
    console.error("Usage:");
    console.error("  bun run scripts/notion-add.ts --title <title> --date YYYY-MM-DD --start HH:MM --end HH:MM");
    console.error("  Options: --db <routine|events|guitar|sound|meals> --end-date YYYY-MM-DD");
    console.error("  Options: --actual-start HH:MM --actual-end HH:MM --location <住所>");
    process.exit(1);
  }

  const dbName = (opts.db || "devotion") as ScheduleDbName;
  const { apiKey, dbId, config } = getScheduleDbConfig(dbName);

  const normalizedTitle = normalizeByKeywordList(opts.title);
  if (normalizedTitle !== opts.title) {
    console.log(`タイトル正規化: "${opts.title}" → "${normalizedTitle}"`);
    opts.title = normalizedTitle;
  }

  const properties: Record<string, unknown> = {
    [config.titleProp]: { title: [{ text: { content: opts.title } }] },
  };

  if (!opts.start) {
    console.error("Error: --start required");
    process.exit(1);
  }
  const endDate = opts["end-date"] || opts.date;
  const dateObj: Record<string, string> = {
    start: `${opts.date}T${opts.start}:00+09:00`,
  };
  if (opts.end) {
    dateObj.end = `${endDate}T${opts.end}:00+09:00`;
  }
  properties[config.dateProp] = { date: dateObj };

  // 移動時間管理プロパティ（開始時間/終了時間/場所）
  if (opts["actual-start"]) {
    properties["開始時間"] = { rich_text: [{ text: { content: opts["actual-start"] } }] };
  }
  if (opts["actual-end"]) {
    properties["終了時間"] = { rich_text: [{ text: { content: opts["actual-end"] } }] };
  }
  if (opts.location) {
    properties["場所"] = { rich_text: [{ text: { content: opts.location } }] };
  }

  // 重複チェック
  const isDuplicate = await checkDuplicate(apiKey, dbId, config, opts.date, opts.title, opts.start, opts.end);
  if (isDuplicate) {
    process.exit(0);
  }

  const icon = pickTaskIcon(opts.title, config.defaultIcon || "📌");
  const cover = pickCover();

  const data: any = await notionFetch(apiKey, "/pages", { parent: { database_id: dbId }, properties, icon, cover });
  invalidateNotionCache(dbId, opts.date);
  const title = (data.properties[config.titleProp]?.title || [])
    .map((t: any) => t.plain_text || "").join("");
  const date = data.properties[config.dateProp]?.date;
  console.log(`追加しました: ${title} [${dbName}]`);
  if (date?.end) {
    console.log(`  ${date.start} 〜 ${date.end}`);
  } else if (date?.start) {
    console.log(`  ${date.start}`);
  }

  // meals DB → 自動レシピ生成
  if (dbName === "meals" && !flags.has("no-recipe")) {
    if (shouldSkipRecipe(opts.title)) {
      console.log(`📝 レシピ不要（${opts.title}）— スキップ`);
    } else {
      const servings = opts.servings ? parseInt(opts.servings, 10) : undefined;
      await runRecipeGen(data.id, servings);
    }
  }

  // その他の DB → テンプレート自動適用
  if (dbName !== "meals" && !flags.has("no-template")) {
    await writeTemplate(apiKey, data.id, dbName, {
      date: opts.date,
      start: opts.start || "",
      end: opts.end || "",
      category: opts.category,
      book: opts.book,
      chapter: opts.chapter,
    });
  }
}

if (import.meta.main) {
  main().catch((err) => {
    console.error("Error:", err.message);
    process.exit(1);
  });
}
