/**
 * 食事画像分析ライブラリ
 *
 * Notion の画像 URL を受け取って、Claude Code（`claude -p` CLI）の
 * マルチモーダル機能で 1 食分の栄養情報を推定する。
 */

import { writeFileSync, unlinkSync, existsSync } from "fs";
import { callClaude } from "./claude.ts";

export interface MealVisionResult {
  dishName: string;
  items: string[];
  kcal: number;
  protein: number;
  fat: number;
  carbs: number;
  confidence: "high" | "medium" | "low";
  confidenceReason?: string;
  imageCount: number;
}

export const MAX_IMAGES = 5;

export const SUPPORTED_CONTENT_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

/**
 * Content-Type ヘッダから拡張子を判定する。
 * サポート外なら null を返す。
 */
export function extensionFromContentType(contentType: string | null): string | null {
  if (!contentType) return null;
  const head = contentType.split(";")[0];
  if (!head) return null;
  const type = head.trim().toLowerCase();
  return SUPPORTED_CONTENT_TYPES[type] ?? null;
}

export interface DownloadedImage {
  path: string;
  cleanup: () => void;
}

export async function downloadImage(
  url: string,
  opts: { pageId: string; index: number },
): Promise<DownloadedImage | null> {
  let res: Response;
  try {
    res = await fetch(url);
  } catch {
    return null;
  }
  if (!res.ok) return null;

  const ext = extensionFromContentType(res.headers.get("content-type"));
  if (!ext) return null;

  const buf = new Uint8Array(await res.arrayBuffer());
  const pageIdNoDash = opts.pageId.replace(/-/g, "");
  const ts = Date.now();
  const path = `/tmp/meal-${pageIdNoDash}-${ts}-${opts.index}.${ext}`;
  writeFileSync(path, buf);
  return {
    path,
    cleanup: () => {
      if (existsSync(path)) unlinkSync(path);
    },
  };
}

const VALID_CONFIDENCE = new Set(["high", "medium", "low"]);

export function parseVisionJson(raw: string, imageCount: number): MealVisionResult {
  // 1. Try to extract JSON from markdown code fence
  let text = raw.trim();
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (fenceMatch && fenceMatch[1]) text = fenceMatch[1].trim();

  // 2. If still has surrounding text, find the outermost {...}
  if (!text.startsWith("{")) {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start === -1 || end === -1 || end <= start) {
      throw new Error(`No JSON object found in vision output: ${raw.slice(0, 100)}`);
    }
    text = text.slice(start, end + 1);
  }

  let parsed: any;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    throw new Error(`Vision output is not valid JSON: ${(e as Error).message}`);
  }

  const required = ["dishName", "items", "kcal", "protein", "fat", "carbs", "confidence"] as const;
  for (const key of required) {
    if (parsed[key] === undefined || parsed[key] === null) {
      throw new Error(`Vision output missing required field: ${key}`);
    }
  }
  if (typeof parsed.dishName !== "string") throw new Error("dishName must be string");
  if (!Array.isArray(parsed.items)) throw new Error("items must be array");
  if (typeof parsed.kcal !== "number") throw new Error("kcal must be number");
  if (typeof parsed.protein !== "number") throw new Error("protein must be number");
  if (typeof parsed.fat !== "number") throw new Error("fat must be number");
  if (typeof parsed.carbs !== "number") throw new Error("carbs must be number");
  if (!VALID_CONFIDENCE.has(parsed.confidence)) {
    throw new Error(`Invalid confidence: ${parsed.confidence}`);
  }

  return {
    dishName: parsed.dishName,
    items: parsed.items.map(String),
    kcal: parsed.kcal,
    protein: parsed.protein,
    fat: parsed.fat,
    carbs: parsed.carbs,
    confidence: parsed.confidence,
    confidenceReason: typeof parsed.confidenceReason === "string" ? parsed.confidenceReason : undefined,
    imageCount,
  };
}

export function buildVisionPrompt(imagePaths: string[]): string {
  const pathList = imagePaths.map((p) => `- ${p}`).join("\n");
  return `あなたは栄養士アシスタントです。指定された画像群は同一の食事を複数の角度・タイミングで撮影したものです。全画像を参考に、1 食分として合算の栄養情報を推定してください。

画像:
${pathList}

複数画像の扱い:
- 同じ料理が別角度で写っている場合は二重計上しない（1 品として扱う）
- 別の料理（例: 丼 + サイドサラダ）が写っている場合は両方を合算する
- 食卓全景 + 個別アップの組み合わせなら、全景で品数を確認し個別アップで材料を特定する

以下の JSON だけを返してください。説明文や Markdown コードブロックは不要です。

{
  "dishName": "料理名（日本語、複数料理なら「メイン + サイド」のように連結）",
  "items": ["主な食材 推定量", ...],
  "kcal": 合計値,
  "protein": 合計値,
  "fat": 合計値,
  "carbs": 合計値,
  "confidence": "high" | "medium" | "low",
  "confidenceReason": "低い場合の理由（オプション）"
}

推定の目安:
- 一般的な定食・丼・麺類など典型的な料理は high
- 具材が見えにくい / 複数皿が重なっている → medium
- 暗い / ピントが合っていない / 部分的に見切れている → low
- 同一料理か別料理かの判別が難しい → medium 以下`;
}

/**
 * 画像 URL のリストから 1 食分の栄養情報を推定する。
 * - 最大 MAX_IMAGES 枚。超過分は無視（コンソール警告）
 * - 一部のダウンロード失敗は許容（残った画像で続行）
 * - 全画像失敗なら例外
 * - JSON パース失敗時は 1 回だけリトライ
 */
export async function analyzeMealImages(
  imageUrls: string[],
  options: { pageId: string },
): Promise<MealVisionResult> {
  if (imageUrls.length === 0) {
    throw new Error("analyzeMealImages: imageUrls is empty");
  }

  const targetUrls = imageUrls.slice(0, MAX_IMAGES);
  if (imageUrls.length > MAX_IMAGES) {
    console.warn(
      `[vision] ${imageUrls.length}枚の画像があるため、先頭${MAX_IMAGES}枚のみ使用します（pageId=${options.pageId}）`,
    );
  }

  const downloads: DownloadedImage[] = [];
  try {
    const results = await Promise.all(
      targetUrls.map((url, i) => downloadImage(url, { pageId: options.pageId, index: i })),
    );
    for (const r of results) {
      if (r) downloads.push(r);
    }
    if (downloads.length === 0) {
      throw new Error("すべての画像のダウンロードに失敗しました");
    }

    const prompt = buildVisionPrompt(downloads.map((d) => d.path));

    for (let attempt = 0; attempt < 2; attempt++) {
      const raw = await callClaude([{ role: "user", content: prompt }], {
        model: "claude-haiku-4-5-20251001",
        maxTokens: 1024,
        allowedTools: ["Read"],
        maxTurns: 3,
      });
      try {
        return parseVisionJson(raw, downloads.length);
      } catch (e) {
        if (attempt === 1) throw e;
        console.warn(`[vision] JSON パース失敗、リトライします: ${(e as Error).message}`);
      }
    }
    throw new Error("unreachable");
  } finally {
    for (const d of downloads) d.cleanup();
  }
}
