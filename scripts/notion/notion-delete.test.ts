import { describe, test, expect } from "bun:test";
import { parsePageIds, extractTitleFromPage } from "./notion-delete";

describe("parsePageIds", () => {
  test("returns positional args verbatim", () => {
    expect(parsePageIds(["abc123", "def456"])).toEqual(["abc123", "def456"]);
  });

  test("filters out long flags", () => {
    expect(parsePageIds(["--dry-run", "abc123"])).toEqual(["abc123"]);
  });

  test("preserves order of positionals", () => {
    expect(parsePageIds(["1", "--flag", "2", "--other", "3"])).toEqual(["1", "2", "3"]);
  });

  test("empty argv returns empty array", () => {
    expect(parsePageIds([])).toEqual([]);
  });

  test("only flags returns empty array", () => {
    expect(parsePageIds(["--a", "--b"])).toEqual([]);
  });

  test("UUID-style ids are returned untouched", () => {
    const id = "309ce17f-7b98-8194-bc0f-e3a6534cefdf";
    expect(parsePageIds([id])).toEqual([id]);
  });
});

describe("extractTitleFromPage", () => {
  test("extracts plain_text from title property", () => {
    const data = {
      properties: {
        Name: {
          type: "title",
          title: [{ plain_text: "Hello World" }],
        },
      },
    };
    expect(extractTitleFromPage(data, "fallback")).toBe("Hello World");
  });

  test("concatenates multiple title rich-text segments", () => {
    const data = {
      properties: {
        Name: {
          type: "title",
          title: [{ plain_text: "foo " }, { plain_text: "bar" }],
        },
      },
    };
    expect(extractTitleFromPage(data, "fallback")).toBe("foo bar");
  });

  test("returns fallback when properties are missing", () => {
    expect(extractTitleFromPage({}, "page-id-here")).toBe("page-id-here");
  });

  test("returns fallback when there is no title property", () => {
    const data = {
      properties: {
        Status: { type: "select", select: { name: "Done" } },
      },
    };
    expect(extractTitleFromPage(data, "fallback-id")).toBe("fallback-id");
  });

  test("returns fallback when title is empty array", () => {
    const data = {
      properties: { Name: { type: "title", title: [] } },
    };
    expect(extractTitleFromPage(data, "id")).toBe("id");
  });

  test("treats null data gracefully", () => {
    expect(extractTitleFromPage(null, "id-fallback")).toBe("id-fallback");
  });

  test("ignores non-title properties when picking", () => {
    const data = {
      properties: {
        Status: { type: "select", select: { name: "Done" } },
        Name: { type: "title", title: [{ plain_text: "Real" }] },
      },
    };
    expect(extractTitleFromPage(data, "fallback")).toBe("Real");
  });

  test("missing plain_text in segment is treated as empty string", () => {
    const data = {
      properties: {
        Name: { type: "title", title: [{}, { plain_text: "tail" }] },
      },
    };
    expect(extractTitleFromPage(data, "fb")).toBe("tail");
  });
});
