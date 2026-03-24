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

## デボーション DB プロパティ（厳守）

`notion-add.ts` はデボーション DB の `Book`・`Chapter` プロパティに対応していないため、
登録後に必ず `notion-update-page` で以下を設定すること:

- `Name`: `デボーション`（固定）
- `Book`: 書名（例: `マルコの福音書`）
- `Chapter`: 章番号（数字）
- `icon`: `🙏`

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
- **タスク追加時: 必ず時間（--start/--end）を入れる**（--allday フラグは廃止済み。エラーが出ても --allday で逃げず、ユーザーに時間を確認する）
- **説明・詳細はページ本文に書く**（後述「ページ本文ルール」参照）
- **完了済タスクの追加時**（「〜してた」等）→ ステータスを「完了」にセット
- **同名エントリがある場合は確認する**
- **重複エントリ防止**: 登録前に `notion-list.ts --date` で既存エントリを取得
- **日付未設定の既存ページに注意**: `notion-fetch` でDB を確認するか、ユーザーに確認する

## DB の使い分け

- **events**: 行事・集まり（人と会う、参加する予定）
- **todo**: やらないといけないこと（タスク、作業、手続き）
- **devotion**: デボーション・習慣（繰り返しやるもの）
- **その他**: 実績ログ・作業記録（「〜してた」「〜やってた」など、タスクではない活動記録）

**迷ったときの判断基準:**
- 「行事・集まり？」→ Yes なら events
- 「やらないといけないこと？」→ Yes なら todo
- 「繰り返しやる？」→ Yes なら devotion
- 「〜してた（実績）？」→ Yes なら **その他**（todo ではない）

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
| デボーション | `NOTION_DEVOTION_DB` | Name / 日付 | なし       | デボーション・日々の習慣         |
| イベント | `NOTION_EVENTS_DB`    | 名前 / 日付 | なし       | 一回限りの予定                   |
| カリキュラム | `NOTION_CURRICULUM_DB` | 名前 / 日付 / カリキュラム | ステータス | ギター・音響レッスン（カリキュラムで分類） |
| 食事     | `NOTION_MEALS_DB`     | 名前 / 日付 | なし       | 食事メニュー（調理・食べるもの） |
| 買い出し | `NOTION_GROCERIES_DB` | 件名 / 日付 | なし       | 買い出し・買い物                 |
| その他   | `NOTION_OTHER_DB`     | 名前 / 日付 | なし       | 実績ログ・活動記録（「〜してた」）|
| 学習     | `NOTION_STUDY_DB`     | 名前 / 日付 / カテゴリ / 本 / Chapter（**数字のみ** e.g. `5`） | なし | 学習セッション・ノート（`/study`）|

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

## 既存ページの確認（厳守）

Notion にページを**新規作成する前に**、必ず既存ページの存在を確認する。検索でヒットしなくても存在する場合がある（JST/UTC ズレで日付フィルターが機能しないケースなど）。

- `notion-search` でヒットしない場合でも、**`notion-list.ts --date` または DB を `notion-fetch` で直接確認**してから判断する
- md ファイルがすでに存在する場合（`/devotion` 等で作成済み）は、対応する Notion ページも存在する可能性が高い

## 重複バリデーション（厳守）

Notion にスケジュール系エントリ（devotion / events / todo / meals / groceries / guitar / sound / study）を **直接登録する前に**、必ず `validate-entry.ts` を実行する:

```
bun run scripts/validate-entry.ts --date YYYY-MM-DD --title "タイトル" --start HH:MM --end HH:MM
```

- **終了コード 1** → 類似エントリあり。登録中止。ユーザーに確認する
- **終了コード 0** → 問題なし。登録してよい
- `notion-add.ts` 経由の場合は内部で自動チェックされるため不要
- Notion MCP (`notion-create-pages` / `notion-update-page`) で直接登録する場合は**必ず実行すること**

## スクリプト一覧

共通ライブラリ: `scripts/lib/notion.ts`

CLI コマンドの使い方は `/calendar` コマンドを参照。
