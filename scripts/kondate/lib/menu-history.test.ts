import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { readHistory, appendHistoryEntry, type HistoryEntry } from "./menu-history";

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "kondate-hist-"));
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe("readHistory", () => {
  test("returns empty array when file has only header", () => {
    const path = join(tmp, "history.md");
    writeFileSync(path, "# 自動生成メニュー履歴\n\n> 説明\n\n");
    expect(readHistory(path)).toEqual([]);
  });

  test("parses single entry", () => {
    const path = join(tmp, "history.md");
    writeFileSync(
      path,
      "# 自動生成メニュー履歴\n\n## 2026-04-24\n- [鶏むねハム](https://notion.so/abc)（和）\n",
    );
    expect(readHistory(path)).toEqual([
      { date: "2026-04-24", menu: "鶏むねハム", url: "https://notion.so/abc", cuisine: "和" },
    ]);
  });

  test("parses multiple entries across dates", () => {
    const path = join(tmp, "history.md");
    writeFileSync(
      path,
      "# 自動生成メニュー履歴\n\n## 2026-04-24\n- [豚生姜焼き](https://notion.so/b)（和）\n\n## 2026-04-21\n- [鶏むねハム](https://notion.so/a)（和）\n",
    );
    const entries = readHistory(path);
    expect(entries).toHaveLength(2);
    expect(entries[0].date).toBe("2026-04-24");
    expect(entries[1].date).toBe("2026-04-21");
  });

  test("returns empty when file does not exist", () => {
    expect(readHistory(join(tmp, "missing.md"))).toEqual([]);
  });
});

describe("appendHistoryEntry", () => {
  test("inserts new date section at top below header", () => {
    const path = join(tmp, "history.md");
    writeFileSync(path, "# 自動生成メニュー履歴\n\n> 説明\n\n");
    const entry: HistoryEntry = {
      date: "2026-04-24",
      menu: "鮭の塩焼き",
      url: "https://notion.so/xyz",
      cuisine: "和",
    };
    appendHistoryEntry(path, entry);
    const content = readFileSync(path, "utf-8");
    expect(content).toContain("## 2026-04-24");
    expect(content).toContain("- [鮭の塩焼き](https://notion.so/xyz)（和）");
  });

  test("prepends entry above existing dates", () => {
    const path = join(tmp, "history.md");
    writeFileSync(
      path,
      "# 自動生成メニュー履歴\n\n## 2026-04-21\n- [鶏むねハム](https://notion.so/a)（和）\n",
    );
    appendHistoryEntry(path, {
      date: "2026-04-24",
      menu: "豚生姜焼き",
      url: "https://notion.so/b",
      cuisine: "和",
    });
    const entries = readHistory(path);
    expect(entries[0].date).toBe("2026-04-24");
    expect(entries[1].date).toBe("2026-04-21");
  });
});
