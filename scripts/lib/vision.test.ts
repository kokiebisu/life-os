import { describe, test, expect } from "bun:test";
import { extensionFromContentType, MAX_IMAGES, downloadImage, parseVisionJson, buildVisionPrompt } from "./vision.ts";
import { existsSync, readFileSync } from "fs";

describe("extensionFromContentType", () => {
  test("image/jpeg → jpg", () => {
    expect(extensionFromContentType("image/jpeg")).toBe("jpg");
  });

  test("image/png → png", () => {
    expect(extensionFromContentType("image/png")).toBe("png");
  });

  test("image/webp → webp", () => {
    expect(extensionFromContentType("image/webp")).toBe("webp");
  });

  test("image/jpg → jpg (alias)", () => {
    expect(extensionFromContentType("image/jpg")).toBe("jpg");
  });

  test("Content-Type with charset → still matches", () => {
    expect(extensionFromContentType("image/jpeg; charset=utf-8")).toBe("jpg");
  });

  test("uppercase Content-Type → still matches", () => {
    expect(extensionFromContentType("IMAGE/PNG")).toBe("png");
  });

  test("unsupported type → null", () => {
    expect(extensionFromContentType("image/gif")).toBe(null);
    expect(extensionFromContentType("application/pdf")).toBe(null);
  });

  test("null → null", () => {
    expect(extensionFromContentType(null)).toBe(null);
  });
});

describe("constants", () => {
  test("MAX_IMAGES is 5", () => {
    expect(MAX_IMAGES).toBe(5);
  });
});

describe("downloadImage", () => {
  test("downloads a valid jpeg to /tmp and returns path + cleanup", async () => {
    // Use a data URL-style mock: we'll spin up a tiny fixture file and serve it via file://
    // Simplest approach: stub `fetch` globally for this test
    const originalFetch = globalThis.fetch;
    const fakeBody = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]); // JPEG magic
    globalThis.fetch = (async () => ({
      ok: true,
      status: 200,
      headers: { get: (k: string) => (k.toLowerCase() === "content-type" ? "image/jpeg" : null) },
      arrayBuffer: async () => fakeBody.buffer,
    })) as unknown as typeof fetch;

    try {
      const result = await downloadImage("https://fake/img.jpg", { pageId: "abc123", index: 0 });
      expect(result).not.toBeNull();
      if (!result) throw new Error("result is null");
      expect(result.path.startsWith("/tmp/meal-abc123-")).toBe(true);
      expect(result.path.endsWith("-0.jpg")).toBe(true);
      expect(existsSync(result.path)).toBe(true);
      expect(readFileSync(result.path)).toEqual(Buffer.from(fakeBody));
      result.cleanup();
      expect(existsSync(result.path)).toBe(false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("unsupported content-type returns null", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => ({
      ok: true,
      status: 200,
      headers: { get: () => "image/gif" },
      arrayBuffer: async () => new ArrayBuffer(4),
    })) as unknown as typeof fetch;

    try {
      const result = await downloadImage("https://fake/img.gif", { pageId: "abc", index: 0 });
      expect(result).toBe(null);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("HTTP error returns null", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => ({
      ok: false,
      status: 404,
      headers: { get: () => "image/jpeg" },
      arrayBuffer: async () => new ArrayBuffer(0),
    })) as unknown as typeof fetch;

    try {
      const result = await downloadImage("https://fake/404.jpg", { pageId: "abc", index: 0 });
      expect(result).toBe(null);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe("parseVisionJson", () => {
  test("valid JSON is parsed and imageCount is injected", () => {
    const raw = JSON.stringify({
      dishName: "ラーメン",
      items: ["醤油ラーメン 1杯"],
      kcal: 700,
      protein: 25,
      fat: 20,
      carbs: 90,
      confidence: "high",
    });
    const result = parseVisionJson(raw, 2);
    expect(result.dishName).toBe("ラーメン");
    expect(result.kcal).toBe(700);
    expect(result.imageCount).toBe(2);
    expect(result.confidence).toBe("high");
  });

  test("JSON wrapped in markdown code fence is extracted", () => {
    const raw = '```json\n{"dishName":"A","items":[],"kcal":1,"protein":1,"fat":1,"carbs":1,"confidence":"low"}\n```';
    const result = parseVisionJson(raw, 1);
    expect(result.dishName).toBe("A");
  });

  test("JSON with extra whitespace and surrounding text", () => {
    const raw = 'Here is the JSON:\n{"dishName":"B","items":[],"kcal":2,"protein":2,"fat":2,"carbs":2,"confidence":"medium"}\n';
    const result = parseVisionJson(raw, 1);
    expect(result.dishName).toBe("B");
  });

  test("missing required field throws", () => {
    const raw = JSON.stringify({ dishName: "X" });
    expect(() => parseVisionJson(raw, 1)).toThrow();
  });

  test("invalid confidence value throws", () => {
    const raw = JSON.stringify({
      dishName: "X", items: [], kcal: 1, protein: 1, fat: 1, carbs: 1,
      confidence: "unknown",
    });
    expect(() => parseVisionJson(raw, 1)).toThrow();
  });

  test("non-JSON input throws", () => {
    expect(() => parseVisionJson("not json", 1)).toThrow();
  });
});

describe("buildVisionPrompt", () => {
  test("single image prompt contains the path and JSON schema", () => {
    const prompt = buildVisionPrompt(["/tmp/a.jpg"]);
    expect(prompt).toContain("/tmp/a.jpg");
    expect(prompt).toContain("dishName");
    expect(prompt).toContain("kcal");
    expect(prompt).toContain("confidence");
  });

  test("multi-image prompt lists all paths and explains merging", () => {
    const prompt = buildVisionPrompt(["/tmp/a.jpg", "/tmp/b.png"]);
    expect(prompt).toContain("/tmp/a.jpg");
    expect(prompt).toContain("/tmp/b.png");
    expect(prompt).toContain("同一の食事");
    expect(prompt).toContain("二重計上しない");
  });
});
