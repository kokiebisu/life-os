import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  extractTime,
  timeToMinutes,
  hasTimeOverlap,
  titlesMatch,
  mergeEntries,
  mergeTaskEntries,
  resolveOverlaps,
  renderFile,
  parseEventFile,
  validateDryRunEntries,
  type MergedEntry,
  type FileEntry,
  type TaskEntry,
} from "./notion-pull";
import type { NormalizedEntry, ScheduleDbName } from "./lib/notion";

// ---- Fixtures ----

function ne(overrides: Partial<NormalizedEntry>): NormalizedEntry {
  return {
    id: "page-id",
    source: "events",
    title: "title",
    start: "2026-04-29T10:00:00+09:00",
    end: "2026-04-29T11:00:00+09:00",
    status: "",
    description: "",
    feedback: "",
    hasIcon: true,
    hasCover: true,
    ...overrides,
  };
}

function fe(overrides: Partial<FileEntry>): FileEntry {
  return {
    done: false,
    startTime: "10:00",
    endTime: "11:00",
    allDay: false,
    title: "title",
    tags: "",
    descLines: [],
    feedbackLine: "",
    ...overrides,
  };
}

function me(overrides: Partial<MergedEntry>): MergedEntry {
  return {
    done: false,
    startTime: "10:00",
    endTime: "11:00",
    allDay: false,
    title: "title",
    tags: "",
    descLines: [],
    feedbackLine: "",
    source: "both",
    notionId: "",
    hasIcon: true,
    hasCover: true,
    dbName: "events" as ScheduleDbName,
    changed: false,
    oldStartTime: "",
    oldEndTime: "",
    oldDone: false,
    oldFeedbackLine: "",
    ...overrides,
  };
}

// ---- Tests ----

describe("extractTime", () => {
  test("empty string returns ''", () => {
    expect(extractTime("")).toBe("");
  });

  test("date-only (no T) returns ''", () => {
    expect(extractTime("2026-04-29")).toBe("");
  });

  test("ISO with +09:00 yields JST HH:MM", () => {
    expect(extractTime("2026-04-29T10:30:00+09:00")).toBe("10:30");
  });

  test("ISO in UTC is converted to JST", () => {
    // 01:00 UTC == 10:00 JST
    expect(extractTime("2026-04-29T01:00:00Z")).toBe("10:00");
  });
});

describe("timeToMinutes", () => {
  test("empty returns 0", () => {
    expect(timeToMinutes("")).toBe(0);
  });

  test("00:00 → 0", () => {
    expect(timeToMinutes("00:00")).toBe(0);
  });

  test("10:30 → 630", () => {
    expect(timeToMinutes("10:30")).toBe(630);
  });

  test("23:59 → 1439", () => {
    expect(timeToMinutes("23:59")).toBe(1439);
  });
});

describe("hasTimeOverlap", () => {
  test("allDay either side → no overlap", () => {
    expect(hasTimeOverlap(me({ allDay: true }), me({}))).toBe(false);
    expect(hasTimeOverlap(me({}), me({ allDay: true }))).toBe(false);
  });

  test("missing times → no overlap", () => {
    expect(hasTimeOverlap(me({ startTime: "" }), me({}))).toBe(false);
    expect(hasTimeOverlap(me({}), me({ endTime: "" }))).toBe(false);
  });

  test("touching boundaries (10:00-11:00 vs 11:00-12:00) → no overlap", () => {
    const a = me({ startTime: "10:00", endTime: "11:00" });
    const b = me({ startTime: "11:00", endTime: "12:00" });
    expect(hasTimeOverlap(a, b)).toBe(false);
  });

  test("clear overlap (10:00-12:00 vs 11:00-13:00) → true", () => {
    const a = me({ startTime: "10:00", endTime: "12:00" });
    const b = me({ startTime: "11:00", endTime: "13:00" });
    expect(hasTimeOverlap(a, b)).toBe(true);
  });

  test("contained (10:00-13:00 vs 11:00-12:00) → true", () => {
    const a = me({ startTime: "10:00", endTime: "13:00" });
    const b = me({ startTime: "11:00", endTime: "12:00" });
    expect(hasTimeOverlap(a, b)).toBe(true);
  });
});

