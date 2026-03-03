# validate-entry Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Notion エントリの類似タイトル重複を全登録経路で防止するバリデーションシステムを構築する

**Architecture:** `lib/notion.ts` に共通の `normalizeTitle` + `findSimilarEntries` を追加し、薄い CLI ラッパー `validate-entry.ts` を作成。既存3ファイルのコピペを統合。Claude 直接登録時は `.claude/rules/` のルールでバリデーション実行を強制。

**Tech Stack:** Bun, TypeScript, Notion API

---

### Task 1: `lib/notion.ts` に `normalizeTitle` と `getTimeFromISO` をエクスポート追加

**Files:**
- Modify: `scripts/lib/notion.ts`

**Step 1: `normalizeTitle` と `getTimeFromISO` を追加**

`scripts/lib/notion.ts` の末尾（`export` セクション付近）に以下を追加:

```typescript
// --- Title Normalization ---

/** タイトルを正規化（括弧・スペース・長音除去 + 小文字化） */
export function normalizeTitle(title: string): string {
  return title.replace(/[（）()]/g, "").replace(/\s+/g, "").replace(/ー/g, "").toLowerCase();
}

/** ISO日時文字列から HH:MM を抽出 */
export function getTimeFromISO(iso: string | undefined | null): string | null {
  if (!iso) return null;
  const m = iso.match(/T(\d{2}:\d{2})/);
  return m ? m[1] : null;
}
```

**Step 2: 動作確認**

Run: `bun -e "const { normalizeTitle } = require('./scripts/lib/notion.ts'); console.log(normalizeTitle('Devotion（祈り・聖書対話）'))"`
Expected: `devotion祈り聖書対話`

**Step 3: Commit**

```bash
git add scripts/lib/notion.ts
git commit -m "feat: add normalizeTitle and getTimeFromISO to lib/notion.ts"
```

---

### Task 2: `lib/notion.ts` に `findSimilarEntries` を追加

**Files:**
- Modify: `scripts/lib/notion.ts`

**Step 1: インターフェースと関数を追加**

`normalizeTitle` の直後に追加:

```typescript
export interface SimilarEntry {
  id: string;
  title: string;
  db: ScheduleDbName;
  start: string | null;
  end: string | null;
  matchType: "exact" | "similar";
}

const DB_LABELS: Record<ScheduleDbName, string> = {
  routine: "習慣", events: "イベント", todo: "やること",
  guitar: "ギター", sound: "音響", meals: "食事", groceries: "買い出し",
};

/**
 * 全スケジュール DB を横断して、指定日に類似タイトルのエントリを検索。
 * options.start を指定すると、時間帯が異なるエントリを除外する（Devotion 朝/夜の区別用）。
 */
export async function findSimilarEntries(
  date: string,
  title: string,
  options?: {
    db?: ScheduleDbName;
    start?: string;
    end?: string;
  },
): Promise<SimilarEntry[]> {
  const apiKey = getApiKey();
  const normalizedNew = normalizeTitle(title);
  const results: SimilarEntry[] = [];

  const dbNames: ScheduleDbName[] = options?.db
    ? [options.db]
    : (Object.keys(SCHEDULE_DB_CONFIGS) as ScheduleDbName[]);

  for (const dbName of dbNames) {
    const dbSetup = getScheduleDbConfigOptional(dbName);
    if (!dbSetup) continue;
    const { dbId, config } = dbSetup;

    let data: any;
    try {
      data = await queryDbByDateCached(apiKey, dbId, config, date, date);
    } catch { continue; }

    const pages: any[] = data.results || [];
    for (const page of pages) {
      const existingTitle = (page.properties?.[config.titleProp]?.title || [])
        .map((t: any) => t.plain_text || "").join("");
      const normalizedExisting = normalizeTitle(existingTitle);

      const titleMatch = normalizedNew === normalizedExisting;
      const titleSimilar = !titleMatch &&
        (normalizedNew.includes(normalizedExisting) || normalizedExisting.includes(normalizedNew));

      if (!titleMatch && !titleSimilar) continue;

      const existingDate = page.properties?.[config.dateProp]?.date;
      const existingStart = getTimeFromISO(existingDate?.start);
      const existingEnd = getTimeFromISO(existingDate?.end);

      // 時間帯が異なれば別エントリとして許可（Devotion 朝/夜等）
      if (options?.start && existingStart && options.start !== existingStart) continue;
      if (options?.end && existingEnd && options.end !== existingEnd) continue;

      results.push({
        id: page.id,
        title: existingTitle,
        db: dbName,
        start: existingStart,
        end: existingEnd,
        matchType: titleMatch ? "exact" : "similar",
      });
    }
  }

  return results;
}
```

