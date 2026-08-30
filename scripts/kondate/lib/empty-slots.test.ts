import { describe, test, expect } from "bun:test";
import { computeEmptySlots, type Slot, type ExistingEntry } from "./empty-slots";

describe("computeEmptySlots", () => {
  test("returns 9 slots across 3 days when no existing entries", () => {
    const slots = computeEmptySlots("2026-04-24", 3, []);
    expect(slots).toHaveLength(9);
    expect(slots[0]).toEqual({
      date: "2026-04-24",
      mealType: "朝",
      start: "08:00",
      end: "09:00",
    });
    expect(slots[1]).toEqual({
      date: "2026-04-24",
      mealType: "昼",
      start: "12:00",
      end: "13:00",
    });
    expect(slots[2]).toEqual({
      date: "2026-04-24",
      mealType: "晩",
      start: "19:00",
      end: "20:00",
    });
    expect(slots[8].date).toBe("2026-04-26");
  });

  test("excludes slot occupied by existing entry at 08:30 (breakfast window)", () => {
    const existing: ExistingEntry[] = [{ date: "2026-04-24", startTime: "08:30" }];
    const slots = computeEmptySlots("2026-04-24", 3, existing);
    expect(slots).toHaveLength(8);
    expect(slots[0]).toEqual({
      date: "2026-04-24",
      mealType: "昼",
      start: "12:00",
      end: "13:00",
    });
  });

  test("excludes slot occupied at 13:30 (lunch window)", () => {
    const existing: ExistingEntry[] = [{ date: "2026-04-24", startTime: "13:30" }];
    const slots = computeEmptySlots("2026-04-24", 3, existing);
    expect(slots.find((s) => s.date === "2026-04-24" && s.mealType === "昼")).toBeUndefined();
  });

  test("excludes slot at 19:30 (dinner window)", () => {
    const existing: ExistingEntry[] = [{ date: "2026-04-25", startTime: "19:30" }];
    const slots = computeEmptySlots("2026-04-24", 3, existing);
    expect(slots.find((s) => s.date === "2026-04-25" && s.mealType === "晩")).toBeUndefined();
  });

  test("handles multiple existing entries across days", () => {
    const existing: ExistingEntry[] = [
      { date: "2026-04-24", startTime: "08:30" },
      { date: "2026-04-24", startTime: "12:30" },
    ];
    const slots = computeEmptySlots("2026-04-24", 3, existing);
    expect(slots).toHaveLength(7);
    expect(slots[0]).toEqual({
      date: "2026-04-24",
      mealType: "晩",
      start: "19:00",
      end: "20:00",
    });
  });

  test("picks first N slots via take(n)", () => {
    const slots = computeEmptySlots("2026-04-24", 3, []);
    const first3 = slots.slice(0, 3);
    expect(first3.map((s) => `${s.date} ${s.mealType}`)).toEqual([
      "2026-04-24 朝",
      "2026-04-24 昼",
      "2026-04-24 晩",
    ]);
  });
});