describe("titlesMatch", () => {
  test("identical titles match", () => {
    expect(titlesMatch("勉強", "勉強")).toBe(true);
  });

  test("one contains other matches", () => {
    expect(titlesMatch("勉強", "勉強（読書）")).toBe(true);
  });

  test("unrelated titles do not match", () => {
    expect(titlesMatch("ジム", "勉強")).toBe(false);
  });

  test("meal prefix variants with same content match (朝食 vs 昼食)", () => {
    expect(titlesMatch("朝食（卵焼き）", "昼食（卵焼き）")).toBe(true);
  });

  test("meal prefix variants with different content do not match", () => {
    expect(titlesMatch("朝食（卵焼き）", "昼食（味噌汁）")).toBe(false);
  });

  test("only one side has meal prefix → falls through (no match unless contained)", () => {
    expect(titlesMatch("朝食（卵焼き）", "ジム")).toBe(false);
  });
});

describe("mergeEntries", () => {
  test("Notion-only entry produces ADD", () => {
    const result = mergeEntries(
      [ne({ id: "p1", title: "新規", start: "2026-04-29T10:00:00+09:00", end: "2026-04-29T11:00:00+09:00" })],
      [],
      "events",
    );
    expect(result.added).toBe(1);
    expect(result.updated).toBe(0);
    expect(result.kept).toBe(0);
    expect(result.merged).toHaveLength(1);
    expect(result.merged[0].source).toBe("notion");
    expect(result.merged[0].title).toBe("新規");
    expect(result.merged[0].notionId).toBe("p1");
  });

  test("matched entry with same time/status → KEEP (kept++)", () => {
    const result = mergeEntries(
      [ne({ title: "ジム", start: "2026-04-29T10:00:00+09:00", end: "2026-04-29T11:00:00+09:00" })],
      [fe({ title: "ジム", startTime: "10:00", endTime: "11:00" })],
      "events",
    );
    expect(result.kept).toBe(1);
    expect(result.added).toBe(0);
    expect(result.updated).toBe(0);
    // Note: `changed` is declared `boolean` but the source uses `&& ne.feedback && ...`
    // so when ne.feedback is "", the result is the empty string. Lock down current
    // behavior; treat as falsy.
    expect(result.merged[0].changed).toBeFalsy();
  });

  test("matched entry with different time → UPDATE (updated++ and changed=true)", () => {
    const result = mergeEntries(
      [ne({ title: "ジム", start: "2026-04-29T11:00:00+09:00", end: "2026-04-29T12:00:00+09:00" })],
      [fe({ title: "ジム", startTime: "10:00", endTime: "11:00" })],
      "events",
    );
    expect(result.updated).toBe(1);
    expect(result.merged[0].changed).toBe(true);
    expect(result.merged[0].startTime).toBe("11:00");
    expect(result.merged[0].endTime).toBe("12:00");
    expect(result.merged[0].oldStartTime).toBe("10:00");
    expect(result.merged[0].oldEndTime).toBe("11:00");
  });

  test("matched entry: Notion done → file done is overridden, updated++", () => {
    const result = mergeEntries(
      [ne({ title: "X", status: "Done" })],
      [fe({ title: "X", done: false })],
      "events",
    );
    expect(result.merged[0].done).toBe(true);
    expect(result.updated).toBe(1);
  });

  test("matched entry preserves file tags / descLines", () => {
    const result = mergeEntries(
      [ne({ title: "X" })],
      [fe({ title: "X", tags: " #todo", descLines: ["sub"] })],
      "events",
    );
    expect(result.merged[0].tags).toBe(" #todo");
    expect(result.merged[0].descLines).toEqual(["sub"]);
  });

  test("file-only timed entry with non-empty Notion → DROP", () => {
    const result = mergeEntries(
      [ne({ title: "別件", start: "2026-04-29T10:00:00+09:00", end: "2026-04-29T11:00:00+09:00" })],
      [fe({ title: "未対応" })],
      "events",
    );
    expect(result.dropped).toContain("未対応");
    expect(result.merged.find((m) => m.title === "未対応")).toBeUndefined();
  });

  test("file-only entries are KEPT when Notion is empty (offline safety)", () => {
    const result = mergeEntries([], [fe({ title: "ローカル" })], "events");
    // Note: when Notion is empty, the source has two passes both pushing the same
    // file entry — the first conditional block does not add to `used`, so the
    // second loop also pushes via the all-day/no-Notion branch. Lock down current
    // behavior; the offline-safety path duplicates entries.
    expect(result.kept).toBe(2);
    expect(result.merged).toHaveLength(2);
    expect(result.merged.every((m) => m.source === "file")).toBe(true);
  });

  test("file-only allDay entry is kept even when Notion has timed entries", () => {
    const result = mergeEntries(
      [ne({ title: "別件" })],
      [fe({ title: "誕生日", allDay: true, startTime: "", endTime: "" })],
      "events",
    );
    expect(result.merged.some((m) => m.title === "誕生日")).toBe(true);
  });

  test("Notion feedback overrides file feedback when present", () => {
    const result = mergeEntries(
      [ne({ title: "X", feedback: "from-notion" })],
      [fe({ title: "X", feedbackLine: "from-file" })],
      "events",
    );
    expect(result.merged[0].feedbackLine).toBe("from-notion");
    expect(result.updated).toBe(1);
  });
});

