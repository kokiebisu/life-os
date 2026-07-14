import { describe, test, expect } from "bun:test";
import { detectPattern, splitMarkdownIntoRules, findExistingScripts } from "./rule-parser";

describe("detectPattern", () => {
  test("pre-check: 「〜する前に」パターンを検出", () => {
    expect(detectPattern("登録する前に必ず validate-entry.ts を実行する")).toBe("pre-check");
  });
  test("post-check: 「〜した後」パターンを検出", () => {
    expect(detectPattern("更新した後、notion-list.ts で確認する")).toBe("post-check");
  });
  test("format-enforce: フォーマット強制パターンを検出", () => {
    expect(detectPattern("時刻を含む場合は例外なく +09:00 を付けること")).toBe("format-enforce");
  });
  test("fallback: エラー時の代替パターンを検出", () => {
    expect(detectPattern("gh pr create が失敗した場合、gh api で直接 PR を作成する")).toBe("fallback");
  });
  test("prohibition: 禁止パターンを検出", () => {
    expect(detectPattern("main への直接コミット・プッシュ禁止")).toBe("prohibition");
  });
  test("judgment: 判断系パターンを検出", () => {
    expect(detectPattern("文脈に応じて適切に判断する")).toBe("judgment");
  });
  test("unknown: どのパターンにも該当しない", () => {
    expect(detectPattern("ユーザープロフィールは aspects/people/me.md に一元管理されている")).toBe("unknown");
  });
});

describe("splitMarkdownIntoRules", () => {
  test("## 見出しでルールを分割する", () => {
    const md = `# タイトル\n\n## ルール1（厳守）\n\n内容1\n\n## ルール2\n\n内容2\n`;
    const rules = splitMarkdownIntoRules(md, ".ai/rules/test.md");
    expect(rules).toHaveLength(2);
    expect(rules[0].heading).toBe("ルール1（厳守）");
    expect(rules[0].isStrict).toBe(true);
    expect(rules[0].body).toContain("内容1");
    expect(rules[1].heading).toBe("ルール2");
    expect(rules[1].isStrict).toBe(false);
  });

  test("見出しがない場合はファイル全体を1ルールとする", () => {
    const md = `説明文\n\n- ルールA\n- ルールB\n`;
    const rules = splitMarkdownIntoRules(md, ".ai/rules/simple.md");
    expect(rules).toHaveLength(1);
    expect(rules[0].heading).toBe("simple");
  });

  test("コードブロックを検出する", () => {
    const md = "## コード例あり\n\n```bash\nbun run scripts/validate-entry.ts\n```\n";
    const rules = splitMarkdownIntoRules(md, ".ai/rules/code.md");
    expect(rules[0].hasCodeBlock).toBe(true);
  });

  test("scripts/ パス参照を検出する", () => {
    const md = "## スクリプト参照\n\n`scripts/notion/notion-add.ts` を使う。`scripts/cache-status.ts` も実行する。\n";
    const rules = splitMarkdownIntoRules(md, ".ai/rules/ref.md");
    expect(rules[0].relatedScripts).toEqual([
      "scripts/notion/notion-add.ts",
      "scripts/cache-status.ts",
    ]);
  });

  test("条件分岐パターンを検出する", () => {
    const md = "## 条件付きルール\n\nエラーが出た場合は、notion-fetch で確認する。\n";
    const rules = splitMarkdownIntoRules(md, ".ai/rules/cond.md");
    expect(rules[0].hasConditional).toBe(true);
  });

  test("id はファイル名 + 見出しから生成する", () => {
    const md = "## タイムゾーン付与\n\n時刻には +09:00 を付けること。\n";
    const rules = splitMarkdownIntoRules(md, ".ai/rules/notion-workflow.md");
    expect(rules[0].id).toBe("notion-workflow--タイムゾーン付与");
    expect(rules[0].source).toBe(".ai/rules/notion-workflow.md");
  });
});

describe("findExistingScripts", () => {
  test("scripts/ 配下の実ファイルリストを返す", async () => {
    const files = await findExistingScripts();
    expect(files).toContain("scripts/validate-entry.ts");
    expect(files).toContain("scripts/notion/notion-add.ts");
    expect(files.length).toBeGreaterThan(10);
  });
});
