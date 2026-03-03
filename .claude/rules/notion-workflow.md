# Notion ワークフロー

## Notion MCP サーバー名

- `ReadMcpResourceTool` のサーバー名は **`claude.ai Notion`**（スペース・ドット入り）
- ツール名の `mcp__claude_ai_Notion__*` と混同しないこと

## 日時のタイムゾーン（厳守）

Notion MCP (`notion-update-page`) で日時プロパティを設定するとき、**必ず `+09:00`（JST）を付ける。** タイムゾーンなしで渡すと UTC 扱いになり、カレンダー上で9時間ずれる。

```
// ❌ NG: タイムゾーンなし → UTC として解釈され 19:00 JST になる
"date:日付:start": "2026-02-21T10:00"

// ✅ OK: +09:00 を明示 → 正しく 10:00 JST になる
"date:日付:start": "2026-02-21T10:00:00+09:00"
```

- `notion-update-page` の `date:*:start` / `date:*:end` すべてが対象
- 日付のみ（時刻なし）の場合は `2026-02-21` で OK（タイムゾーン不要）
- **時刻を含む場合は例外なく `+09:00` を付けること**

## キャッシュ（厳守）

- `notion-update-page` や `notion-add.ts` で時間変更・更新した後、`notion-list.ts` で確認する前に必ず `bun run scripts/cache-status.ts --clear` を実行する

## 基本方針

- **全イベント・タスクを Notion データベースで管理**
- Notion Calendar で閲覧（Google Calendar と双方向同期）
- タスクには Feedback 欄あり → 翌日 API で取得して次の日のスケジュールに反映

## 操作ルール

- **新規ページには必ずアイコンとカバー画像をつける**
- **完了済みのページは基本いじらない**
- **時間変更時: 前後の予定も連鎖チェック**
- **タスク追加時: 必ず時間（--start/--end）を入れる**（--allday は使わない）
- **説明・詳細はページ本文に書く**（後述「ページ本文ルール」参照）
- **完了済タスクの追加時**（「〜してた」等）→ ステータスを「完了」にセット
- **同名エントリがある場合は確認する**
- **重複エントリ防止**: 登録前に `notion-list.ts --date` で既存エントリを取得
- **日付未設定の既存ページに注意**: `notion-fetch` でDB を確認するか、ユーザーに確認する

## DB の使い分け

- **events**: 行事・集まり（人と会う、参加する予定）
- **todo**: やらないといけないこと（タスク、作業、手続き）
- **routine**: 繰り返しやること（毎日・毎週やるもの）

**迷ったときの判断基準:**
- 「行事・集まり？」→ Yes なら events
- 「やらないといけないこと？」→ Yes なら todo
- 「繰り返しやる？」→ Yes なら routine

詳しい間違えやすい例は `/event` コマンド参照。

## md の配置場所と Notion DB は独立（厳守）

**Notion の登録先 DB は、ファイルの配置場所ではなく内容で判断する。**

- `events/` ファイルにタスク（手続き・作業・確認）が書いてあっても → **todo DB**
- `tasks.md` に書いてあるイベント的なものがあっても → **events DB**

ファイルの置き場所に引きずられて DB を選ばないこと。

## Notion DB 体制

### Schedule DBs

| DB       | 環境変数              | プロパティ  | ステータス | 用途                             |
| -------- | --------------------- | ----------- | ---------- | -------------------------------- |
| 習慣     | `NOTION_TASKS_DB`     | Name / 日付 | ステータス | 繰り返しルーティン               |
| イベント | `NOTION_EVENTS_DB`    | 名前 / 日付 | ステータス | 一回限りの予定                   |
| カリキュラム | `NOTION_CURRICULUM_DB` | 名前 / 日付 / カリキュラム | ステータス | ギター・音響レッスン（カリキュラムで分類） |
| 食事     | `NOTION_MEALS_DB`     | 名前 / 日付 | ステータス | 食事メニュー（調理・食べるもの） |
| 買い出し | `NOTION_GROCERIES_DB` | 件名 / 日付 | ステータス | 買い出し・買い物                 |

### Other DBs

- `NOTION_ARTICLES_DB` — 記事（タイトル / ソース / URL / Aspect / Status）
- `NOTION_INVESTMENT_DB` — 投資（Investment / Buy Date / Status / Type / Notes）
- **クイックメモ DB** — 思考キャプチャ。`/process` コマンドで処理する

## ページ本文ルール（Description プロパティ廃止）

**DB の Description / 説明プロパティは使わない。** 内容はすべてページ本文に書く。

- `--desc` オプションは廃止済み。`notion-add.ts` に渡しても無視される
- 説明・詳細・レシピ・レッスン内容などは、ページ作成後に `notion-update-page` の `replace_content` でページ本文に書き込む
- **手順:** `notion-add.ts` → ページ ID 取得 → `notion-update-page`（`replace_content`）で本文を書く

## 削除時はページごと完全削除する

- ページ削除は `notion-delete.ts` を使う: `bun run scripts/notion-delete.ts <page-id>`
- 複数ページの一括削除にも対応: `bun run scripts/notion-delete.ts <id1> <id2> ...`

## スクリプト一覧

共通ライブラリ: `scripts/lib/notion.ts`

CLI コマンドの使い方は `/calendar` コマンドを参照。
