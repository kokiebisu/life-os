# Calendar

Notion カレンダーの予定を取得・追加する。

## 予定の取得

```bash
bun run scripts/notion-list.ts                    # 今日の予定
bun run scripts/notion-list.ts --days 7           # 今後7日間
bun run scripts/notion-list.ts --date 2026-02-14  # 指定日
bun run scripts/notion-list.ts --json             # JSON出力
```

## 予定の追加

```bash
bun run scripts/notion-add.ts --title "タイトル" --date YYYY-MM-DD --start HH:MM --end HH:MM
bun run scripts/notion-add.ts --title "タイトル" --date YYYY-MM-DD --allday
```

説明はページ作成後に `notion-update-page` の `replace_content` で本文に書く。

## Steps

1. ユーザーの要望を確認（取得 or 追加）
2. 適切なスクリプトを実行
3. 結果をわかりやすく表示

## デイリープラン作成時の DB 使い分け

デイリープランのルーティンを Notion に登録するとき、**各項目は適切な DB に振り分ける:**

| 項目 | DB | 理由 |
|------|-----|------|
| 食事（朝食・昼食・夕食） | meals | 週次献立（`aspects/diet/weekly/`）からメニュー名・kcal を取得してタイトルに反映 |
| ギター練習 | guitar | カリキュラム（`aspects/guitar/phase*/`）から次のレッスンを取得してタイトルに反映 |
| 買い出し・買い物 | groceries | 食材・日用品の買い出し。meals DB には入れない |
| それ以外のルーティン | routine | 通常のルーティン |

- **食事**: 「朝食」「昼食」「夕食」ではなく、献立名で登録する（例: `ツナとアボカドのサラダ丼`）。週次献立ファイルから該当日のメニューを参照する
- **ギター**: 「ギター練習」ではなく、具体的なレッスン名で登録する（例: `Lesson 3: インターバルを指板で使いこなす（瀬戸）`）

## スケジュールの好み

### ブロック間のバッファ（推奨）

- デイリープランを作るとき、**各ブロックの間に 15 分程度のバッファを入れる**
- 朝のルーティン（Devotion→シャワー→朝食）も含めて全ブロック間にバッファを入れる
- 外出を伴う予定（ジム見学・買い物等）の前後は余裕を持たせる
- バッファなしでびっしり詰めない

### 買い出し後の下準備ブロック（必須）

- 買い出しをスケジュールに入れるとき、**直後に「食材整理・下準備」（30分）も必ずセットで入れる**
- DB は groceries（買い出しDB）に登録する
- ページ本文にチェックリスト（to_do ブロック）を書き込む（空ページ禁止）
- チェックリストの内容: 冷蔵/冷凍/常温の仕分け、冷凍食材の小分け、当日の食材取り出し、炊飯等
- 買い出しだけ登録して下準備を忘れない

### 食事の時間（必須）

- 食事ブロックは**1時間**で確保する（30分は短すぎる）
- 調理＋食事＋片付けを含めてゆとりを持たせる

### ルーティンの頻度目安

| ルーティン | 頻度 | 備考 |
|-----------|------|------|
| 投資リサーチ | 週1回 | 毎日入れなくてよい |

## Feedback の永続反映

Notion タスクに Feedback がある場合、**次回同種のタスク作成時に必ず反映する。**

1. タスク完了時に Feedback を確認
2. 該当 aspect の `CLAUDE.md` に学びとして蓄積
3. 次回同じタスクを立てるとき、過去の Feedback を踏まえた内容にする

## ご飯イベント翌日の朝スケジュール調整

前日に**ご飯のイベント**（飲み会・食事会・新年会など）がある日は、翌朝のスケジュールを以下のように調整する:

1. **Devotion を 7:30-8:30 に変更**（通常より遅めスタート）
2. **朝シャワーを 8:30-9:00 に変更**（Devotion の直後）
3. **朝食を 9:00-10:00 に変更**（朝食は必ず1時間確保）
4. **後続エントリの連鎖調整** — 朝食以降に重複が発生する場合、後続のエントリを臨機応変にずらす
5. **収まらない場合は一旦外す** — タスクが多すぎて午前中に収まらない場合、優先度の低いタスクを別の日に移動するか一旦外す

