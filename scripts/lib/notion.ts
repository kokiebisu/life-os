/**
 * Notion API 共通ユーティリティ
 */

import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { createCache, cacheKey } from "./cache";

const ROOT = join(import.meta.dir, "../..");
const ENV_FILE = join(ROOT, ".env.local");

const NOTION_API_VERSION = "2022-06-28";

let _envCache: Record<string, string> | null = null;

export function loadEnv(): Record<string, string> {
  if (_envCache) return _envCache;
  const env: Record<string, string> = {};
  if (!existsSync(ENV_FILE)) return env;
  const content = readFileSync(ENV_FILE, "utf-8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    let val = trimmed.slice(eqIdx + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    env[trimmed.slice(0, eqIdx).trim()] = val;
  }
  _envCache = env;
  return env;
}

export function getHomeAddress(): string {
  const memoryPath = join(homedir(), ".claude/projects/-workspaces-life/memory/MEMORY.md");
  if (!existsSync(memoryPath)) throw new Error("MEMORY.md not found");
  const content = readFileSync(memoryPath, "utf-8");
  const match = content.match(/^- 住所:\s*(.+)$/m);
  if (!match) throw new Error("住所 not found in MEMORY.md");
  return match[1].trim();
}

export function getApiKey(): string {
  const env = loadEnv();
  const apiKey = env["NOTION_API_KEY"] || process.env.NOTION_API_KEY;
  if (!apiKey) {
    console.error("Error: NOTION_API_KEY must be set in .env.local");
    process.exit(1);
  }
  return apiKey;
}

export function getDbId(envKey: string): string {
  const env = loadEnv();
  const dbId = env[envKey] || process.env[envKey];
  if (!dbId) {
    console.error(`Error: ${envKey} must be set in .env.local`);
    process.exit(1);
  }
  return dbId;
}

export function getDbIdOptional(envKey: string): string | null {
  const env = loadEnv();
  return env[envKey] || process.env[envKey] || null;
}

// --- Schedule DB Config (calendar-based DBs) ---

export type ScheduleDbName = "routine" | "events" | "guitar" | "sound" | "meals" | "groceries" | "todo";

export interface ScheduleDbConfig {
  envKey: string;
  titleProp: string;
  dateProp: string;
  descProp: string;
  statusProp: string;
  statusDone: string;
  extraFilter?: Record<string, unknown>;
}

export const SCHEDULE_DB_CONFIGS: Record<ScheduleDbName, ScheduleDbConfig> = {
  routine: { envKey: "NOTION_TASKS_DB", titleProp: "Name", dateProp: "日付", descProp: "", statusProp: "ステータス", statusDone: "Done" },
  events:  { envKey: "NOTION_EVENTS_DB", titleProp: "名前", dateProp: "日付", descProp: "", statusProp: "ステータス", statusDone: "完了" },
  guitar:  { envKey: "NOTION_CURRICULUM_DB", titleProp: "名前", dateProp: "日付", descProp: "", statusProp: "ステータス", statusDone: "完了", extraFilter: { property: "カリキュラム", select: { equals: "ギター" } } },
  sound:   { envKey: "NOTION_CURRICULUM_DB", titleProp: "名前", dateProp: "日付", descProp: "", statusProp: "ステータス", statusDone: "完了", extraFilter: { property: "カリキュラム", select: { equals: "音響" } } },
  meals:      { envKey: "NOTION_MEALS_DB", titleProp: "名前", dateProp: "日付", descProp: "", statusProp: "ステータス", statusDone: "完了" },
  groceries:  { envKey: "NOTION_GROCERIES_DB", titleProp: "件名", dateProp: "日付", descProp: "", statusProp: "ステータス", statusDone: "完了" },
  todo:    { envKey: "NOTION_TODO_DB", titleProp: "タスク名", dateProp: "日付", descProp: "", statusProp: "ステータス", statusDone: "完了" },
};

export function getScheduleDbConfig(name: ScheduleDbName): { apiKey: string; dbId: string; config: ScheduleDbConfig } {
  const config = SCHEDULE_DB_CONFIGS[name];
  return { apiKey: getApiKey(), dbId: getDbId(config.envKey), config };
}

export function getScheduleDbConfigOptional(name: ScheduleDbName): { apiKey: string; dbId: string; config: ScheduleDbConfig } | null {
  const config = SCHEDULE_DB_CONFIGS[name];
  const dbId = getDbIdOptional(config.envKey);
  if (!dbId) return null;
  return { apiKey: getApiKey(), dbId, config };
}

// --- Article DB Config ---

