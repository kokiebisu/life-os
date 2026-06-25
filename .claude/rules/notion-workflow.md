# Notion ワークフロー

## sync スクリプトを迂回しない（厳守）

`notion-sync-*.ts` や `notion-add.ts` などの sync スクリプトがエラーで失敗したとき、**MCP 直接操作（`notion-update-page` 等）で迂回してはいけない。** 必ずスクリプトを修正して使う。

- 理由: sync スクリプトは source of truth の正規化・重複チェック・プロパティマッピングを担っているため、MCP 直接操作は一貫性を壊す
- 正しい手順:
  1. エラーの原因（スキーマ不一致・マッチング失敗等）を特定する
  2. スクリプトを修正する
  3. `--dry-run` で影響範囲を確認する
  4. 本番実行する

## 破壊的 sync の dry-run 必須（厳守）

Notion の既存エントリを更新する可能性がある sync スクリプトを実行する前に、**必ず `--dry-run` で「どのエントリが更新されるか」を確認する。**

- 同日複数エントリがある場合、マッチング戦略によっては意図しないエントリを上書きする（例: 主日礼拝の代わりに Worship Team Audition を上書きなど）
- dry-run 出力で `更新: <date> 「<title>」` のタイトルが自分の意図と一致しているか確認する
- 不一致なら実行せず、スクリプトのマッチングロジックを修正する

## notion-list で見つからない場合（厳守）

`notion-list.ts` はスケジュール系 DB のみ対象。**ジム DB など対象外の DB は表示されない。**

- `notion-list.ts` で見つからなくても「存在しない」と判断しない
- ユーザーが「Notion にある」と言ったら、`notion-search` で再検索するか、ユーザーに URL を確認する前に `notion-search` を試みる

## job DB（仕事探し）の検索（厳守）

job DB のページタイトルは「面接」「カジュアル面談」など汎用名になる。**会社名はプロパティにしか入らないため、会社名で `notion-search` してもヒットしない場合がある。**

- 会社名で検索してヒットしない場合 → 「面接」「カジュアル面談」などタイトル側のキーワードで再検索するか、ユーザーに「URLを貼ってください」と依頼する
- ユーザーが URL を貼った場合は即 `notion-fetch` する（AskUserQuestion で選択肢を出さない）

## タイトル正規化（厳守）

`notion-add.ts` にはタイトル正規化機能が組み込まれている。**タイトルを手動で決める前に `scripts/notion/notion-add.ts` の `TITLE_KEYWORD_LIST` を参照し、既存の canonical タイトルに合わせること。**

- 「開発」「コーディング」「実装」「life-os」→ `開発`
- 「ジム」「筋トレ」「トレーニング」→ `ジム`
- 「勉強」「学習」→ `勉強`
- 「ギター」「練習」→ `ギター練習`
- 「買い出し」「買い物」→ `買い出し`
- 他のキーワードは `TITLE_KEYWORD_LIST`（[scripts/notion/notion-add.ts](../../scripts/notion/notion-add.ts)）で確認する

`notion-add.ts` 経由であれば自動適用される。`notion-create-pages` など MCP 直接登録の場合は**手動で確認・統一すること。**

## Job DB（`NOTION_JOB_DB`）の会社名セット（厳守）

job DB にエントリを作成・更新する際は、**必ず `profile/career.md` の「現在の所属 > 会社名」を読んで `会社名` プロパティにセットすること。**

- 求職中の場合: `会社名` は設定しない（空欄）か、面接先の企業名をセット
- 入社後: `profile/career.md` を更新してから job DB エントリを作成

**Job DB プロパティ一覧:**

| プロパティ | 型     | 選択肢                                     |
| -------- | ------ | ------------------------------------------ |
| 名前     | title  | —                                          |
| 日付     | date   | —                                          |
| 会社名   | select | kickflow株式会社 / フリーランス / その他    |
| 種別     | select | 面接 / 業務 / カジュアル面談 / その他       |

## select プロパティ設定前のスキーマ確認（厳守）<!-- コード化済み: validateSelectValue() in scripts/lib/notion.ts -->

`notion-update-page` で select プロパティを設定する前に、**必ず DB のスキーマを確認してから正しいプロパティ名・選択肢を指定する。**

- プロパティ名に `select:` `rich_text:` などのプレフィックスは**不要**。プロパティ名をそのまま使う
- select の選択肢（`カテゴリ`・`本` など）は DB の既存値と完全一致が必要。推測で入力しない
- スキーマ確認は `bun -e "..."` でDB プロパティ一覧を取得するか、`notion-fetch` で確認する

## プロパティ名エラー時の対応（厳守）

`notion-update-page` で `"Property not found"` エラーが出たら、**必ず `notion-fetch` でDBスキーマを確認してから正しいプロパティ名でリトライする。** エラーを無視して先に進まない。

## Notion MCP サーバー名

- `ReadMcpResourceTool` のサーバー名は **`claude.ai Notion`**（スペース・ドット入り）
- ツール名の `mcp__claude_ai_Notion__*` と混同しないこと