**Step 2: 動作確認**

Run: `bun -e "import { findSimilarEntries } from './scripts/lib/notion.ts'; findSimilarEntries('2026-03-03', 'Devotion').then(r => console.log(JSON.stringify(r, null, 2)))"`
Expected: 今日の Devotion エントリが返る（あれば）

**Step 3: Commit**

```bash
git add scripts/lib/notion.ts
git commit -m "feat: add findSimilarEntries for cross-DB duplicate detection"
```

---

### Task 3: `validate-entry.ts` CLI ラッパーを作成

**Files:**
- Create: `scripts/validate-entry.ts`

**Step 1: CLI スクリプトを作成**

```typescript
#!/usr/bin/env bun
/**
 * Notion エントリ重複バリデーション
 *
 * 使い方:
 *   bun run scripts/validate-entry.ts --date YYYY-MM-DD --title "タイトル"
 *   bun run scripts/validate-entry.ts --date YYYY-MM-DD --title "Devotion" --start 08:00 --end 08:30
 *   bun run scripts/validate-entry.ts --date YYYY-MM-DD --title "ジム" --db routine
 *
 * 終了コード:
 *   0 = 類似エントリなし（登録OK）
 *   1 = 類似エントリあり（登録中止すべき）
 */

import { type ScheduleDbName, parseArgs, findSimilarEntries } from "./lib/notion";

const DB_LABELS: Record<ScheduleDbName, string> = {
  routine: "習慣", events: "イベント", todo: "やること",
  guitar: "ギター", sound: "音響", meals: "食事", groceries: "買い出し",
};

async function main() {
  const { opts } = parseArgs();
  if (!opts.date || !opts.title) {
    console.error("Usage: bun run scripts/validate-entry.ts --date YYYY-MM-DD --title \"タイトル\" [--db routine] [--start HH:MM] [--end HH:MM]");
    process.exit(2);
  }

  const similar = await findSimilarEntries(opts.date, opts.title, {
    db: opts.db as ScheduleDbName | undefined,
    start: opts.start,
    end: opts.end,
  });

  if (similar.length === 0) {
    console.log(`✅ 類似エントリなし。登録OK。`);
    process.exit(0);
  }

  console.error(`⚠️ 類似エントリ検出:`);
  for (const entry of similar) {
    const time = entry.start ? ` (${entry.start}${entry.end ? `-${entry.end}` : ""})` : "";
    const match = entry.matchType === "exact" ? "完全一致" : "類似";
    console.error(`  [${DB_LABELS[entry.db] || entry.db}] "${entry.title}"${time} — ${match}`);
  }
  console.error(`登録を中止してください。`);
  process.exit(1);
}

main();
```

**Step 2: 動作確認（類似なしケース）**

Run: `bun run scripts/validate-entry.ts --date 2026-03-03 --title "存在しないエントリ12345"`
Expected: `✅ 類似エントリなし。登録OK。` + exit code 0

**Step 3: 動作確認（類似ありケース）**

Run: `bun run scripts/validate-entry.ts --date 2026-03-03 --title "Devotion"`
Expected: 類似エントリが表示される + exit code 1（今日 Devotion があれば）

**Step 4: Commit**

```bash
git add scripts/validate-entry.ts
git commit -m "feat: add validate-entry.ts CLI for duplicate detection"
```

---

### Task 4: `notion-add.ts` をリファクタして共通関数を使う

**Files:**
- Modify: `scripts/notion-add.ts`

**Step 1: インポートに `normalizeTitle`, `getTimeFromISO`, `findSimilarEntries` を追加**

`scripts/notion-add.ts:16` のインポート文に追加:
```typescript
import { ..., normalizeTitle, getTimeFromISO, findSimilarEntries } from "./lib/notion";
```

**Step 2: ローカルの `normalizeTitle` と `getTimeFromISO` を削除**

`scripts/notion-add.ts:55-57`（`normalizeTitle` 関数）と `scripts/notion-add.ts:80-84`（`getTimeFromISO` 関数）を削除。

**Step 3: `checkDuplicate` を `findSimilarEntries` ベースに書き換え**

