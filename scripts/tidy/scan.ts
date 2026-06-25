#!/usr/bin/env bun
/**
 * tidy/scan.ts — 指示ファイル群の重複・dead path 参照を検出して JSON で出力
 *
 * 検出範囲:
 *   - byte-identical な重複ディレクトリ（regular file 同士が同一バイト列）
 *     symlink は意図的な pass-through とみなしてスキップする
 *   - dead path 参照（指示ファイル内のパスで、実在しないもの）
 *     対象: CLAUDE.md, AGENTS.md, .ai/rules/, .claude/rules/, aspects/**\/CLAUDE.md, skills/**\/SKILL.md
 *
 * 使い方:
 *   bun run scripts/tidy/scan.ts                # JSON を stdout に出力
 *   bun run scripts/tidy/scan.ts --pretty       # 人間向け表示
 */

import { readdirSync, readFileSync, statSync, existsSync } from "fs";
import { join, relative, resolve } from "path";

export type DuplicateDirFinding = {
  kind: "duplicate-dir";
  canonical: string;
  duplicate: string;
  files: string[];
};

export type DeadPathFinding = {
  kind: "dead-path";
  source: string;
  line: number;
  reference: string;
};

export type Finding = DuplicateDirFinding | DeadPathFinding;

export type ScanResult = {
  safe: Finding[];
  risky: Finding[];
};

const REPO_ROOT = resolve(import.meta.dir, "..", "..");

// Placeholder tokens that indicate a path is a template, not a real reference.
const PLACEHOLDER_TOKENS = [
  "YYYY",
  "MM-DD",
  "DD.md",
  "XXX",
  "DATE",
  "NAME",
  "BRANCH",
  "<",
  ">",
  "xxx",
];

// canonical → list of suspected duplicates
const DUPLICATE_DIR_PAIRS: Array<{ canonical: string; duplicate: string }> = [
  { canonical: ".ai/rules", duplicate: ".claude/rules" },
];

function listMdFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const entries = readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const e of entries) {
    if (e.isFile() && e.name.endsWith(".md")) {
      files.push(e.name);
    }
  }
  return files.sort();
}

export function detectDuplicateDirs(repoRoot: string): DuplicateDirFinding[] {
  const findings: DuplicateDirFinding[] = [];

  for (const { canonical, duplicate } of DUPLICATE_DIR_PAIRS) {
    const canonAbs = join(repoRoot, canonical);
    const dupAbs = join(repoRoot, duplicate);

    if (!existsSync(canonAbs) || !existsSync(dupAbs)) continue;
    if (!statSync(canonAbs).isDirectory() || !statSync(dupAbs).isDirectory())
      continue;

    const canonFiles = listMdFiles(canonAbs);
    const dupFiles = listMdFiles(dupAbs);

    // Every file in dupFiles must exist in canonFiles AND be byte-identical
    const identicalFiles: string[] = [];
    let allIdentical = dupFiles.length > 0;

    for (const f of dupFiles) {
      if (!canonFiles.includes(f)) {
        allIdentical = false;
        break;
      }
      const a = readFileSync(join(canonAbs, f));
      const b = readFileSync(join(dupAbs, f));
      if (a.equals(b)) {
        identicalFiles.push(f);
      } else {
        allIdentical = false;
        break;
      }
    }

    if (allIdentical && identicalFiles.length === dupFiles.length) {
      findings.push({
        kind: "duplicate-dir",
        canonical,
        duplicate,
        files: identicalFiles,
      });
    }
  }

  return findings;
}

/**
 * Collect instruction files only. We deliberately skip script files because
 * their internal references (e.g., header comments documenting a moved file's
 * old path) are not the kind of drift /tidy is meant to catch.
 */
function collectInstructionFiles(repoRoot: string): string[] {
  const files: string[] = [];
  const tryPush = (rel: string) => {
    const abs = join(repoRoot, rel);
    if (existsSync(abs) && statSync(abs).isFile()) files.push(abs);
  };

  tryPush("CLAUDE.md");
  tryPush("AGENTS.md");

  // .ai/rules/*.md and .claude/rules/*.md (latter only if present)
  for (const dir of [".ai/rules", ".claude/rules"]) {
    const abs = join(repoRoot, dir);
    if (!existsSync(abs)) continue;
    for (const f of listMdFiles(abs)) tryPush(`${dir}/${f}`);
  }

  // aspects/**/CLAUDE.md and skills/**/SKILL.md (recursive)
  const recurseFor = (root: string, target: string) => {
    const rootAbs = join(repoRoot, root);
    if (!existsSync(rootAbs)) return;
    const stack: string[] = [rootAbs];
    while (stack.length > 0) {
      const cur = stack.pop()!;
      const entries = readdirSync(cur, { withFileTypes: true });
      for (const e of entries) {
        if (e.name === "node_modules" || e.name.startsWith(".")) continue;
        const full = join(cur, e.name);
        if (e.isDirectory()) {
          stack.push(full);
        } else if (e.isFile() && e.name === target) {
          files.push(full);
        }
      }
    }
  };
  recurseFor("aspects", "CLAUDE.md");
  recurseFor("skills", "SKILL.md");

  return files;
}