## 日時のタイムゾーン（厳守）<!-- コード化済み: ensureJST() in scripts/lib/notion.ts -->

Notion MCP (`notion-update-page`) で日時プロパティを設定するとき、**必ず `+09:00`（JST）を付ける。** タイムゾーンなしで渡すと UTC 扱いになり、カレンダー上で9時間ずれる。

```
// ✅ OK: +09:00 を明示 → 正しく 10:00 JST になる
"date:日付:start": "2026-02-21T10:00:00+09:00"
```

- `notion-update-page` の `date:*:start` / `date:*:end` すべてが対象
- 日付のみ（時刻なし）の場合は `2026-02-21` で OK（タイムゾーン不要）
- **時刻を含む場合は例外なく `+09:00` を付けること**

## notion-pull dry-run の確認（厳守）<!-- コード化済み: validateDryRunEntries() in scripts/notion/notion-pull.ts -->

`notion-pull.ts --dry-run` の出力に以下の異常が含まれる場合、**実行前にユーザーに確認する。** そのまま実行しない。

- 時刻が `24:xx` 以降（例: `26:43`）
- 移動時間が 120分 超
- 開始時刻が元の予定より大幅に早い（2時間以上）

## 勉強系 DB の使い分け（厳守）

「勉強」系の Notion DB は4種類あり、用途で使い分ける。`--db` を間違えると別 DB に入って履歴が分断される。

| タイトル | `--db` flag | 用途 |
|---------|------------|------|
| 勉強（面接対策） | `interview` | 面接対策セッション（コーディング・模擬・コードレビュー等） |
| 勉強（読書） | `study` | 本を読むセッション |
| 勉強（トピック別） | `topic` | トピック単位の学習（アルゴリズム・特定領域の深堀り等） |
| 勉強（復習） | （`/fukushuu` 専用） | スペーシドリピティション復習サマリー |

- 面接対策は `--db interview` を使う。`--db study` は本を読むときだけ
- `notion-add.ts` は `interview` DB のテンプレートを持たないので、API 直叩きでページ本文を書く（`会社` プロパティも必須）
- タイトルは `勉強（面接対策）` など DB 名と一致させる。`TITLE_KEYWORD_LIST` の自動正規化（「勉強」→「勉強（読書）」）は誤解を招くため、`--title "勉強（面接対策）"` のように明示的に渡す

## scripts パスの確認（厳守）

Notion 関連スクリプトは **`scripts/notion/` 配下**にある。`scripts/` 直下には存在しない。

```bash
# ✅ OK
bun run scripts/notion/notion-add.ts
bun run scripts/notion/notion-list.ts

# ❌ NG（パスエラーになる）
bun run scripts/notion/notion-add.ts
```

初めて使うスクリプトは `ls scripts/notion/` で存在確認してから実行する。

## キャッシュ（厳守）

- `notion-update-page` や `notion-add.ts` で時間変更・更新した後、`notion-list.ts` で確認する前に必ず `bun run scripts/cache-status.ts --clear` を実行する

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

## ページ本文ルール（Description プロパティ廃止）

**DB の Description / 説明プロパティは使わない。** 内容はすべてページ本文に書く。

- `--desc` オプションは廃止済み。`notion-add.ts` に渡しても無視される
- 説明・詳細・レシピ・レッスン内容などは、ページ作成後に `notion-update-page` の `replace_content` でページ本文に書き込む
- **手順:** `notion-add.ts` → ページ ID 取得 → `notion-update-page`（`replace_content`）で本文を書く

## 既存ページの確認（厳守）

Notion にページを**新規作成する前に**、必ず既存ページの存在を確認する。検索でヒットしなくても存在する場合がある（JST/UTC ズレで日付フィルターが機能しないケースなど）。

- `notion-search` でヒットしない場合でも、**`notion-list.ts --date` または DB を `notion-fetch` で直接確認**してから判断する
- md ファイルがすでに存在する場合（`/devotion` 等で作成済み）は、対応する Notion ページも存在する可能性が高い
- **`validate-entry.ts` は類似タイトルの検出のみ。** 既存ページへの追記が必要なケースは検出できない。必ず `notion-list.ts --date` で確認し、既存ページがあれば新規作成せず**そのページに追記する**

## 重複バリデーション（厳守）<!-- コード化済み: validate-entry.ts + notion-add.ts checkDuplicate -->

Notion にスケジュール系エントリ（devotion / events / todo / meals / groceries / study）を **直接登録する前に**、必ず `validate-entry.ts` を実行する:

```
bun run scripts/validate-entry.ts --date YYYY-MM-DD --title "タイトル" --start HH:MM --end HH:MM
```

- **終了コード 1** → 類似エントリあり。登録中止。ユーザーに確認する
- **終了コード 0** → 問題なし。登録してよい
- `notion-add.ts` 経由の場合は内部で自動チェックされるため不要
- Notion MCP (`notion-create-pages` / `notion-update-page`) で直接登録する場合は**必ず実行すること**

CLI コマンドの使い方は `/calendar` コマンドを参照。