```typescript
async function checkDuplicate(apiKey: string, dbId: string, config: any, date: string, title: string, newStart?: string, newEnd?: string): Promise<boolean> {
  const similar = await findSimilarEntries(date, title, {
    start: newStart,
    end: newEnd,
  });

  for (const entry of similar) {
    if (entry.matchType === "exact") {
      console.error(`重複検出: "${entry.title}" が既に存在します。スキップします。`);
      return true;
    }
    // 部分的に似ている場合 → AI で判定
    const isDup = await aiIsDuplicate(title, entry.title);
    if (isDup) {
      console.error(`重複検出（AI判定）: "${entry.title}" と同一の予定です。スキップします。`);
      return true;
    }
  }
  return false;
}
```

注意: `checkDuplicate` の引数 `apiKey`, `dbId`, `config` は使わなくなるが、呼び出し元のシグネチャ変更を最小限にするため引数は残す（内部で無視）。

**Step 4: 動作確認**

Run: `bun run scripts/notion-add.ts --title "テスト重複チェック" --date 2026-03-03 --start 08:00 --end 08:30 --db routine 2>&1; echo "exit: $?"`
Expected: Devotion が 08:00-08:30 にあれば重複検出メッセージが出る

**Step 5: Commit**

```bash
git add scripts/notion-add.ts
git commit -m "refactor: use shared normalizeTitle and findSimilarEntries in notion-add.ts"
```

---

### Task 5: `notion-pull.ts` の `normalizeTitle` を共通関数に置き換え

**Files:**
- Modify: `scripts/notion-pull.ts`

**Step 1: インポートに `normalizeTitle` を追加**

`scripts/notion-pull.ts:27` のインポートリストに `normalizeTitle` を追加。

**Step 2: ローカルの `normalizeTitle` 関数を削除**

`scripts/notion-pull.ts:116-118` を削除。

注意: `notion-pull.ts` の `normalizeTitle` は `ー`（長音）を除去しないバージョン。統一版は `ー` を除去する。`titlesMatch` 関数はそのまま残す（食事プレフィックス比較ロジックは固有）。

**Step 3: 動作確認**

Run: `bun run scripts/notion-pull.ts --date 2026-03-03 --dry-run 2>&1 | head -20`
Expected: エラーなく動作する

**Step 4: Commit**

```bash
git add scripts/notion-pull.ts
git commit -m "refactor: use shared normalizeTitle in notion-pull.ts"
```

---

### Task 6: `notion-sync-event-file.ts` の `normalizeTitle` を共通関数に置き換え

**Files:**
- Modify: `scripts/notion-sync-event-file.ts`

**Step 1: インポートに `normalizeTitle` を追加**

`scripts/notion-sync-event-file.ts:22` のインポートリストに `normalizeTitle` を追加。

**Step 2: ローカルの `normalizeTitle` 関数を削除**

`scripts/notion-sync-event-file.ts:108-113` を削除。

**Step 3: 動作確認**

Run: `bun run scripts/notion-sync-event-file.ts --help 2>&1` または TypeScript コンパイルチェック
Expected: エラーなく動作する

**Step 4: Commit**

```bash
git add scripts/notion-sync-event-file.ts
git commit -m "refactor: use shared normalizeTitle in notion-sync-event-file.ts"
```

---

### Task 7: `.claude/rules/notion-workflow.md` にバリデーションルールを追記

**Files:**
- Modify: `.claude/rules/notion-workflow.md`

**Step 1: ルールを追記**

ファイル末尾に以下を追加:

```markdown

## 重複バリデーション（厳守）

Notion にスケジュール系エントリ（routine / events / todo / meals / groceries / guitar / sound）を **直接登録する前に**、必ず `validate-entry.ts` を実行する:

```
bun run scripts/validate-entry.ts --date YYYY-MM-DD --title "タイトル" --start HH:MM --end HH:MM
```

- **終了コード 1** → 類似エントリあり。登録中止。ユーザーに確認する
- **終了コード 0** → 問題なし。登録してよい
- `notion-add.ts` 経由の場合は内部で自動チェックされるため不要
- Notion MCP (`notion-create-pages` / `notion-update-page`) で直接登録する場合は**必ず実行すること**
```

**Step 2: Commit**

```bash
git add .claude/rules/notion-workflow.md
git commit -m "docs: add duplicate validation rule to notion-workflow.md"
```

---

### Task 8: 統合テスト & PR 作成

**Step 1: 全スクリプトの動作確認**

Run:
```bash
bun run scripts/validate-entry.ts --date 2026-03-03 --title "Devotion" --start 08:00 --end 08:30
bun run scripts/validate-entry.ts --date 2026-03-03 --title "存在しないエントリ"
bun run scripts/notion-add.ts --help
```

**Step 2: PR 作成**

`/pr` スキルを使って PR を作成する。
