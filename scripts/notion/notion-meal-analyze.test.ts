import { describe, test, expect } from "bun:test";
import {
  extractImageUrls,
  blocksToPlainText,
  shouldAnalyze,
  computeEnhancedTitle,
  buildAnalysisBlocks,
  ANALYSIS_MARKER,
} from "./notion-meal-analyze.ts";
import type { MealVisionResult } from "../lib/vision.ts";

describe("extractImageUrls", () => {
  test("extracts file-hosted image URL", () => {
    const blocks = [
      { type: "image", image: { type: "file", file: { url: "https://s3/file.jpg" } } },
    ];
    expect(extractImageUrls(blocks)).toEqual(["https://s3/file.jpg"]);
  });

  test("extracts external image URL", () => {
    const blocks = [
      { type: "image", image: { type: "external", external: { url: "https://ext/img.png" } } },
    ];
    expect(extractImageUrls(blocks)).toEqual(["https://ext/img.png"]);
  });

  test("multiple image blocks in order", () => {
    const blocks = [
      { type: "paragraph", paragraph: {} },
      { type: "image", image: { type: "file", file: { url: "https://a" } } },
      { type: "image", image: { type: "external", external: { url: "https://b" } } },
    ];
    expect(extractImageUrls(blocks)).toEqual(["https://a", "https://b"]);
  });

  test("no image blocks → empty array", () => {
    const blocks = [{ type: "paragraph", paragraph: {} }];
    expect(extractImageUrls(blocks)).toEqual([]);
  });
});

describe("blocksToPlainText", () => {
  test("concatenates rich_text across block types", () => {
    const blocks = [
      { type: "heading_2", heading_2: { rich_text: [{ plain_text: "昼食" }] } },
      { type: "paragraph", paragraph: { rich_text: [{ plain_text: "豚ロース 150g" }] } },
      { type: "bulleted_list_item", bulleted_list_item: { rich_text: [{ plain_text: "玉ねぎ 80g" }] } },
    ];
    const text = blocksToPlainText(blocks);
    expect(text).toContain("昼食");
    expect(text).toContain("豚ロース 150g");
    expect(text).toContain("玉ねぎ 80g");
  });

  test("handles blocks without rich_text", () => {
    const blocks = [{ type: "divider", divider: {} }];
    expect(blocksToPlainText(blocks)).toBe("");
  });

  test("handles empty rich_text array", () => {
    const blocks = [{ type: "paragraph", paragraph: { rich_text: [] } }];
    expect(blocksToPlainText(blocks)).toBe("");
  });
});

describe("shouldAnalyze", () => {
  test("image + no marker + no ingredient list → true", () => {
    const blocks = [
      { type: "image", image: { type: "file", file: { url: "https://x" } } },
    ];
    expect(shouldAnalyze(blocks)).toBe(true);
  });

  test("image + marker present → false", () => {
    const blocks = [
      { type: "image", image: { type: "file", file: { url: "https://x" } } },
      { type: "heading_2", heading_2: { rich_text: [{ plain_text: ANALYSIS_MARKER }] } },
    ];
    expect(shouldAnalyze(blocks)).toBe(false);
  });

  test("image + ingredient list (- X 150g) → false (self-cook)", () => {
    const blocks = [
      { type: "image", image: { type: "file", file: { url: "https://x" } } },
      { type: "bulleted_list_item", bulleted_list_item: { rich_text: [{ plain_text: "豚ロース 150g" }] } },
    ];
    expect(shouldAnalyze(blocks)).toBe(false);
  });

  test("image + numeric kcal in body → false", () => {
    const blocks = [
      { type: "image", image: { type: "file", file: { url: "https://x" } } },
      { type: "paragraph", paragraph: { rich_text: [{ plain_text: "~520 kcal" }] } },
    ];
    expect(shouldAnalyze(blocks)).toBe(false);
  });

  test("no image → false", () => {
    const blocks = [{ type: "paragraph", paragraph: { rich_text: [{ plain_text: "text" }] } }];
    expect(shouldAnalyze(blocks)).toBe(false);
  });

  test("ingredient with 個 unit → self-cook (false)", () => {
    const blocks = [
      { type: "image", image: { type: "file", file: { url: "https://x" } } },
      { type: "bulleted_list_item", bulleted_list_item: { rich_text: [{ plain_text: "卵 2個" }] } },
    ];
    expect(shouldAnalyze(blocks)).toBe(false);
  });

  test("ingredient with 本 unit → self-cook (false)", () => {
    const blocks = [
      { type: "image", image: { type: "file", file: { url: "https://x" } } },
      { type: "bulleted_list_item", bulleted_list_item: { rich_text: [{ plain_text: "長ねぎ 1本" }] } },
    ];
    expect(shouldAnalyze(blocks)).toBe(false);
  });
});

