#!/usr/bin/env bun
/**
 * ルール構造化抽出スクリプト
 *
 * 使い方:
 *   bun run scripts/analyze-rules.ts
 *
 * .ai/rules/[*].md, CLAUDE.md, skills/[*]/SKILL.md を読み込み、
 * 個別ルールに分解して JSON を stdout に出力する。
 */

import { Glob } from "bun";
import { splitMarkdownIntoRules, findExistingScripts, type ExtractedRule } from "./lib/rule-parser";

const TARGET_PATTERNS = [
  ".ai/rules/*.md",
  "CLAUDE.md",
  "skills/*/SKILL.md",
];

async function collectFiles(): Promise<string[]> {
  const files: string[] = [];
  for (const pattern of TARGET_PATTERNS) {
    const glob = new Glob(pattern);
    for await (const file of glob.scan({ cwd: process.cwd(), dot: true })) {
      files.push(file);
    }
  }
  return files.sort();
}

async function main() {
  const [targetFiles, existingScripts] = await Promise.all([
    collectFiles(),
    findExistingScripts(),
  ]);

  const allRules: ExtractedRule[] = [];
  const errors: string[] = [];

  for (const file of targetFiles) {
    try {
      const content = await Bun.file(file).text();
      const rules = splitMarkdownIntoRules(content, file);

      // Mark which referenced scripts actually exist
      for (const rule of rules) {
        rule.relatedScripts = rule.relatedScripts.filter(s => existingScripts.includes(s));
      }

      allRules.push(...rules);
    } catch (e) {
      const msg = `Warning: failed to read ${file}: ${e instanceof Error ? e.message : String(e)}`;
      errors.push(msg);
      console.error(msg);
    }
  }

  const output = {
    scannedFiles: targetFiles.length,
    totalRules: allRules.length,
    rules: allRules,
  };

  console.log(JSON.stringify(output, null, 2));
}

main();