export type ArticleDbName = "articles";

export interface ArticleDbConfig {
  envKey: string;
  titleProp: string;
  sourceProp: string;
  urlProp: string;
  aspectProp: string;
  statusProp: string;
}

export const ARTICLE_DB_CONFIGS: Record<ArticleDbName, ArticleDbConfig> = {
  articles: {
    envKey: "NOTION_ARTICLES_DB",
    titleProp: "タイトル",
    sourceProp: "ソース",
    urlProp: "URL",
    aspectProp: "Aspect",
    statusProp: "Status",
  },
};

export function getArticleDbConfig(name: ArticleDbName): { apiKey: string; dbId: string; config: ArticleDbConfig } {
  const config = ARTICLE_DB_CONFIGS[name];
  return { apiKey: getApiKey(), dbId: getDbId(config.envKey), config };
}

// --- Investment DB Config ---

export type InvestmentDbName = "investment";

export interface InvestmentDbConfig {
  envKey: string;
  titleProp: string;
  dateProp: string;
  statusProp: string;
  typeProp: string;
  notesProp: string;
}

export const INVESTMENT_DB_CONFIGS: Record<InvestmentDbName, InvestmentDbConfig> = {
  investment: {
    envKey: "NOTION_INVESTMENT_DB",
    titleProp: "Investment ",  // trailing space (Notion property名そのまま)
    dateProp: "Buy Date",
    statusProp: "Status",
    typeProp: "Type",
    notesProp: "Notes",
  },
};

export function getInvestmentDbConfig(name: InvestmentDbName): { apiKey: string; dbId: string; config: InvestmentDbConfig } {
  const config = INVESTMENT_DB_CONFIGS[name];
  return { apiKey: getApiKey(), dbId: getDbId(config.envKey), config };
}

export function getTasksConfig() {
  return { apiKey: getApiKey(), dbId: getDbId("NOTION_TASKS_DB") };
}

export function getMealsConfig() {
  return getScheduleDbConfig("meals");
}

export function getEventsConfig() {
  return getScheduleDbConfig("events");
}

export function getGuitarConfig() {
  return getScheduleDbConfig("guitar");
}

export function getSoundConfig() {
  return getScheduleDbConfig("sound");
}

export function getTodoConfig() {
  return getScheduleDbConfig("todo");
}

// --- Unified DB query & normalization ---

export interface NormalizedEntry {
  id: string;
  source: ScheduleDbName;
  title: string;
  start: string;
  end: string | null;
  status: string;
  description: string;
  feedback: string;
  actualStart: string | null;
  actualEnd: string | null;
  location: string | null;
  hasIcon: boolean;
  hasCover: boolean;
}

export async function queryDbByDate(
  apiKey: string,
  dbId: string,
  config: ScheduleDbConfig,
  startDate: string,
  endDate: string,
): Promise<any> {
  const filters: Record<string, unknown>[] = [
    { property: config.dateProp, date: { on_or_after: startDate + "T00:00:00+09:00" } },
    { property: config.dateProp, date: { on_or_before: endDate + "T23:59:59+09:00" } },
  ];
  if (config.extraFilter) filters.push(config.extraFilter);
  return notionFetch(apiKey, `/databases/${dbId}/query`, {
    filter: { and: filters },
    sorts: [{ property: config.dateProp, direction: "ascending" }],
  });
}

// --- Cached version of queryDbByDate ---

const notionCache = createCache("notion-list", { defaultTtlMs: 5 * 60_000 });

export async function queryDbByDateCached(
  apiKey: string,
  dbId: string,
  config: ScheduleDbConfig,
  startDate: string,
  endDate: string,
): Promise<any> {
  const key = cacheKey(dbId, startDate, endDate);
  const cached = notionCache.get(key);
  if (cached !== undefined) return cached;
  const result = await queryDbByDate(apiKey, dbId, config, startDate, endDate);
  notionCache.set(key, result);
  return result;
}

export function invalidateNotionCache(dbId: string, date: string): void {
  notionCache.invalidate(cacheKey(dbId, date, date));
}

export function clearNotionCache(): number {
  return notionCache.clear();
}

export async function queryDbByStatus(
  apiKey: string,
  dbId: string,
  config: ScheduleDbConfig,
  statuses: string[],
): Promise<any> {
  const statusFilter = {
    or: statuses.map((s) => ({
      property: config.statusProp,
      status: { equals: s },
    })),
  };
  const filter = config.extraFilter
    ? { and: [statusFilter, config.extraFilter] }
    : statusFilter;
  return notionFetch(apiKey, `/databases/${dbId}/query`, {
    filter,
    sorts: [{ property: config.dateProp, direction: "ascending" }],
  });
}

