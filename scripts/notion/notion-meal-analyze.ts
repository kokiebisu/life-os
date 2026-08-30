/**
 * Notion meals DB の画像エントリーを走査して、kcal/PFC を自動推定する。
 *
 * 対象判定:
 *   - ページ本文に image ブロックがある
 *   - ANALYSIS_MARKER（"推定（画像分析）"）が未記入（冪等性）
 *   - 材料リスト（"- X 数字g/個/本/枚"）が未記入（自炊除外）
 *   - 数値 kcal（"\d+\s*kcal"）が未記入
 */

import type { MealVisionResult } from "../lib/vision.ts";
import { analyzeMealImages } from "../lib/vision.ts";
import { notionFetch, getMealsConfig, queryDbByDate, getApiKey, parseArgs } from "../lib/notion.ts";

export const ANALYSIS_MARKER = "推定（画像分析）";

const INGREDIENT_PATTERN = /-?\s*.+?\s+\d+\s*(g|個|本|枚)/;
const KCAL_PATTERN = /\d+\s*kcal/;

type NotionBlock = Record<string, any>;

export function extractImageUrls(blocks: NotionBlock[]): string[] {
  const urls: string[] = [];
  for (const b of blocks) {
    if (b.type !== "image") continue;
    const img = b.image;
    if (!img) continue;
    if (img.type === "file" && img.file?.url) urls.push(img.file.url);
    else if (img.type === "external" && img.external?.url) urls.push(img.external.url);
  }
  return urls;
}

export function blocksToPlainText(blocks: NotionBlock[]): string {
  const parts: string[] = [];
  for (const b of blocks) {
    const payload = b[b.type];
    const rich = payload?.rich_text;
    if (Array.isArray(rich)) {
      for (const r of rich) {
        if (r?.plain_text) parts.push(r.plain_text);
      }
    }
  }
  return parts.join("\n");
}

export function shouldAnalyze(blocks: NotionBlock[]): boolean {
  const images = extractImageUrls(blocks);
  if (images.length === 0) return false;
  const text = blocksToPlainText(blocks);
  if (text.includes(ANALYSIS_MARKER)) return false;
  if (INGREDIENT_PATTERN.test(text)) return false;
  if (KCAL_PATTERN.test(text)) return false;
  return true;
}

const GENERIC_TITLES = new Set(["外食", "朝食", "昼食", "夕食"]);

/**
 * 既存タイトルと推定料理名から、新しいタイトルを返す。
 * 変更不要なら既存タイトルをそのまま返す。
 */
export function computeEnhancedTitle(currentTitle: string, dishName: string): string {
  const trimmed = currentTitle.trim();

  if (trimmed === "") return `外食（${dishName}）`;
  if (GENERIC_TITLES.has(trimmed)) return `外食（${dishName}）`;

  if (trimmed.startsWith("外食") && trimmed.includes("（")) return currentTitle;

  return currentTitle;
}

function richText(text: string) {
  return [{ type: "text", text: { content: text } }];
}

const CONFIDENCE_JA: Record<MealVisionResult["confidence"], string> = {
  high: "高",
  medium: "中",
  low: "低",
};

export function buildAnalysisBlocks(result: MealVisionResult): NotionBlock[] {
  const blocks: NotionBlock[] = [];

  blocks.push({
    object: "block",
    type: "heading_2",
    heading_2: { rich_text: richText(ANALYSIS_MARKER) },
  });

  blocks.push({
    object: "block",
    type: "paragraph",
    paragraph: { rich_text: richText(result.dishName) },
  });

  for (const item of result.items) {
    blocks.push({
      object: "block",
      type: "bulleted_list_item",
      bulleted_list_item: { rich_text: richText(item) },
    });
  }

  const summary = `~${result.kcal} kcal | P: ${result.protein}g | F: ${result.fat}g | C: ${result.carbs}g`;
  blocks.push({
    object: "block",
    type: "paragraph",
    paragraph: { rich_text: richText(summary) },
  });

  const confJa = CONFIDENCE_JA[result.confidence];
  const reason = result.confidenceReason ? ` / ${result.confidenceReason}` : "";
  blocks.push({
    object: "block",
    type: "quote",
    quote: { rich_text: richText(`画像分析による概算（信頼度: ${confJa}${reason}）`) },
  });

  return blocks;
}

async function fetchPageChildren(apiKey: string, pageId: string): Promise<NotionBlock[]> {
  const res = await notionFetch(apiKey, `/blocks/${pageId}/children?page_size=100`);
  return res.results ?? [];
}

async function appendBlocks(apiKey: string, pageId: string, blocks: NotionBlock[]): Promise<void> {
  await notionFetch(apiKey, `/blocks/${pageId}/children`, { children: blocks }, "PATCH");
}