describe("mergeTaskEntries", () => {
  function te(overrides: Partial<TaskEntry>): TaskEntry {
    return { done: false, title: "task", rawLine: "- [ ] task", ...overrides };
  }

  test("Notion-only task → newEntries (added)", () => {
    const result = mergeTaskEntries(
      [ne({ id: "p1", title: "新タスク", status: "" })],
      [],
    );
    expect(result.added).toBe(1);
    expect(result.newEntries).toHaveLength(1);
    expect(result.completed).toBe(0);
  });

  test("matched + Notion done → marks file task done (completed++)", () => {
    const result = mergeTaskEntries(
      [ne({ title: "やる", status: "Done" })],
      [te({ title: "やる", done: false })],
    );
    expect(result.completed).toBe(1);
    expect(result.updatedInbox[0].done).toBe(true);
    expect(result.updatedInbox[0].rawLine).toContain("- [x]");
  });

  test("matched + Notion not done → kept", () => {
    const result = mergeTaskEntries(
      [ne({ title: "やる", status: "" })],
      [te({ title: "やる" })],
    );
    expect(result.kept).toBe(1);
    expect(result.completed).toBe(0);
  });

  test("status '完了' (Japanese) is treated as done", () => {
    const result = mergeTaskEntries(
      [ne({ title: "やる", status: "完了" })],
      [te({ title: "やる", done: false })],
    );
    expect(result.completed).toBe(1);
  });
});

describe("resolveOverlaps", () => {
  test("higher-priority DB wins; loser is removed and reported", () => {
    const events = [me({ title: "会議", startTime: "10:00", endTime: "11:00", dbName: "events" })];
    const meals = [me({ title: "昼食", startTime: "10:30", endTime: "11:30", dbName: "meals" })];
    const map = new Map<ScheduleDbName, MergedEntry[]>([
      ["events", events],
      ["meals", meals],
    ]);
    const removals = resolveOverlaps(map);
    expect(removals).toHaveLength(1);
    expect(removals[0].entry.title).toBe("昼食");
    expect(map.get("events")!.length).toBe(1);
    expect(map.get("meals")!.length).toBe(0);
  });

  test("same-DB overlaps are not resolved", () => {
    const map = new Map<ScheduleDbName, MergedEntry[]>([
      [
        "events",
        [
          me({ title: "A", startTime: "10:00", endTime: "11:00", dbName: "events" }),
          me({ title: "B", startTime: "10:30", endTime: "11:30", dbName: "events" }),
        ],
      ],
    ]);
    const removals = resolveOverlaps(map);
    expect(removals).toHaveLength(0);
  });

  test("non-overlapping entries are not removed", () => {
    const map = new Map<ScheduleDbName, MergedEntry[]>([
      ["events", [me({ title: "A", startTime: "10:00", endTime: "11:00", dbName: "events" })]],
      ["meals",  [me({ title: "B", startTime: "12:00", endTime: "13:00", dbName: "meals" })]],
    ]);
    const removals = resolveOverlaps(map);
    expect(removals).toHaveLength(0);
  });
});

describe("renderFile", () => {
  test("entries are sorted by startTime; allDay last", () => {
    const md = renderFile("2026-04-29", [
      me({ title: "夕方", startTime: "18:00", endTime: "19:00" }),
      me({ title: "終日タスク", allDay: true, startTime: "", endTime: "" }),
      me({ title: "朝", startTime: "08:00", endTime: "09:00" }),
    ]);
    const lines = md.split("\n");
    expect(lines[0]).toBe("# 2026-04-29");
    const order = lines.filter((l) => l.startsWith("- ["));
    expect(order[0]).toContain("朝");
    expect(order[1]).toContain("夕方");
    expect(order[2]).toContain("終日タスク");
    expect(order[2]).toContain("終日");
  });

  test("done entries render with [x] checkbox", () => {
    const md = renderFile("2026-04-29", [
      me({ title: "完了", startTime: "10:00", endTime: "11:00", done: true }),
    ]);
    expect(md).toContain("- [x] 10:00-11:00 完了");
  });

  test("descLines are rendered as sub-bullets", () => {
    const md = renderFile("2026-04-29", [
      me({ title: "X", startTime: "10:00", endTime: "11:00", descLines: ["a", "b"] }),
    ]);
    expect(md).toContain("  - a");
    expect(md).toContain("  - b");
  });

  test("feedbackLine renders with 💬 prefix", () => {
    const md = renderFile("2026-04-29", [
      me({ title: "X", startTime: "10:00", endTime: "11:00", feedbackLine: "OK" }),
    ]);
    expect(md).toContain("  - 💬 OK");
  });

  test("tags are appended to the line", () => {
    const md = renderFile("2026-04-29", [
      me({ title: "やる", startTime: "10:00", endTime: "11:00", tags: " #todo" }),
    ]);
    expect(md).toContain("- [ ] 10:00-11:00 やる #todo");
  });
});

