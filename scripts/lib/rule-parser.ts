import { basename } from "path";
import { Glob } from "bun";

export type RulePattern =
  | "pre-check"
  | "post-check"
  | "format-enforce"
  | "fallback"
  | "prohibition"
  | "judgment"
  | "unknown";

export interface ExtractedRule {
  id: string;
  source: string;
  heading: string;
  body: string;
  isStrict: boolean;
  hasCodeBlock: boolean;
  hasConditional: boolean;
  relatedScripts: string[];
  patternType: RulePattern;
}

const PATTERN_RULES: { pattern: RegExp; type: RulePattern }[] = [
  { pattern: /前に必ず|する前に|登録する前|作成する前|実行する前/, type: "pre-check" },
  { pattern: /した後[、に]|の後に必ず|後[、に].*確認|確認してから/, type: "post-check" },
  { pattern: /を付ける|形式にし|フォーマット|\+09:00|形式で/, type: "format-enforce" },
  { pattern: /失敗した場合|エラーが出たら|失敗したら|エラー時/, type: "fallback" },
  { pattern: /禁止|しない[。こと]|するな[。]|使わない[。こと]/, type: "prohibition" },
  { pattern: /判断|文脈|適切に|考慮して|状況に応じ/, type: "judgment" },
];

export function detectPattern(text: string): RulePattern {
  for (const { pattern, type } of PATTERN_RULES) {
    if (pattern.test(text)) return type;
  }
  return "unknown";
}

const CONDITIONAL_PATTERN = /の場合|の前に|する前|した後|したら|エラーが出/;
const SCRIPT_REF_PATTERN = /scripts\/[\w\-\/]+\.ts/g;
const STRICT_PATTERN = /厳守/;

export function splitMarkdownIntoRules(markdown: string, filePath: string): ExtractedRule[] {
  const fileBase = basename(filePath, ".md");
  const sections = splitByHeadings(markdown);

  if (sections.length === 0) {
    return [buildRule(fileBase, fileBase, markdown, filePath)];
  }

  return sections.map(({ heading, body }) =>
    buildRule(`${fileBase}--${heading}`, heading, body, filePath)
  );
}

interface Section { heading: string; body: string; }

function splitByHeadings(markdown: string): Section[] {
  const lines = markdown.split("\n");
  const sections: Section[] = [];
  let currentHeading = "";
  let currentBody: string[] = [];

  for (const line of lines) {
    const match = line.match(/^##\s+(.+)/);
    if (match) {
      if (currentHeading) {
        sections.push({ heading: currentHeading, body: currentBody.join("\n").trim() });
      }
      currentHeading = match[1].trim();
      currentBody = [];
    } else if (currentHeading) {
      currentBody.push(line);
    }
  }

  if (currentHeading) {
    sections.push({ heading: currentHeading, body: currentBody.join("\n").trim() });
  }

  return sections;
}

function buildRule(id: string, heading: string, body: string, source: string): ExtractedRule {
  const scriptRefs = [...body.matchAll(SCRIPT_REF_PATTERN)].map(m => m[0]);
  const relatedScripts = [...new Set(scriptRefs)];

  return {
    id, source, heading, body,
    isStrict: STRICT_PATTERN.test(heading) || STRICT_PATTERN.test(body.slice(0, 100)),
    hasCodeBlock: /```/.test(body),
    hasConditional: CONDITIONAL_PATTERN.test(body),
    relatedScripts,
    patternType: detectPattern(body),
  };
}

export async function findExistingScripts(): Promise<string[]> {
  const glob = new Glob("scripts/**/*.ts");
  const files: string[] = [];
  for await (const file of glob.scan({ cwd: process.cwd() })) {
    files.push(file);
  }
  return files.sort();
}