**ご飯イベントの判定基準:**
- タイトルに「ご飯」「飲み会」「新年会」「食事」等が含まれる
- 夕方〜夜の時間帯（概ね18:00以降）に開催される外食・会食イベント

## 日曜・音響当番の日はスケジュールを前倒しする

音響当番（サウンドチーム）の日は教会に **9:00** 到着が必要（通常は13:00）。デイリープラン作成時:

- 起床・シャワー・朝食をすべて前倒しする（朝食は遅くとも 8:00 までに終える）
- 音響当番かどうかはユーザーに確認する（毎週ではない）
- 通常の日曜（13:00〜）と音響当番の日曜（9:00〜）で教会の時間枠が異なることに注意

## スケジュール変更時の全プロパティ更新（厳守）

時間変更時は関連するすべてのフィールドを漏れなく更新する:
1. Notion `日付` プロパティ（start/end）
2. Notion `開始時間`・`終了時間` プロパティ
3. md ファイルの時間表記
4. 更新後に `notion-fetch` で全プロパティ一致を確認

## 曜日の明示的確認（必須）

```bash
TZ=Asia/Tokyo date -d "2026-02-22" "+%Y-%m-%d (%a)"
```

報告時は「2/22（日）」のように曜日を併記する。

## 突き合わせチェック（スケジュール会話の区切りで実行）

1. 影響した日を列挙
2. 各日の `notion-list.ts --date YYYY-MM-DD --json` で Notion 全エントリ取得
3. daily ファイルの全食事・タスクと突き合わせ
4. 差分があれば修正（md→Notion / Notion→md 両方向）

## md 編集後の Notion 同期チェック

1. 対応する Notion エントリが存在するか？
2. 存在しない → `notion-add.ts` で新規作成
3. 存在する → `notion-update-page` で更新

## Notion 操作の安全ルール

### ページ本文の上書き禁止（厳守）

- `replace_content` でページ全体を上書きしない。既存コンテンツが消える
- ページ更新時はまず `notion-fetch` で既存内容を確認する
- 部分変更は `replace_content_range` または `insert_content_after` を使う
- `replace_content` は新規作成直後の空ページにのみ使う

### Notion ページ ID の取り違え防止

- 複数エントリ一括更新時は、更新前に ID→タイトルの対応表を書き出して確認する
- JSON 出力から ID を拾うときは必ずタイトルとセットで扱う

### スクリプト実行前に構文を確認する

- `notion-add.ts` 等を呼ぶ前に、必ず正しい引数形式を使う（`--title` 必須）
- 間違った構文で試行錯誤しない — 誤実行が副作用を起こすリスクがある

### `notion-list.ts` の日付フィルタはタイムゾーンバグあり（厳守）

`notion-list.ts` の `queryDbByDate` は JST 早朝のエントリを取りこぼすことがある。正確性が必要な場面では直接 Notion API で検証する:

```bash
bun -e '
const dbId = process.env.NOTION_DEVOTION_DB; // or MEALS_DB etc.
const apiKey = process.env.NOTION_API_KEY;
const res = await fetch("https://api.notion.com/v1/databases/" + dbId + "/query", {
  method: "POST",
  headers: { "Authorization": "Bearer " + apiKey, "Notion-Version": "2022-06-28", "Content-Type": "application/json" },
  body: JSON.stringify({ filter: { property: "日付", date: { on_or_after: "2026-02-24T15:00:00Z" } }, page_size: 100 })
});
const data = await res.json();
const entries = data.results.map((p) => ({
  id: p.id,
  title: (p.properties["名前"] || p.properties["Name"])?.title?.[0]?.plain_text || "",
  start: p.properties["日付"]?.date?.start || ""
}));
console.log(JSON.stringify(entries, null, 2));
'
```

- JST `YYYY-MM-DD` → UTC `前日T15:00:00Z` を `on_or_after` に指定
- `notion-list.ts` の結果が 0 件でも「本当にない」と断言しない

### 実行後に必ず結果を検証する

- `notion-add.ts` 後、`notion-list.ts --date` で同じ日の全エントリを確認
- 既存エントリが意図せず消えていないか確認する