describe("parseEventFile", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "notion-pull-test-"));
  });
  afterEach(() => {
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  });

  test("returns [] for missing file", () => {
    expect(parseEventFile(join(dir, "missing.md"))).toEqual([]);
  });

  test("parses basic timed entry", () => {
    const path = join(dir, "f.md");
    writeFileSync(path, "# 2026-04-29\n\n- [ ] 10:00-11:00 ジム\n");
    const result = parseEventFile(path);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      done: false,
      startTime: "10:00",
      endTime: "11:00",
      allDay: false,
      title: "ジム",
    });
  });

  test("parses done entry with [x]", () => {
    const path = join(dir, "f.md");
    writeFileSync(path, "- [x] 10:00-11:00 やった\n");
    const result = parseEventFile(path);
    expect(result[0].done).toBe(true);
  });

  test("parses 終日 (all-day) entry", () => {
    const path = join(dir, "f.md");
    writeFileSync(path, "- [ ] 終日 誕生日\n");
    const result = parseEventFile(path);
    expect(result[0]).toMatchObject({ allDay: true, title: "誕生日", startTime: "", endTime: "" });
  });

  test("extracts tags and sub-bullets", () => {
    const path = join(dir, "f.md");
    writeFileSync(
      path,
      [
        "- [ ] 10:00-11:00 やる #todo #planning",
        "  - 詳細1",
        "  - 詳細2",
        "  - 💬 良かった",
      ].join("\n"),
    );
    const result = parseEventFile(path);
    expect(result[0].title).toBe("やる");
    expect(result[0].tags).toBe(" #todo #planning");
    expect(result[0].descLines).toEqual(["詳細1", "詳細2"]);
    expect(result[0].feedbackLine).toBe("良かった");
  });

  test("pads single-digit hour to 2 digits", () => {
    const path = join(dir, "f.md");
    writeFileSync(path, "- [ ] 9:00-10:00 朝\n");
    const result = parseEventFile(path);
    expect(result[0].startTime).toBe("09:00");
    expect(result[0].endTime).toBe("10:00");
  });

  test("ignores non-matching lines", () => {
    const path = join(dir, "f.md");
    writeFileSync(path, "# header\n\nsome notes\n\n- [ ] 10:00-11:00 X\n");
    const result = parseEventFile(path);
    expect(result).toHaveLength(1);
  });
});

describe("validateDryRunEntries", () => {
  test("normal entries → no anomalies", () => {
    const result = validateDryRunEntries([
      me({ startTime: "10:00", endTime: "11:00" }),
    ]);
    expect(result).toHaveLength(0);
  });

  test("startHour >= 24 is flagged", () => {
    const result = validateDryRunEntries([
      me({ startTime: "26:30", endTime: "27:00" }),
    ]);
    expect(result.length).toBeGreaterThan(0);
    expect(result[0].reason).toContain("24:00以降");
  });

  test("2+ hour earlier shift is flagged for matched entries", () => {
    const result = validateDryRunEntries([
      me({
        source: "both",
        startTime: "07:30",
        endTime: "08:30",
        oldStartTime: "10:00",
        oldEndTime: "11:00",
      }),
    ]);
    expect(result.some((a) => a.reason.includes("前倒し"))).toBe(true);
  });

  test("small shift (<120min) is not flagged", () => {
    const result = validateDryRunEntries([
      me({
        source: "both",
        startTime: "09:30",
        endTime: "10:30",
        oldStartTime: "10:00",
        oldEndTime: "11:00",
      }),
    ]);
    expect(result).toHaveLength(0);
  });

  test("allDay entries are skipped", () => {
    const result = validateDryRunEntries([
      me({ allDay: true, startTime: "", endTime: "" }),
    ]);
    expect(result).toHaveLength(0);
  });
});