async function fetchPage(apiKey: string, pageId: string): Promise<any> {
  return notionFetch(apiKey, `/pages/${pageId}`);
}

async function updatePageTitle(
  apiKey: string,
  pageId: string,
  titleProp: string,
  newTitle: string,
): Promise<void> {
  await notionFetch(
    apiKey,
    `/pages/${pageId}`,
    {
      properties: {
        [titleProp]: { title: [{ text: { content: newTitle } }] },
      },
    },
    "PATCH",
  );
}

function getPageTitle(page: any, titleProp: string): string {
  const prop = page.properties?.[titleProp];
  const rich = prop?.title;
  if (!Array.isArray(rich)) return "";
  return rich.map((r: any) => r.plain_text ?? "").join("");
}

export interface AnalyzeOutcome {
  pageId: string;
  status: "analyzed" | "skipped" | "failed";
  reason?: string;
  dishName?: string;
}

export async function analyzePage(
  apiKey: string,
  pageId: string,
  titleProp: string,
  options: { dryRun: boolean },
): Promise<AnalyzeOutcome> {
  const [page, blocks] = await Promise.all([
    fetchPage(apiKey, pageId),
    fetchPageChildren(apiKey, pageId),
  ]);

  if (!shouldAnalyze(blocks)) {
    return { pageId, status: "skipped", reason: "対象外（マーカー or 材料リスト or kcal あり、または画像なし）" };
  }

  const imageUrls = extractImageUrls(blocks);
  if (options.dryRun) {
    return {
      pageId,
      status: "skipped",
      reason: `dry-run: ${imageUrls.length}枚の画像を分析予定`,
    };
  }

  let result;
  try {
    result = await analyzeMealImages(imageUrls, { pageId });
  } catch (e) {
    return { pageId, status: "failed", reason: `vision 失敗: ${(e as Error).message}` };
  }

  const analysisBlocks = buildAnalysisBlocks(result);
  await appendBlocks(apiKey, pageId, analysisBlocks);

  const currentTitle = getPageTitle(page, titleProp);
  const newTitle = computeEnhancedTitle(currentTitle, result.dishName);
  if (newTitle !== currentTitle) {
    await updatePageTitle(apiKey, pageId, titleProp, newTitle);
  }

  return { pageId, status: "analyzed", dishName: result.dishName };
}

export interface AnalyzeRunResult {
  total: number;
  analyzed: number;
  skipped: number;
  failed: number;
  outcomes: AnalyzeOutcome[];
}

export async function analyzeRange(options: {
  from?: string;
  to?: string;
  date?: string;
  pageId?: string;
  dryRun: boolean;
}): Promise<AnalyzeRunResult> {
  const apiKey = getApiKey();
  const { dbId, config } = getMealsConfig();

  let pageIds: string[];
  if (options.pageId) {
    pageIds = [options.pageId];
  } else {
    const from = options.date ?? options.from;
    const to = options.date ?? options.to;
    if (!from || !to) {
      throw new Error("--date または --from/--to が必要です");
    }
    const queryResult = await queryDbByDate(apiKey, dbId, config, from, to);
    pageIds = (queryResult.results ?? []).map((p: any) => p.id);
  }

  const outcomes: AnalyzeOutcome[] = [];
  for (const pageId of pageIds) {
    const outcome = await analyzePage(apiKey, pageId, config.titleProp, {
      dryRun: options.dryRun,
    });
    outcomes.push(outcome);
  }

  return {
    total: outcomes.length,
    analyzed: outcomes.filter((o) => o.status === "analyzed").length,
    skipped: outcomes.filter((o) => o.status === "skipped").length,
    failed: outcomes.filter((o) => o.status === "failed").length,
    outcomes,
  };
}

async function main() {
  const { flags, opts } = parseArgs();
  const dryRun = flags.has("dry-run");

  try {
    const result = await analyzeRange({
      from: opts["from"],
      to: opts["to"],
      date: opts["date"],
      pageId: opts["page-id"],
      dryRun,
    });

    console.log(`対象: ${result.total}件`);
    for (const o of result.outcomes) {
      const label = o.status === "analyzed" ? "✅" : o.status === "skipped" ? "➖" : "❌";
      const detail = o.dishName ? ` → ${o.dishName}` : o.reason ? ` (${o.reason})` : "";
      console.log(`${label} ${o.pageId}${detail}`);
    }
    console.log(
      `\n成功: ${result.analyzed}件 / スキップ: ${result.skipped}件 / 失敗: ${result.failed}件`,
    );
    if (result.failed > 0) process.exit(1);
  } catch (e) {
    console.error(`Error: ${(e as Error).message}`);
    process.exit(1);
  }
}

if (import.meta.main) {
  await main();
}
