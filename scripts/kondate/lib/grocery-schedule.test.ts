import { describe, test, expect } from "bun:test";
import { decideGroceryDateTime, formatGroceryTitle } from "./grocery-schedule";

describe("decideGroceryDateTime", () => {
  test("first cooking date in the future → schedules day before at 18:00", () => {
    const r = decideGroceryDateTime("2026-05-02", "2026-04-30");
    expect(r.date).toBe("2026-05-01");
    expect(r.start).toBe("18:00");
    expect(r.end).toBe("19:00");
  });

  test("first cooking date is today → falls back to first cooking date 10:00", () => {
    const r = decideGroceryDateTime("2026-04-30", "2026-04-30");
    expect(r.date).toBe("2026-04-30");
    expect(r.start).toBe("10:00");
    expect(r.end).toBe("11:00");
  });

  test("day-before equals today → uses day-before 18:00 (still future)", () => {
    const r = decideGroceryDateTime("2026-05-01", "2026-04-30");
    expect(r.date).toBe("2026-04-30");
    expect(r.start).toBe("18:00");
  });
});

describe("formatGroceryTitle", () => {
  test("formats as 買い出し M/DD", () => {
    expect(formatGroceryTitle("2026-05-02")).toBe("買い出し 5/2");
    expect(formatGroceryTitle("2026-12-31")).toBe("買い出し 12/31");
  });
});