function isPlaceholder(ref: string): boolean {
  return PLACEHOLDER_TOKENS.some((t) => ref.includes(t));
}

// Match path-like strings inside backticks, quotes, brackets, or bare in text.
// We only check repo-relative paths starting with `.ai/`, `.claude/`, `aspects/`, `scripts/`, `skills/`.
const PATH_RE =
  /(?<![A-Za-z0-9_/])(\.ai\/[A-Za-z0-9_./-]+|\.claude\/[A-Za-z0-9_./-]+|aspects\/[A-Za-z0-9_./-]+|skills\/[A-Za-z0-9_./-]+|scripts\/[A-Za-z0-9_./-]+)/g;

function isLikelyRealPath(ref: string): boolean {
  // Strip trailing punctuation and glob characters before existence check
  const cleaned = ref
    .replace(/[)\]>,.;:]+$/, "")
    .replace(/\/\*\*?\/?$/, "")
    .replace(/\/\*[^/]*$/, "");
  return cleaned.length > 0;
}

export function detectDeadPathRefs(repoRoot: string): DeadPathFinding[] {
  const findings: DeadPathFinding[] = [];
  const files = collectInstructionFiles(repoRoot);

  for (const file of files) {
    const rel = relative(repoRoot, file);

    let content: string;
    try {
      content = readFileSync(file, "utf8");
    } catch {
      continue;
    }

    const lines = content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      let match: RegExpExecArray | null;
      const re = new RegExp(PATH_RE.source, "g");
      while ((match = re.exec(line)) !== null) {
        const ref = match[1];
        if (!isLikelyRealPath(ref)) continue;
        if (isPlaceholder(ref)) continue;

        const cleaned = ref.replace(/[)\]>,.;:]+$/, "");
        // Strip trailing /* or /** glob suffixes for existence check
        const checkPath = cleaned
          .replace(/\/\*\*?$/, "")
          .replace(/\/\*[^/]*$/, "");

        const abs = join(repoRoot, checkPath);
        if (existsSync(abs)) continue;

        // Tolerate wildcards we couldn't strip
        if (checkPath.includes("*")) continue;

        findings.push({
          kind: "dead-path",
          source: rel,
          line: i + 1,
          reference: cleaned,
        });
      }
    }
  }

  return findings;
}

export function classify(findings: Finding[]): ScanResult {
  const safe: Finding[] = [];
  const risky: Finding[] = [];
  for (const f of findings) {
    if (f.kind === "duplicate-dir") {
      // Byte-identical dup → safe to delete the duplicate
      safe.push(f);
    } else if (f.kind === "dead-path") {
      // Dead-path refs are reported as risky by default — fixing them needs
      // judgment about the correct replacement. apply-safe handles only the
      // well-known mapping (.claude/rules/ → .ai/rules/).
      const isKnownMapping = f.reference.startsWith(".claude/rules/");
      if (isKnownMapping) {
        safe.push(f);
      } else {
        risky.push(f);
      }
    }
  }
  return { safe, risky };
}

export function scan(repoRoot: string = REPO_ROOT): ScanResult {
  const findings: Finding[] = [
    ...detectDuplicateDirs(repoRoot),
    ...detectDeadPathRefs(repoRoot),
  ];
  return classify(findings);
}

function formatPretty(result: ScanResult): string {
  const lines: string[] = [];
  lines.push(`# Tidy Scan Report`);
  lines.push("");
  lines.push(`**Safe (auto-apply):** ${result.safe.length}`);
  lines.push(`**Risky (report only):** ${result.risky.length}`);
  lines.push("");

  if (result.safe.length > 0) {
    lines.push(`## Safe`);
    for (const f of result.safe) {
      if (f.kind === "duplicate-dir") {
        lines.push(
          `- **duplicate-dir** \`${f.duplicate}\` is byte-identical to \`${f.canonical}\` (${f.files.length} files)`
        );
      } else {
        lines.push(
          `- **dead-path** \`${f.source}:${f.line}\` → \`${f.reference}\` (known mapping)`
        );
      }
    }
    lines.push("");
  }

  if (result.risky.length > 0) {
    lines.push(`## Risky`);
    for (const f of result.risky) {
      if (f.kind === "dead-path") {
        lines.push(
          `- **dead-path** \`${f.source}:${f.line}\` → \`${f.reference}\` (no known correct path)`
        );
      }
    }
    lines.push("");
  }

  return lines.join("\n");
}

if (import.meta.main) {
  const pretty = process.argv.includes("--pretty");
  const result = scan();
  if (pretty) {
    console.log(formatPretty(result));
  } else {
    console.log(JSON.stringify(result, null, 2));
  }
}