export function normalizePages(pages: any[], config: ScheduleDbConfig, source: ScheduleDbName): NormalizedEntry[] {
  return pages.map((page: any) => {
    const props = page.properties;
    const titleArr = props[config.titleProp]?.title || [];
    const dateObj = props[config.dateProp]?.date;
    const descArr = props[config.descProp]?.rich_text || [];
    const feedbackArr = props.フィードバック?.rich_text || [];
    const actualStartArr = props["開始時間"]?.rich_text || [];
    const actualEndArr = props["終了時間"]?.rich_text || [];
    const locationArr = props["場所"]?.rich_text || [];
    return {
      id: page.id,
      source,
      title: titleArr.map((t: any) => t.plain_text || "").join(""),
      start: dateObj?.start || "",
      end: dateObj?.end || null,
      status: props[config.statusProp]?.status?.name || "",
      description: descArr.map((t: any) => t.plain_text || "").join(""),
      feedback: feedbackArr.map((t: any) => t.plain_text || "").join(""),
      actualStart: actualStartArr.map((t: any) => t.plain_text || "").join("") || null,
      actualEnd: actualEndArr.map((t: any) => t.plain_text || "").join("") || null,
      location: locationArr.map((t: any) => t.plain_text || "").join("") || null,
      hasIcon: !!page.icon,
      hasCover: !!page.cover,
    };
  });
}

export function notionHeaders(apiKey: string) {
  return {
    "Authorization": `Bearer ${apiKey}`,
    "Notion-Version": NOTION_API_VERSION,
    "Content-Type": "application/json",
  };
}

export async function notionFetch(apiKey: string, path: string, body?: unknown, method?: "GET" | "POST" | "PATCH" | "DELETE"): Promise<any> {
  const resolvedMethod = method || (body !== undefined ? "POST" : "GET");
  const res = await fetch(`https://api.notion.com/v1${path}`, {
    method: resolvedMethod,
    headers: notionHeaders(apiKey),
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(`Notion API ${res.status}: ${(err as any).message}`);
  }
  if (res.status === 204) return {};
  return res.json();
}

export function parseArgs(argv?: string[]): { flags: Set<string>; opts: Record<string, string>; positional: string[] } {
  const args = argv || process.argv.slice(2);
  const flags = new Set<string>();
  const opts: Record<string, string> = {};
  const positional: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--") {
      positional.push(...args.slice(i + 1));
      break;
    } else if (args[i].startsWith("--")) {
      const key = args[i].slice(2);
      if (args[i + 1] && !args[i + 1].startsWith("--")) {
        opts[key] = args[i + 1];
        i++;
      } else {
        flags.add(key);
      }
    } else {
      positional.push(args[i]);
    }
  }
  return { flags, opts, positional };
}

export function todayJST(): string {
  return new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });
}

// --- Icon & Cover helpers ---

const TASK_ICON_KEYWORDS: [RegExp, string][] = [
  [/ギター|guitar/i, "🎸"],
  [/音響|PA|sound.*lesson/i, "🎛️"],
  [/教会|礼拝|church|service/i, "⛪"],
  [/ジム|筋トレ|運動|gym|workout/i, "💪"],
  [/バレー|volleyball/i, "🏐"],
  [/買い物|買い出し|shopping/i, "🛒"],
  [/料理|自炊|cook/i, "🍳"],
  [/勉強|学習|study/i, "📖"],
  [/読書|book|reading/i, "📚"],
  [/sumitsugi/i, "🧶"],
  [/面接|interview/i, "👔"],
  [/ミーティング|会議|MTG|meeting|壁打ち/i, "🤝"],
  [/医者|病院|歯医者/i, "🏥"],
  [/引越|移住|fukuoka/i, "🏠"],
  [/投資|invest/i, "📈"],
  [/散歩|walk/i, "🚶"],
  [/昼寝|仮眠|nap/i, "😴"],
  [/開発|develop|coding|プログラ/i, "💻"],
  [/掃除|cleaning/i, "🧹"],
  [/飲み|居酒屋|ご飯|ランチ|lunch/i, "🍽️"],
  [/パーティ|party|新年会|送別会/i, "🎉"],
  [/デート|date/i, "💑"],
  [/旅行|trip|travel|温泉/i, "✈️"],
  [/見学|入会/i, "🔍"],
  [/Devotion|祈り|prayer/i, "🙏"],
  [/シャワー|風呂|bath/i, "🚿"],
  [/ハローワーク|役所|届|手続|申告|確定申告|e-Tax/i, "📋"],
  [/申込|エントリー|登録/i, "📝"],
  [/整理|片付/i, "🗂️"],
  [/カード|クレジット/i, "💳"],
  [/イベント|event/i, "🎪"],
];

