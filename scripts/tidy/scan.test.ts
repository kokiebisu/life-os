import { test, expect } from "bun:test";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  symlinkSync,
} from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  detectDuplicateDirs,
  detectDeadPathRefs,
  classify,
} from "./scan.ts";

function tempRepo(): string {
  return mkdtempSync(join(tmpdir(), "tidy-scan-"));
}

test("detectDuplicateDirs finds byte-identical .claude/rules duplicate", () => {
  const root = tempRepo();
  try {
    mkdirSync(join(root, ".ai/rules"), { recursive: true });
    mkdirSync(join(root, ".claude/rules"), { recursive: true });
    writeFileSync(join(root, ".ai/rules/foo.md"), "hello\n");
    writeFileSync(join(root, ".claude/rules/foo.md"), "hello\n");

    const findings = detectDuplicateDirs(root);
    expect(findings).toHaveLength(1);
    expect(findings[0].kind).toBe("duplicate-dir");
    if (findings[0].kind === "duplicate-dir") {
      expect(findings[0].duplicate).toBe(".claude/rules");
      expect(findings[0].files).toEqual(["foo.md"]);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("detectDuplicateDirs returns empty when content differs", () => {
  const root = tempRepo();
  try {
    mkdirSync(join(root, ".ai/rules"), { recursive: true });
    mkdirSync(join(root, ".claude/rules"), { recursive: true });
    writeFileSync(join(root, ".ai/rules/foo.md"), "hello\n");
    writeFileSync(join(root, ".claude/rules/foo.md"), "different\n");

    expect(detectDuplicateDirs(root)).toHaveLength(0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("detectDuplicateDirs ignores symlinks (intentional pass-through)", () => {
  const root = tempRepo();
  try {
    mkdirSync(join(root, ".ai/rules"), { recursive: true });
    mkdirSync(join(root, ".claude/rules"), { recursive: true });
    writeFileSync(join(root, ".ai/rules/foo.md"), "hello\n");
    symlinkSync(
      "../../.ai/rules/foo.md",
      join(root, ".claude/rules/foo.md")
    );

    // Symlinks are not "isFile" so listMdFiles skips them, meaning no
    // byte-identical duplicate is detected. This protects intentional
    // symlink-based pass-throughs from being flagged for deletion.
    expect(detectDuplicateDirs(root)).toHaveLength(0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("detectDuplicateDirs returns empty when duplicate dir does not exist", () => {
  const root = tempRepo();
  try {
    mkdirSync(join(root, ".ai/rules"), { recursive: true });
    writeFileSync(join(root, ".ai/rules/foo.md"), "hello\n");

    expect(detectDuplicateDirs(root)).toHaveLength(0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("detectDeadPathRefs flags reference to non-existent .claude/rules path", () => {
  const root = tempRepo();
  try {
    mkdirSync(join(root, ".ai/rules"), { recursive: true });
    writeFileSync(join(root, ".ai/rules/foo.md"), "hello\n");
    mkdirSync(join(root, "skills/learn"), { recursive: true });
    writeFileSync(
      join(root, "skills/learn/SKILL.md"),
      "see `.claude/rules/missing.md` for details\n"
    );

    const findings = detectDeadPathRefs(root);
    const refs = findings.map((f) => f.reference);
    expect(refs).toContain(".claude/rules/missing.md");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("detectDeadPathRefs ignores existing paths", () => {
  const root = tempRepo();
  try {
    mkdirSync(join(root, ".ai/rules"), { recursive: true });
    writeFileSync(join(root, ".ai/rules/git-workflow.md"), "x\n");
    mkdirSync(join(root, "skills/foo"), { recursive: true });
    writeFileSync(
      join(root, "skills/foo/SKILL.md"),
      "see `.ai/rules/git-workflow.md`\n"
    );

    const findings = detectDeadPathRefs(root);
    expect(findings).toHaveLength(0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("classify routes .claude/rules dead-path refs to safe (known mapping)", () => {
  const result = classify([
    {
      kind: "dead-path",
      source: "skills/x/SKILL.md",
      line: 1,
      reference: ".claude/rules/foo.md",
    },
  ]);
  expect(result.safe).toHaveLength(1);
  expect(result.risky).toHaveLength(0);
});

test("classify routes unknown dead-path refs to risky", () => {
  const result = classify([
    {
      kind: "dead-path",
      source: "skills/x/SKILL.md",
      line: 1,
      reference: "aspects/removed/foo.md",
    },
  ]);
  expect(result.risky).toHaveLength(1);
  expect(result.safe).toHaveLength(0);
});

test("classify always routes duplicate-dir to safe", () => {
  const result = classify([
    {
      kind: "duplicate-dir",
      canonical: ".ai/rules",
      duplicate: ".claude/rules",
      files: ["foo.md"],
    },
  ]);
  expect(result.safe).toHaveLength(1);
  expect(result.risky).toHaveLength(0);
});
