---
name: gym
description: ジムセッションの予定登録（/gym plan）と実績ログ記録（/gym log）。引数: $ARGUMENTS
---

# gym — ジムセッション管理

## 引数パース

`$ARGUMENTS` を確認する:
- `plan` または `plan <日付>` または `plan <日付> <時間>` → `/gym plan` フローへ
- `log` または `log <日付>` → `/gym log` フローへ
- 引数なし or 不明 → ユーザーに「plan か log を指定してください」と確認する

---

## /gym plan — ジム予定を routine DB に登録

### 日付・時刻の決定

1. `TZ=Asia/Tokyo date` で今日の日付を確認する
2. `$ARGUMENTS` から日付・時刻を抽出する:
   - 日付未指定: 今日の日付を使う（ユーザーに確認して進む）
   - 時刻未指定: デフォルトは `12:30`（開始）、`14:00`（終了）
   - 開始時刻指定あり: 終了時刻 = 開始時刻 + 90分で計算する
3. ISO8601 形式に変換する: `YYYY-MM-DDT12:30:00+09:00`（JST 必須）

### 重複チェック

```bash
bun run scripts/validate-entry.ts --date YYYY-MM-DD --title "ジム" --start HH:MM --end HH:MM
```

- 終了コード 1（類似エントリあり）→ ユーザーに確認してから登録するか判断する
- 終了コード 0 → 次のステップへ

### 登録

```bash
bun run scripts/notion-add.ts --db routine --title "ジム" --date YYYY-MM-DD --start YYYY-MM-DDT12:30:00+09:00 --end YYYY-MM-DDT14:00:00+09:00
```

### キャッシュクリア

```bash
bun run scripts/cache-status.ts --clear
```

### 完了報告

「ジムを [日付] [時間] で routine DB に登録しました」と報告する。

---

## /gym log — ジム実績を記録する

### 日付の決定

- `$ARGUMENTS` に日付（例: `log 2026-03-15`）があればその日付を使う
- 日付未指定なら今日の日付を使う: `TZ=Asia/Tokyo date +%Y-%m-%d`

### 準備

1. `aspects/diet/gym-logs/` ディレクトリが存在しない場合は作成する
2. 最新のログファイルを確認して前回の種目と重量を取得する:
   ```bash
   ls -t aspects/diet/gym-logs/*.md 2>/dev/null | head -1
   ```
   存在する場合はそのファイルを読み、前回の種目・重量一覧をユーザーに提示する。

### データ収集

ユーザーに確認する（前回ログがあれば提示する）:

```
今日のジムログを記録します。

前回（YYYY-MM-DD）:
- フィックスドプルダウン: 40kg × 10回 × 3セット
- プレートロードドインクラインプレス: 20kg × 10回 × 2セット
- スクワットマシン: 3セット × 10回

今回やった種目と重量・セット数・回数を教えてください
（フォーマット例: 種目名 重量kg セット数 回数）
```

ユーザーの入力を受け取る。体感メモも任意で確認する。

### Notion DB の種目オプション確認

`.env.local` から `NOTION_GYM_DB` を読み取る（`326ce17f-7b98-801b-b403-f9aebac84861`）。

ユーザーが入力した種目名が DB のスキーマに存在しない場合は、`notion-update-data-source` で先に追加する:
```
data_source_id: 326ce17f-7b98-806a-be76-000b67b58628
statements: ALTER COLUMN "種目" SET SELECT('既存オプション...', '新種目名':gray)
```

現在の種目オプション: フィックスドプルダウン, プレートロードドインクラインプレス, スクワットマシン, ベンチプレス, スクワット, デッドリフト

### Notion 重複チェック

Notion MCP の `notion-search` で同日のエントリを確認する:
- 検索クエリ: `ジム M/D`（例: `ジム 3/15`）
- 既存エントリがあればユーザーに確認してから登録する

### 時間の割り当て（厳守）

複数種目を登録するとき、**全種目に同じ時間を入れない。** 開始時刻から15分刻みで順列に割り当てる。

例: 開始 15:00、3種目の場合
- 種目1: 15:00〜15:15
- 種目2: 15:15〜15:30
- 種目3: 15:30〜15:45

### Notion ジムログDB に登録

Notion MCP の `notion-create-pages` を使って各種目を1エントリずつ登録する。

```
parent: data_source_id = 326ce17f-7b98-806a-be76-000b67b58628
```

各エントリのパラメータ:
- `icon`: `🏋️`
- `cover`: `https://images.unsplash.com/photo-1534438327276-14e5300c3a48?w=1200`
- `名前`: `ジム`（日付は 日付プロパティで管理するためタイトルに含めない）
- `date:日付:start`: `YYYY-MM-DDThh:mm:00+09:00`（JST 必須）
- `date:日付:end`: `YYYY-MM-DDThh:mm:00+09:00`（終了時刻）
- `date:日付:is_datetime`: `1`
- `種目`: 種目名（select）
- `重量`: 重量の数値（プレートロードドは追加重量を記録）
- `セット数`: セット数
- `回数`: 回数

### キャッシュクリア

```bash
bun run scripts/cache-status.ts --clear
```

### ローカル MD を保存

`aspects/diet/gym-logs/DATE.md` を以下のフォーマットで作成する:

```markdown
# ジムログ YYYY-MM-DD

## 種目名
- 重量: Xkg × Y回 × Zセット

## 種目名
- 重量: Xkg × Y回 × Zセット

メモ: （体感メモがあれば）
```

### 前回比を計算して報告

前回ログと比較し、各種目の重量差を計算して報告する:

```
ジムログを記録しました（YYYY-MM-DD）

| 種目 | 今回 | 前回 | 差 |
|------|------|------|-----|
| フィックスドプルダウン | 40kg | 35kg | +5kg |
| ... | ... | ... | ... |

Notion ジムログDB ✅ / ローカル MD ✅
```

前回ログがない場合は「初回セッションです」と記載する。
