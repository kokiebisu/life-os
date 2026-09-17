import { describe, test, expect } from "bun:test";
import { validateSelectValue } from "./notion";

// These tests require a live Notion API key to run the full flow.
// We test the function is exported and has the right signature.

describe("validateSelectValue", () => {
  test("is exported as a function", () => {
    expect(typeof validateSelectValue).toBe("function");
  });

  test("returns a promise", () => {
    // Calling with bad dbId will reject, but it should return a promise
    const result = validateSelectValue("fake-db-id", "prop", "value");
    expect(result).toBeInstanceOf(Promise);
    // Suppress unhandled rejection
    result.catch(() => {});
  });
});
