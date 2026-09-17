import { describe, test, expect } from "bun:test";
import { lintContent } from "./devotion-lint";

const VALID_OLD = `---
title: 2026-04-20 Devotion
date: 2026-04-20
---

## 章の概要

something

## Key Verses

verse

## SOAP

### S（Scripture）
text

### O（Observation）
text

### A（Application）
text

### P（Prayer）
text

## 実践ガイド

guide

## 持ち帰り

takeaway
`;

describe("lintContent — happy path", () => {
  test("entry with all required sections is OK", () => {
    const result = lintContent("2026-04-20.md", VALID_OLD);
    expect(result.file).toBe("2026-04-20.md");
    expect(result.issues).toEqual([]);
  });
});

describe("lintContent — frontmatter", () => {
  test("missing frontmatter block is flagged", () => {
    const result = lintContent("2026-04-20.md", "no frontmatter here\n");
    expect(result.issues).toContain("Missing frontmatter (--- block)");
  });

  test("missing title field is flagged", () => {
    const content = VALID_OLD.replace(/^title:.*$/m, "");
    const result = lintContent("2026-04-20.md", content);
    expect(result.issues).toContain("Missing frontmatter: title");
  });

  test("missing date field is flagged", () => {
    const content = VALID_OLD.replace(/^date:.*$/m, "");
    const result = lintContent("2026-04-20.md", content);
    expect(result.issues).toContain("Missing frontmatter: date");
  });

  test("plural Devotions is flagged", () => {
    const content = VALID_OLD.replace("2026-04-20 Devotion", "2026-04-20 Devotions");
    const result = lintContent("2026-04-20.md", content);
    expect(
      result.issues.some((i) => i.includes('should use singular "Devotion"')),
    ).toBe(true);
  });

  test("title not matching YYYY-MM-DD format is flagged", () => {
    const content = VALID_OLD.replace("2026-04-20 Devotion", "Random Title");
    const result = lintContent("2026-04-20.md", content);
    expect(
      result.issues.some((i) => i.includes('should match "YYYY-MM-DD Devotion" format')),
    ).toBe(true);
  });
});

describe("lintContent — section headings", () => {
  test("missing 章の概要 is flagged", () => {
    const content = VALID_OLD.replace("## 章の概要", "## 概要");
    const result = lintContent("2026-04-20.md", content);
    expect(result.issues).toContain("Missing: ## 章の概要");
  });

  test("missing Key Verses is flagged", () => {
    const content = VALID_OLD.replace("## Key Verses", "## Quote");
    const result = lintContent("2026-04-20.md", content);
    expect(result.issues).toContain("Missing: ## Key Verses");
  });

  test("singular 'Key Verse' is flagged", () => {
    const content = VALID_OLD.replace("## Key Verses", "## Key Verse");
    const result = lintContent("2026-04-20.md", content);
    expect(result.issues).toContain('"Key Verse" should be "Key Verses" (plural)');
  });

  test("missing 実践ガイド is flagged", () => {
    const content = VALID_OLD.replace("## 実践ガイド", "## ガイド");
    const result = lintContent("2026-04-20.md", content);
    expect(result.issues).toContain("Missing: ## 実践ガイド");
  });

  test("missing 持ち帰り is flagged", () => {
    const content = VALID_OLD.replace("## 持ち帰り", "## まとめ");
    const result = lintContent("2026-04-20.md", content);
    expect(result.issues).toContain("Missing: ## 持ち帰り");
  });
});

describe("lintContent — SOAP", () => {
  test("missing ## SOAP heading is flagged", () => {
    const content = VALID_OLD.replace("## SOAP", "## SoapTypo");
    const result = lintContent("2026-04-20.md", content);
    expect(result.issues).toContain("Missing: ## SOAP");
  });

  test("nested ### SOAP is flagged with specific message", () => {
    const content = VALID_OLD.replace("## SOAP", "### SOAP");
    const result = lintContent("2026-04-20.md", content);
    expect(
      result.issues.some((i) => i.includes("SOAP not at top level")),
    ).toBe(true);
  });

  test("missing each SOAP part is flagged", () => {
    const content = VALID_OLD.replace("S（Scripture）", "Sx（Scripture）");
    const result = lintContent("2026-04-20.md", content);
    expect(
      result.issues.some((i) => i.includes("SOAP missing: S（Scripture）")),
    ).toBe(true);
  });

  test("missing all SOAP parts is flagged 4 times", () => {
    const content = VALID_OLD.replace(/[SOAP]（[A-Za-z]+）/g, "REMOVED");
    const result = lintContent("2026-04-20.md", content);
    const soapMissing = result.issues.filter((i) => i.startsWith("SOAP missing:"));
    expect(soapMissing).toHaveLength(4);
  });
});