const GRADIENT_COVERS = [
  "https://images.unsplash.com/photo-1557683316-973673baf926?w=1200",
  "https://images.unsplash.com/photo-1557682250-33bd709cbe85?w=1200",
  "https://images.unsplash.com/photo-1557682224-5b8590cd9ec5?w=1200",
  "https://images.unsplash.com/photo-1557682260-96773eb01377?w=1200",
  "https://images.unsplash.com/photo-1557682268-e3955ed5d83f?w=1200",
];

export function pickArticleIcon(source: string): { type: "emoji"; emoji: string } {
  const map: Record<string, string> = {
    "Hacker News": "🟠",
    "Zenn": "💠",
    "note": "📝",
    "Twitter": "🐦",
  };
  return { type: "emoji", emoji: map[source] || "📰" };
}

export function pickTaskIcon(title: string, defaultEmoji = "📌"): { type: "emoji"; emoji: string } {
  for (const [pattern, emoji] of TASK_ICON_KEYWORDS) {
    if (pattern.test(title)) return { type: "emoji", emoji };
  }
  return { type: "emoji", emoji: defaultEmoji };
}

export function pickCover(): { type: "external"; external: { url: string } } {
  const url = GRADIENT_COVERS[Math.floor(Math.random() * GRADIENT_COVERS.length)];
  return { type: "external", external: { url } };
}

// --- Title Normalization ---

/** タイトルを正規化（括弧・スペース・長音除去 + 小文字化） */
export function normalizeTitle(title: string): string {
  return title.replace(/[（）()]/g, "").replace(/\s+/g, "").replace(/ー/g, "").toLowerCase();
}

/** ISO日時文字列から HH:MM を抽出 */
export function getTimeFromISO(iso: string | undefined | null): string | null {
  if (!iso) return null;
  const m = iso.match(/T(\d{2}:\d{2})/);
  return m ? m[1] : null;
}

export interface SimilarEntry {
  id: string;
  title: string;
  db: ScheduleDbName;
  start: string | null;
  end: string | null;
  matchType: "exact" | "similar";
}

/**
 * 全スケジュール DB を横断して、指定日に類似タイトルのエントリを検索。
 * options.start を指定すると、時間帯が異なるエントリを除外する（Devotion 朝/夜の区別用）。
 */
export async function findSimilarEntries(
  date: string,
  title: string,
  options?: {
    db?: ScheduleDbName;
    start?: string;
    end?: string;
  },
): Promise<SimilarEntry[]> {
  const apiKey = getApiKey();
  const normalizedNew = normalizeTitle(title);
  const results: SimilarEntry[] = [];

  const dbNames: ScheduleDbName[] = options?.db
    ? [options.db]
    : (Object.keys(SCHEDULE_DB_CONFIGS) as ScheduleDbName[]);

  for (const dbName of dbNames) {
    const dbSetup = getScheduleDbConfigOptional(dbName);
    if (!dbSetup) continue;
    const { dbId, config } = dbSetup;

    let data: any;
    try {
      data = await queryDbByDateCached(apiKey, dbId, config, date, date);
    } catch { continue; }

    const pages: any[] = data.results || [];
    for (const page of pages) {
      const existingTitle = (page.properties?.[config.titleProp]?.title || [])
        .map((t: any) => t.plain_text || "").join("");
      const normalizedExisting = normalizeTitle(existingTitle);

      const titleMatch = normalizedNew === normalizedExisting;
      const titleSimilar = !titleMatch &&
        (normalizedNew.includes(normalizedExisting) || normalizedExisting.includes(normalizedNew));

      if (!titleMatch && !titleSimilar) continue;

      const existingDate = page.properties?.[config.dateProp]?.date;
      const existingStart = getTimeFromISO(existingDate?.start);
      const existingEnd = getTimeFromISO(existingDate?.end);

      // 時間帯が異なれば別エントリとして許可（Devotion 朝/夜等）
      if (options?.start && existingStart && options.start !== existingStart) continue;
      if (options?.end && existingEnd && options.end !== existingEnd) continue;

      results.push({
        id: page.id,
        title: existingTitle,
        db: dbName,
        start: existingStart,
        end: existingEnd,
        matchType: titleMatch ? "exact" : "similar",
      });
    }
  }

  return results;
}
