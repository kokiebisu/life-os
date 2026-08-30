import { describe, test, expect } from "bun:test";
import { parseArgs, shouldFallback } from "./create-pr";

describe("parseArgs", () => {
  test("parses --title", () => {
    const args = parseArgs(["bun", "create-pr.ts", "--title", "feat: foo"]);
    expect(args.title).toBe("feat: foo");
  });

  test("parses --body", () => {
    const args = parseArgs(["bun", "create-pr.ts", "--title", "t", "--body", "some body"]);
    expect(args.body).toBe("some body");
  });

  test("parses --base", () => {
    const args = parseArgs(["bun", "create-pr.ts", "--title", "t", "--base", "develop"]);
    expect(args.base).toBe("develop");
  });

  test("defaults base to main", () => {
    const args = parseArgs(["bun", "create-pr.ts", "--title", "t"]);
    expect(args.base).toBe("main");
  });

  test("parses --head", () => {
    const args = parseArgs(["bun", "create-pr.ts", "--title", "t", "--head", "feat/my-branch"]);
    expect(args.head).toBe("feat/my-branch");
  });

  test("defaults head to empty string (auto-detect at runtime)", () => {
    const args = parseArgs(["bun", "create-pr.ts", "--title", "t"]);
    expect(args.head).toBe("");
  });

  test("defaults body to empty string", () => {
    const args = parseArgs(["bun", "create-pr.ts", "--title", "t"]);
    expect(args.body).toBe("");
  });

  test("parses all args together", () => {
    const args = parseArgs([
      "bun", "create-pr.ts",
      "--title", "feat: bar",
      "--body", "details here",
      "--base", "main",
      "--head", "feat/bar",
    ]);
    expect(args.title).toBe("feat: bar");
    expect(args.body).toBe("details here");
    expect(args.base).toBe("main");
    expect(args.head).toBe("feat/bar");
  });
});

describe("shouldFallback", () => {
  test("returns true when exit code is non-zero and stderr contains 'No commits between'", () => {
    expect(shouldFallback(1, "No commits between main and feat/foo")).toBe(true);
  });

  test("returns false when exit code is 0", () => {
    expect(shouldFallback(0, "No commits between main and feat/foo")).toBe(false);
  });

  test("returns false when stderr does not contain the expected message", () => {
    expect(shouldFallback(1, "some other error occurred")).toBe(false);
  });

  test("returns false when exit code is 0 and stderr is empty", () => {
    expect(shouldFallback(0, "")).toBe(false);
  });

  test("returns true for the exact error phrase in a longer message", () => {
    const stderr =
      "error creating pr: GraphQL: No commits between main and feat/my-feature (createPullRequest)";
    expect(shouldFallback(128, stderr)).toBe(true);
  });
});
