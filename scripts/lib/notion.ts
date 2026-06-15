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

export type ScheduleDbName = "devotion" | "events" | "meals" | "groceries" | "todo" | "other" | "study" | "topic" | "interview" | "investment" | "rebalance";

export interface ScheduleDbConfig {
  envKey: string;
  titleProp: string;
  dateProp: string;
  descProp: string;
  statusProp?: string;
  statusDone?: string;
  extraFilter?: Record<string, unknown>;
  defaultIcon?: string;
}

export const SCHEDULE_DB_CONFIGS: Record<ScheduleDbName, ScheduleDbConfig> = {
  devotion: { envKey: "NOTION_DEVOTION_DB", titleProp: "Name", dateProp: "日付", descProp: "" },
  events:  { envKey: "NOTION_EVENTS_DB", titleProp: "名前", dateProp: "日付", descProp: "" },
  meals:      { envKey: "NOTION_MEALS_DB", titleProp: "名前", dateProp: "日付", descProp: "", defaultIcon: "🍽️" },
  groceries:  { envKey: "NOTION_GROCERIES_DB", titleProp: "件名", dateProp: "日付", descProp: "", defaultIcon: "🛒" },
  todo:    { envKey: "NOTION_TODO_DB", titleProp: "タスク名", dateProp: "日付", descProp: "" },
  other:   { envKey: "NOTION_OTHER_DB", titleProp: "名前", dateProp: "日付", descProp: "" },
  study:     { envKey: "NOTION_STUDY_DB", titleProp: "名前", dateProp: "日付", descProp: "" },
  topic:     { envKey: "NOTION_STUDY_TOPIC_DB", titleProp: "名前", dateProp: "日付", descProp: "" },
  interview: { envKey: "NOTION_INTERVIEW_PREP_DB", titleProp: "名前", dateProp: "日付", descProp: "" },
  investment: { envKey: "NOTION_INVESTMENT_DB", titleProp: "名前", dateProp: "日付", descProp: "", defaultIcon: "📈" },
  rebalance:  { envKey: "NOTION_REBALANCE_DB", titleProp: "名前", dateProp: "日付", descProp: "", defaultIcon: "♻️" },
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

export function getDevotionConfig() {
  return { apiKey: getApiKey(), dbId: getDbId("NOTION_DEVOTION_DB") };
}

export function getMealsConfig() {
  return getScheduleDbConfig("meals");
}

export function getEventsConfig() {
  return getScheduleDbConfig("events");
}

export function getTodoConfig() {
  return getScheduleDbConfig("todo");
}

// --- Gym DB Config ---
// ジムDB（種目・重量・セット数・回数）。ステータスなし。Notion MCP 経由で操作する。
export const GYM_DATA_SOURCE_ID = "326ce17f-7b98-806a-be76-000b67b58628";

export function getGymDbId() {
  return getDbId("NOTION_GYM_DB");
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
  if (!config.statusProp) {
    // No status property — return all entries (optionally filtered by extraFilter)
    const body: Record<string, unknown> = {
      sorts: [{ property: config.dateProp, direction: "ascending" }],
    };
    if (config.extraFilter) body.filter = config.extraFilter;
    return notionFetch(apiKey, `/databases/${dbId}/query`, body);
  }
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
    return {
      id: page.id,
      source,
      title: titleArr.map((t: any) => t.plain_text || "").join(""),
      start: dateObj?.start || "",
      end: dateObj?.end || null,
      status: (config.statusProp ? props[config.statusProp]?.status?.name : undefined) || "",
      description: descArr.map((t: any) => t.plain_text || "").join(""),
      feedback: feedbackArr.map((t: any) => t.plain_text || "").join(""),
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
    const msg = (err as any).message ?? (err as any).error?.message ?? JSON.stringify(err);
    throw new Error(`Notion API ${res.status}: ${msg}`);
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

/**
 * 時刻を含む ISO 文字列にタイムゾーンがなければ +09:00 (JST) を自動付与する。
 * 日付のみ（時刻なし）の場合はそのまま返す。
 */
export function ensureJST(dateStr: string): string {
  if (!dateStr.includes("T")) return dateStr; // date-only
  if (/[+\-]\d{2}:\d{2}$/.test(dateStr) || dateStr.endsWith("Z")) return dateStr; // already has tz
  return dateStr + "+09:00";
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
  [/面接|interview/i, "👔"],
  [/ミーティング|会議|MTG|meeting|壁打ち/i, "🤝"],
  [/医者|病院|歯医者/i, "🏥"],
  [/引越|移住|fukuoka/i, "🏠"],
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

export function pickTaskIcon(title: string, defaultEmoji = "📅"): { type: "emoji"; emoji: string } {
  for (const [pattern, emoji] of TASK_ICON_KEYWORDS) {
    if (pattern.test(title)) return { type: "emoji", emoji };
  }
  return { type: "emoji", emoji: defaultEmoji };
}

export function pickCover(): { type: "external"; external: { url: string } } {
  return { type: "external", external: { url: GRADIENT_COVERS[0] } };
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
 * 既存エントリと新規エントリのタイトル・時間帯を比較し、類似判定を返す。
 * 時間帯（start/end）を options で指定すると、時刻が一致しないエントリは除外される。
 *
 * - "exact": 正規化タイトルが完全一致
 * - "similar": 正規化タイトルが部分一致（どちらかがもう一方を包含）
 * - null: タイトル不一致または時間帯不一致
 */
export function evaluateEntryMatch(
  existingTitle: string,
  existingStart: string | null,
  existingEnd: string | null,
  newTitle: string,
  options?: { start?: string; end?: string },
): "exact" | "similar" | null {
  const normalizedNew = normalizeTitle(newTitle);
  const normalizedExisting = normalizeTitle(existingTitle);

  const titleMatch = normalizedNew === normalizedExisting;
  const titleSimilar = !titleMatch &&
    (normalizedNew.includes(normalizedExisting) || normalizedExisting.includes(normalizedNew));

  if (!titleMatch && !titleSimilar) return null;

  // 時間帯が異なれば別エントリとして許可（Devotion 朝/夜等）
  if (options?.start && existingStart && options.start !== existingStart) return null;
  if (options?.end && existingEnd && options.end !== existingEnd) return null;

  return titleMatch ? "exact" : "similar";
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
      const existingDate = page.properties?.[config.dateProp]?.date;
      const existingStart = getTimeFromISO(existingDate?.start);
      const existingEnd = getTimeFromISO(existingDate?.end);

      const matchType = evaluateEntryMatch(existingTitle, existingStart, existingEnd, title, {
        start: options?.start,
        end: options?.end,
      });
      if (!matchType) continue;

      results.push({
        id: page.id,
        title: existingTitle,
        db: dbName,
        start: existingStart,
        end: existingEnd,
        matchType,
      });
    }
  }

  return results;
}

// --- DB Schema Validation ---

const schemaCache = createCache("notion-schema", { defaultTtlMs: 30 * 60_000 }); // 30 min

interface DbSchema {
  properties: Record<string, { type: string; select?: { options: { name: string }[] }; status?: { options: { name: string }[] } }>;
}

async function fetchDbSchema(dbId: string): Promise<DbSchema> {
  const cached = schemaCache.get<DbSchema>(dbId);
  if (cached) return cached;

  const apiKey = getApiKey();
  const data = await notionFetch(apiKey, `/databases/${dbId}`, undefined, "GET");
  const schema: DbSchema = { properties: {} };
  for (const [name, prop] of Object.entries(data.properties ?? {})) {
    const p = prop as any;
    schema.properties[name] = { type: p.type };
    if (p.type === "select" && p.select?.options) {
      schema.properties[name].select = { options: p.select.options.map((o: any) => ({ name: o.name })) };
    }
    if (p.type === "status" && p.status?.options) {
      schema.properties[name].status = { options: p.status.options.map((o: any) => ({ name: o.name })) };
    }
  }
  schemaCache.set(dbId, schema);
  return schema;
}

/**
 * select/status プロパティの値がDBスキーマに存在するか検証する。
 * 存在しない場合はエラーをthrow（有効な選択肢一覧を含む）。
 */
export async function validateSelectValue(dbId: string, propName: string, value: string): Promise<void> {
  const schema = await fetchDbSchema(dbId);
  const prop = schema.properties[propName];
  if (!prop) {
    const available = Object.keys(schema.properties).join(", ");
    throw new Error(`Property "${propName}" not found in DB. Available: ${available}`);
  }
  if (prop.type === "select") {
    const options = prop.select?.options?.map(o => o.name) ?? [];
    if (!options.includes(value)) {
      throw new Error(`Invalid select value "${value}" for "${propName}". Valid options: ${options.join(", ")}`);
    }
  } else if (prop.type === "status") {
    const options = prop.status?.options?.map(o => o.name) ?? [];
    if (!options.includes(value)) {
      throw new Error(`Invalid status value "${value}" for "${propName}". Valid options: ${options.join(", ")}`);
    }
  } else {
    throw new Error(`Property "${propName}" is type "${prop.type}", not select/status`);
  }
}