describe("computeEnhancedTitle", () => {
  test("empty title → 外食（dishName）", () => {
    expect(computeEnhancedTitle("", "ラーメン")).toBe("外食（ラーメン）");
  });

  test("whitespace title → 外食（dishName）", () => {
    expect(computeEnhancedTitle("   ", "ラーメン")).toBe("外食（ラーメン）");
  });

  test("外食 alone → 外食（dishName）", () => {
    expect(computeEnhancedTitle("外食", "ラーメン")).toBe("外食（ラーメン）");
  });

  test("朝食 alone → 外食（dishName）", () => {
    expect(computeEnhancedTitle("朝食", "サンドイッチ")).toBe("外食（サンドイッチ）");
  });

  test("昼食 alone → 外食（dishName）", () => {
    expect(computeEnhancedTitle("昼食", "定食")).toBe("外食（定食）");
  });

  test("夕食 alone → 外食（dishName）", () => {
    expect(computeEnhancedTitle("夕食", "寿司")).toBe("外食（寿司）");
  });

  test("外食（既存内容） → unchanged", () => {
    expect(computeEnhancedTitle("外食（YUTAさん）", "ラーメン")).toBe("外食（YUTAさん）");
  });

  test("店名 → unchanged", () => {
    expect(computeEnhancedTitle("すすきや", "定食")).toBe("すすきや");
  });

  test("具体的な料理名 → unchanged", () => {
    expect(computeEnhancedTitle("担々麺", "担々麺")).toBe("担々麺");
  });
});

describe("buildAnalysisBlocks", () => {
  const result: MealVisionResult = {
    dishName: "豚しょうが焼き定食",
    items: ["豚ロース 150g", "玉ねぎ 80g", "白米 200g"],
    kcal: 780,
    protein: 32,
    fat: 28,
    carbs: 95,
    confidence: "high",
    imageCount: 1,
  };

  test("produces heading, dish paragraph, ingredient bullets, summary, confidence quote", () => {
    const blocks = buildAnalysisBlocks(result);
    const types = blocks.map((b) => b.type);
    expect(types[0]).toBe("heading_2");
    expect(types).toContain("bulleted_list_item");
    expect(types).toContain("paragraph");
    expect(types[types.length - 1]).toBe("quote");
  });

  test("heading contains analysis marker", () => {
    const blocks = buildAnalysisBlocks(result);
    const h = blocks[0]!;
    const text = h.heading_2.rich_text[0].text.content;
    expect(text).toBe("推定（画像分析）");
  });

  test("summary paragraph contains kcal and PFC", () => {
    const blocks = buildAnalysisBlocks(result);
    const texts = blocks.flatMap((b) =>
      b[b.type]?.rich_text?.map((r: any) => r.text?.content) ?? [],
    );
    const joined = texts.join(" ");
    expect(joined).toContain("780");
    expect(joined).toContain("P: 32");
    expect(joined).toContain("F: 28");
    expect(joined).toContain("C: 95");
  });

  test("confidence high → 高", () => {
    const blocks = buildAnalysisBlocks(result);
    const quote = blocks[blocks.length - 1]!;
    const text = quote.quote.rich_text[0].text.content;
    expect(text).toContain("高");
  });

  test("confidence low with reason → 低 + reason", () => {
    const blocks = buildAnalysisBlocks({ ...result, confidence: "low", confidenceReason: "暗くて判別困難" });
    const quote = blocks[blocks.length - 1]!;
    const text = quote.quote.rich_text[0].text.content;
    expect(text).toContain("低");
    expect(text).toContain("暗くて判別困難");
  });
});
