import { describe, test, expect } from "bun:test";
import { ensureJST } from "./notion";

describe("ensureJST", () => {
  test("date-only is returned as-is", () => {
    expect(ensureJST("2026-02-21")).toBe("2026-02-21");
  });

  test("datetime without timezone gets +09:00", () => {
    expect(ensureJST("2026-02-21T10:00:00")).toBe("2026-02-21T10:00:00+09:00");
  });

  test("datetime with +09:00 is returned as-is", () => {
    expect(ensureJST("2026-02-21T10:00:00+09:00")).toBe("2026-02-21T10:00:00+09:00");
  });

  test("datetime with Z is returned as-is", () => {
    expect(ensureJST("2026-02-21T10:00:00Z")).toBe("2026-02-21T10:00:00Z");
  });

  test("datetime with other offset is returned as-is", () => {
    expect(ensureJST("2026-02-21T10:00:00-05:00")).toBe("2026-02-21T10:00:00-05:00");
  });
});
