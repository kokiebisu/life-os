import { describe, test, expect } from "bun:test";
import {
  parseArgs,
  normalizeTitle,
  getTimeFromISO,
  pickTaskIcon,
  pickCover,
  todayJST,
  evaluateEntryMatch,
} from "./notion";

describe("parseArgs", () => {
  test("flag-only argument", () => {
    const { flags, opts, positional } = parseArgs(["--dry-run"]);
    expect(flags.has("dry-run")).toBe(true);
    expect(Object.keys(opts)).toHaveLength(0);
    expect(positional).toEqual([]);
  });

  test("opt with value", () => {
    const { flags, opts } = parseArgs(["--date", "2026-04-29"]);
    expect(flags.has("date")).toBe(false);
    expect(opts.date).toBe("2026-04-29");
  });

  test("opt followed by another --opt is treated as a flag", () => {
    const { flags, opts } = parseArgs(["--dry-run", "--date", "2026-04-29"]);
    expect(flags.has("dry-run")).toBe(true);
    expect(opts.date).toBe("2026-04-29");
  });

  test("positional arguments collected", () => {
    const { positional } = parseArgs(["foo", "bar"]);
    expect(positional).toEqual(["foo", "bar"]);
  });

  test("-- separator forces remainder into positional", () => {
    const { opts, positional } = parseArgs(["--date", "2026-04-29", "--", "--something", "else"]);
    expect(opts.date).toBe("2026-04-29");
    expect(positional).toEqual(["--something", "else"]);
  });

  test("mixed flags, opts, and positionals (a non-'--' value after --opt is consumed as its value)", () => {
    const { flags, opts, positional } = parseArgs(["sync", "--db", "events", "--dry-run", "--verbose"]);
    expect(positional).toEqual(["sync"]);
    expect(opts.db).toBe("events");
    expect(flags.has("dry-run")).toBe(true);
    expect(flags.has("verbose")).toBe(true);
  });
});

describe("normalizeTitle", () => {
  test("removes full-width and half-width parentheses", () => {
    expect(normalizeTitle("勉強（読書）")).toBe("勉強読書");
    expect(normalizeTitle("Foo (bar)")).toBe("foobar");
  });

  test("collapses whitespace", () => {
    expect(normalizeTitle("  hello   world  ")).toBe("helloworld");
  });

  test("removes 長音 character", () => {
    expect(normalizeTitle("コーディング")).toBe("コディング");
  });

  test("lowercases ASCII", () => {
    expect(normalizeTitle("LIFE-OS")).toBe("life-os");
  });

  test("two titles that differ only by parens/case are equal after normalization", () => {
    expect(normalizeTitle("勉強（読書）")).toBe(normalizeTitle("勉強 読書"));
  });
});

describe("getTimeFromISO", () => {
  test("extracts HH:MM from full ISO string", () => {
    expect(getTimeFromISO("2026-04-29T10:30:00+09:00")).toBe("10:30");
  });

  test("extracts HH:MM from ISO without timezone", () => {
    expect(getTimeFromISO("2026-04-29T08:00:00")).toBe("08:00");
  });

  test("returns null for date-only string", () => {
    expect(getTimeFromISO("2026-04-29")).toBe(null);
  });

  test("returns null for null/undefined input", () => {
    expect(getTimeFromISO(null)).toBe(null);
    expect(getTimeFromISO(undefined)).toBe(null);
    expect(getTimeFromISO("")).toBe(null);
  });
});

describe("pickTaskIcon", () => {
  test("matches keywords case-insensitively", () => {
    expect(pickTaskIcon("ギター練習").emoji).toBe("🎸");
    expect(pickTaskIcon("Guitar lesson").emoji).toBe("🎸");
  });

  test("ジム / 筋トレ / workout all map to 💪", () => {
    expect(pickTaskIcon("ジム").emoji).toBe("💪");
    expect(pickTaskIcon("筋トレ").emoji).toBe("💪");
    expect(pickTaskIcon("morning workout").emoji).toBe("💪");
  });

  test("returns default emoji when no keyword matches", () => {
    expect(pickTaskIcon("unrelated title").emoji).toBe("📅");
  });

  test("respects custom default emoji", () => {
    expect(pickTaskIcon("nothing matches here", "🎯").emoji).toBe("🎯");
  });

  test("returned object has type 'emoji'", () => {
    expect(pickTaskIcon("ジム").type).toBe("emoji");
  });

  test("first matching pattern wins (order matters)", () => {
    // 「祈り」も 「礼拝」も含むタイトル → 「礼拝」が先に評価される
    const result = pickTaskIcon("礼拝の祈り");
    expect(result.emoji).toBe("⛪");
  });
});

describe("pickCover", () => {
  test("returns external cover with valid URL", () => {
    const cover = pickCover();
    expect(cover.type).toBe("external");
    expect(cover.external.url).toMatch(/^https:\/\/images\.unsplash\.com\//);
  });
});

describe("todayJST", () => {
  test("returns YYYY-MM-DD format", () => {
    expect(todayJST()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  test("returns the JST date (matches Intl in Asia/Tokyo)", () => {
    const expected = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });
    expect(todayJST()).toBe(expected);
  });
});

describe("evaluateEntryMatch", () => {
  test("正規化後完全一致 → exact", () => {
    expect(evaluateEntryMatch("勉強（読書）", null, null, "勉強 読書")).toBe("exact");
  });

  test("一方が他方を包含 → similar", () => {
    expect(evaluateEntryMatch("ジムに行く", null, null, "ジム")).toBe("similar");
    expect(evaluateEntryMatch("ジム", null, null, "ジムに行く")).toBe("similar");
  });

  test("無関係なタイトル → null", () => {
    expect(evaluateEntryMatch("ジム", null, null, "勉強")).toBe(null);
  });

  test("空文字列 vs 通常タイトル → similar（normalizeTitle('') が任意の文字列に includes される）", () => {
    // 既存実装の挙動を固定: 空タイトルは任意のタイトルの部分文字列扱いになる
    expect(evaluateEntryMatch("", null, null, "ジム")).toBe("similar");
  });

  describe("時間帯フィルタ", () => {
    test("同じタイトル × 同じ start → exact", () => {
      expect(
        evaluateEntryMatch("デボーション", "08:00", "08:30", "デボーション", { start: "08:00" }),
      ).toBe("exact");
    });

    test("同じタイトル × 異なる start → null（朝/夜の区別を許可）", () => {
      expect(
        evaluateEntryMatch("デボーション", "08:00", "08:30", "デボーション", { start: "20:00" }),
      ).toBe(null);
    });

    test("既存に start がない場合は時間帯フィルタを適用しない", () => {
      expect(
        evaluateEntryMatch("デボーション", null, null, "デボーション", { start: "08:00" }),
      ).toBe("exact");
    });

    test("end が異なれば null", () => {
      expect(
        evaluateEntryMatch("デボーション", "08:00", "08:30", "デボーション", { end: "09:00" }),
      ).toBe(null);
    });

    test("options 未指定なら時間帯は無視（タイトルのみで判定）", () => {
      expect(evaluateEntryMatch("デボーション", "08:00", "08:30", "デボーション")).toBe("exact");
    });
  });
});
