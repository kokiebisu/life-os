---
name: sync-lessons
description: Use when syncing lesson content from MD files to Notion curriculum DB pages. TRIGGER proactively when lesson pages in curriculum DB have empty content, when registering lessons to curriculum DB, when user asks about lesson content and Notion page is empty, when touching curriculum pages during /cleanup or /from:notion, or when explicitly invoked via /sync:lessons.
---

# sync-lessons — レッスン内容を Notion ページに同期

## Overview

リポジトリのレッスン MD ファイルの内容を、Notion カリキュラム DB のページ本文に書き込む。
**空ページを放置してはいけない。** レッスンページの本文が空のまま処理を終えることは許されない。

## Aspect 設定

| aspect | DB flag | MD パスパターン | カリキュラム filter |
|--------|---------|----------------|-------------------|
| guitar | `--db guitar` | `aspects/guitar/phase*/lesson-*.md` | ギター |
| sound | `--db sound` | `aspects/sound/phase*/lesson-*.md` | 音響 |

新しいカリキュラム aspect が追加されたら、このテーブルに行を追加する。

## 引数（`$ARGUMENTS`）

| 入力例 | 意味 |
|--------|------|
| `guitar 6` | ギター Lesson 6 のみ |
| `sound 3` | 音響 Lesson 3 のみ |
| `guitar` | ギター全レッスン |
| `sound` | 音響全レッスン |
| `all` / 引数なし | 全 aspect の空ページを検出して処理 |

## 処理ステップ

### 1. 対象を決定する

`$ARGUMENTS` をパースして、対象 aspect と（あれば）レッスン番号を特定する。

### 2. Notion ページを取得する

```bash
bun run scripts/notion-list.ts --db {guitar|sound} --all --json
```

レスポンスからページ ID とタイトルを取得する。

### 3. ページが空かチェックする

Notion MCP の `notion-fetch` でページ本文を取得する。

- **空 or 極端に短い** → 書き込み対象
- **既にコンテンツがある** → スキップ
- **特定レッスンを明示指定された場合** → コンテンツがあっても上書きする

### 4. MD ファイルを読んでストリップする

1. タイトルからレッスン番号を抽出する（例: "Lesson 6: dim＆オルタード" → 6）
2. `aspects/{aspect}/phase*/lesson-{NN}.md` を読む（NN はゼロ埋め2桁: 06）
3. **対象 aspect の `CLAUDE.md` を読む** — 「除外するセクション」「Notion 書式ルール」を確認する
4. 以下をストリップする:
   - タイトル行（最初の `# Lesson ...` 行）
   - aspect の CLAUDE.md に記載された除外セクション

**除外セクションの参照先（CLAUDE.md が正）:**
- Guitar: `aspects/guitar/CLAUDE.md` → 「除外するセクション」
- Sound: `aspects/sound/CLAUDE.md` → 「Notion 書式ルール」内の除外指定

### 5. Notion ページに書き込む

Notion MCP の `notion-update-page` を使う:

```
command: "replace_content"
page_id: {対象ページの ID}
new_str: {ストリップ済みコンテンツ}
```

書式は対象 aspect の CLAUDE.md「Notion 書式ルール」「Notion フォーマットルール」に従う。

### 6. 結果を報告する

```
sync:lessons 完了:
- Lesson 6: dim＆オルタード（guitar）
- Lesson 1: already has content, skipped
```

## Key Rules

- **空ページ禁止:** レッスンページの本文が空のまま処理を終えてはいけない
- **ストリップルールは各 aspect の CLAUDE.md に従う** — このファイルには複製しない
- **Notion 書式ルールも各 aspect の CLAUDE.md に従う** — フォーマットの詳細はそちらを参照
- 新しいカリキュラム aspect が追加されたら、Aspect 設定テーブルに行を追加する
