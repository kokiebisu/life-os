#!/usr/bin/env bun
/**
 * tidy/apply-safe.ts — scan.ts の Safe findings を適用する
 *
 * - duplicate-dir: 重複ディレクトリを削除（中身は canonical 側に残る）
 * - dead-path (.claude/rules/ → .ai/rules/): 既知マッピングで参照を置換
 *
 * 使い方:
 *   bun run scripts/tidy/apply-safe.ts             # Safe を適用
 *   bun run scripts/tidy/apply-safe.ts --dry-run   # 何をするかだけ表示
 *
 * 終了コード:
 *   0 = 成功（適用ゼロでも 0）
 *   1 = エラー
 */

import { rmSync, readFileSync, writeFileSync } from "fs";
import { join, resolve } from "path";
import { scan, type Finding } from "./scan.ts";

const REPO_ROOT = resolve(import.meta.dir, "..", "..");

function applyDuplicateDir(
  finding: Extract<Finding, { kind: "duplicate-dir" }>,
  repoRoot: string,
  dryRun: boolean
): string {
  const target = join(repoRoot, finding.duplicate);
  if (dryRun) {
    return `[dry-run] would delete ${finding.duplicate}/ (${finding.files.length} files identical to ${finding.canonical}/)`;
  }
  rmSync(target, { recursive: true, force: true });
  return `deleted ${finding.duplicate}/ (${finding.files.length} files identical to ${finding.canonical}/)`;
}

function applyDeadPath(
  finding: Extract<Finding, { kind: "dead-path" }>,
  repoRoot: string,
  dryRun: boolean
): string {
  // Only the .claude/rules/ → .ai/rules/ mapping is auto-applied.
  if (!finding.reference.startsWith(".claude/rules/")) {
    return `[skip] no auto-fix mapping for ${finding.reference}`;
  }
  const replacement = finding.reference.replace(
    /^\.claude\/rules\//,
    ".ai/rules/"
  );

  const filePath = join(repoRoot, finding.source);
  if (dryRun) {
    return `[dry-run] would replace \`${finding.reference}\` → \`${replacement}\` in ${finding.source}`;
  }

  const content = readFileSync(filePath, "utf8");
  if (!content.includes(finding.reference)) {
    return `[skip] reference not found in ${finding.source} (already fixed?)`;
  }
  // Replace only the first occurrence on the reported line. Use split/join
  // to avoid regex escape headaches.
  const updated = content.split(finding.reference).join(replacement);
  writeFileSync(filePath, updated);
  return `replaced \`${finding.reference}\` → \`${replacement}\` in ${finding.source}`;
}

function main() {
  const dryRun = process.argv.includes("--dry-run");
  const result = scan(REPO_ROOT);

  if (result.safe.length === 0) {
    console.log("No Safe findings. Nothing to apply.");
    return;
  }

  console.log(
    `Applying ${result.safe.length} Safe finding(s)${dryRun ? " (dry-run)" : ""}:`
  );
  for (const f of result.safe) {
    let msg: string;
    if (f.kind === "duplicate-dir") {
      msg = applyDuplicateDir(f, REPO_ROOT, dryRun);
    } else {
      msg = applyDeadPath(f, REPO_ROOT, dryRun);
    }
    console.log(`  - ${msg}`);
  }
}

if (import.meta.main) {
  main();
}
