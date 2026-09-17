import { describe, test, expect } from "bun:test";
import { pickEmptySlot, type Busy } from "./empty-slot";

describe("pickEmptySlot", () => {
  test("returns 07:00 when day is empty", () => {
    const slot = pickEmptySlot([]);
    expect(slot).toEqual({ start: "07:00", end: "08:30" });
  });

  test("shifts to 07:30 when 07:00 conflicts", () => {
    const busy: Busy[] = [{ start: "06:30", end: "07:30" }];
    expect(pickEmptySlot(busy)).toEqual({ start: "07:30", end: "09:00" });
  });

  test("shifts to 08:30 when 07:00 conflicts (touching boundary)", () => {
    const busy: Busy[] = [{ start: "07:00", end: "08:30" }];
    expect(pickEmptySlot(busy)).toEqual({ start: "08:30", end: "10:00" });
  });

  test("returns null when entire 07:00–12:30 window is occupied", () => {
    const busy: Busy[] = [{ start: "06:00", end: "13:00" }];
    expect(pickEmptySlot(busy)).toBeNull();
  });

  test("ignores busy intervals outside the window", () => {
    const busy: Busy[] = [
      { start: "00:00", end: "06:00" },
      { start: "13:00", end: "23:00" },
    ];
    expect(pickEmptySlot(busy)).toEqual({ start: "07:00", end: "08:30" });
  });

  test("11:00 is the last possible start (ends 12:30)", () => {
    const busy: Busy[] = [{ start: "07:00", end: "11:00" }];
    expect(pickEmptySlot(busy)).toEqual({ start: "11:00", end: "12:30" });
  });

  test("returns null when 11:00 also conflicts", () => {
    const busy: Busy[] = [{ start: "07:00", end: "11:30" }];
    expect(pickEmptySlot(busy)).toBeNull();
  });

  test("touching intervals do not count as overlap (07:00–08:30 next to 08:30–09:00)", () => {
    const busy: Busy[] = [{ start: "08:30", end: "09:00" }];
    expect(pickEmptySlot(busy)).toEqual({ start: "07:00", end: "08:30" });
  });
});
