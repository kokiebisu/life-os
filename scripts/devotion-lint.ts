#!/usr/bin/env bun
/**
 * devotion-lint.ts — Devotion フォーマット検証
 *
 * Usage:
 *   bun run scripts/devotion-lint.ts                    # 全ファイル検証
 *   bun run scripts/devotion-lint.ts 2026-02-16.md      # 特定ファイル
 */

import { readdirSync, readFileSync } from "fs";
import { join } from "path";
import { parseArgs } from "./lib/notion";

const DEVOTIONS_DIR = join(import.meta.dir, "../aspects/devotions");

export interface LintResult {
  file: string;
  issues: string[];
}

/**
 * Pure devotion-lint logic. Validates a devotion markdown body against the
 * canonical structure (frontmatter, section headings, SOAP parts).
 * Prayer is handled separately by the /pray skill, so devotion files no longer
 * contain a Closing Prayer section.
 *
 * @param filename Used for reporting; should be a basename like "2026-04-25.md".
 * @param content Full markdown content of the devotion file.
 */
export function lintContent(filename: string, content: string): LintResult {
  const issues: string[] = [];

  // 1. frontmatter check
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (!fmMatch) {
    issues.push("Missing frontmatter (--- block)");
  } else {
    const fm = fmMatch[1];
    if (!/^title:\s*.+/m.test(fm)) {
      issues.push("Missing frontmatter: title");
    }
    if (!/^date:\s*.+/m.test(fm)) {
      issues.push("Missing frontmatter: date");
    }
    // 2. title should be "YYYY-MM-DD Devotion" (singular)
    const titleMatch = fm.match(/^title:\s*(.+)$/m);
    if (titleMatch) {
      const title = titleMatch[1].trim();
      if (/Devotions$/i.test(title)) {
        issues.push(`Title "${title}" should use singular "Devotion" (not "Devotions")`);
      } else if (!/^\d{4}-\d{2}-\d{2} Devotion$/i.test(title)) {
        issues.push(`Title "${title}" should match "YYYY-MM-DD Devotion" format`);
      }
    }
  }

  // 3. ## 章の概要
  if (!/^## 章の概要/m.test(content)) {
    issues.push('Missing: ## 章の概要');
  }

  // 4. ## Key Verses (plural)
  const hasKeyVerses = /^## Key Verses\s*$/m.test(content);
  const hasKeyVerse = /^## Key Verse\s*$/m.test(content);
  if (!hasKeyVerses && !hasKeyVerse) {
    issues.push('Missing: ## Key Verses');
  } else if (hasKeyVerse && !hasKeyVerses) {
    issues.push('"Key Verse" should be "Key Verses" (plural)');
  }

  // 5. ## SOAP with S/O/A/P
  const soapHeading = /^## SOAP/m.test(content);
  if (!soapHeading) {
    // Check if SOAP exists but nested (e.g., ### SOAP)
    if (/^###+ SOAP/m.test(content)) {
      issues.push("SOAP not at top level (found nested under ###)");
    } else {
      issues.push("Missing: ## SOAP");
    }
  } else {
    const soapParts = ["S（Scripture）", "O（Observation）", "A（Application）", "P（Prayer）"];
    for (const part of soapParts) {
      if (!content.includes(part)) {
        issues.push(`SOAP missing: ${part}`);
      }
    }
  }

  // 6. ## 実践ガイド
  if (!/^## 実践ガイド/m.test(content)) {
    issues.push('Missing: ## 実践ガイド');
  }

  // 7. ## 持ち帰り
  if (!/^## 持ち帰り/m.test(content)) {
    issues.push('Missing: ## 持ち帰り');
  }

  return { file: filename, issues };
}

function lint(filename: string): LintResult {
  const filepath = join(DEVOTIONS_DIR, filename);
  const content = readFileSync(filepath, "utf-8");
  return lintContent(filename, content);
}

function main() {
  const { positional } = parseArgs();

  let files: string[];
  if (positional.length > 0) {
    files = positional.map((f) => f.replace(/.*\//, "")); // strip path prefix
  } else {
    files = readdirSync(DEVOTIONS_DIR)
      .filter((f) => /^2\d{3}-\d{2}-\d{2}\.md$/.test(f))
      .sort();
  }

  if (files.length === 0) {
    console.log("No devotion files found.");
    process.exit(0);
  }

  let hasErrors = false;

  for (const file of files) {
    const result = lint(file);
    if (result.issues.length === 0) {
      console.log(`✓ ${result.file} — OK`);
    } else {
      hasErrors = true;
      console.log(`✗ ${result.file} — ${result.issues.length} issue(s):`);
      for (const issue of result.issues) {
        console.log(`  - ${issue}`);
      }
    }
  }

  process.exit(hasErrors ? 1 : 0);
}

if (import.meta.main) {
  main();
}
