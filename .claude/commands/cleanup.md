# Cleanup - 過去の未完了エントリ整理

過去の未完了エントリを全て洗い出し、routine は自動削除、それ以外は1件ずつ対話的に処理する。

## Steps

1. **過去の未完了エントリを取得する**
   ```bash
   # 全期間の過去未完了
   bun run scripts/notion-cleanup.ts

   # 日付指定の場合
   bun run scripts/notion-cleanup.ts --date $ARGUMENTS
   ```

1.5. **日付なし・未完了のエントリを確認する**（厳守）
   ```bash
   bun run scripts/notion-cleanup.ts --no-date
   ```
   - guitar/sound のレッスン・routine エントリは日付なしが正常なのでスキップ
   - **todo/events で日付なしのエントリがあれば1件ずつ対話的に処理する**
   - 「ブロック中」は基本そのまま残す（ユーザーに確認してから削除）
   - この手順をスキップしない

2. **routine エントリを自動削除する**
   - source が `routine` のエントリを全て抽出
   - `notion-delete.ts` で一括削除
   - 削除したエントリ名と件数を報告
   ```bash
   bun run scripts/notion-delete.ts <routine-id1> <routine-id2> ...
   ```

3. **残りのエントリを1件ずつ対話的に処理する**
   - 日付が古い順に1件ずつ提示する
   - 各エントリについて以下を表示:
     - DB名（events/todo/meals/groceries/guitar/sound）
     - タイトル
     - 日付
     - ステータス
   - 選択肢を提示（推奨を明記する）:
     1. 削除（guitar/sound の場合は日付クリア）
     2. 今日に移動
     3. 別日に移動（日付を聞く）
     4. 完了にする
   - DB種別に応じた推奨:
     - meals → 削除を推奨（過去の食事は不要）
     - groceries → 削除を推奨（過去の買い出しは不要）
     - todo → 今日に移動を推奨（やるべきことは持ち越す）
     - events → 削除を推奨（過去のイベントは不要）
     - guitar/sound → 削除（日付クリア）を推奨

4. **各エントリの処理を実行する**
   - 削除: `bun run scripts/notion-delete.ts <page-id>`
   - 日付クリア（guitar/sound）: `notion-update-page` で日付を null に
   - 今日に移動: `notion-update-page` で日付を今日（終日）に変更
   - 別日に移動: `notion-update-page` で指定日（終日）に変更
   - 完了にする: `notion-update-page` でステータスを完了に変更

5. **キャッシュをクリアする**
   ```bash
   bun run scripts/cache-status.ts --clear
   ```

6. **結果サマリを報告する**
   - 削除○件、移動○件、完了○件
   - 今日のエントリを表示して確認:
   ```bash
   bun run scripts/notion-list.ts --date $(TZ=Asia/Tokyo date +%Y-%m-%d)
   ```

## 引数

- `$ARGUMENTS` が空 → 全期間の過去未完了
- `$ARGUMENTS` が日付（YYYY-MM-DD） → その日のみ対象

## 注意

- 完了済みエントリには触らない
- guitar/sound の「削除」は日付クリア（Lesson ページは再利用するため）
- todo を移動するとき、時間指定は外して終日にする
- 全件必ず処理する（スキップなし）
- routine は自動削除（ユーザー確認不要）

## tasks.md との同期

- todo を「完了にする」場合、`planning/tasks.md` に対応エントリがあれば `[x]` に変更して Archive に移動
- todo を「削除」する場合、`planning/tasks.md` の対応エントリも削除

## 予定キャンセル時

1. Notion: `notion-delete.ts` でページごと完全削除
2. イベントファイル: キャンセルセクションに記録を残す

## Recurring（定期タスク）

`planning/tasks.md` の `## Recurring` セクションに定期タスクのテンプレートを定義する。

**フォーマット:**
```markdown
- タスク名 | 頻度 | タイミング
```

**頻度の種類:**
- `monthly` — 毎月（例: `monthly | 20日`）
- `weekly` — 毎週（例: `weekly | 月曜`）
- `biweekly` — 隔週（例: `biweekly | 金曜`）

**ルール:**
- daily script が該当日にマッチしたら Inbox に `- [ ]` として自動コピー + Notion todo DB に登録
- Recurring セクションのエントリは完了しても消さない（テンプレートとして残る）
- 会話中にユーザーが定期タスクを言ったら Recurring に追加する（Inbox ではなく）
- 初回は直近の該当日分を Inbox にも追加しておく

## 完了タスクの Archive（daily で実行）

1. **Notion Calendar を確認** — 完了マークがついたタスクを検出
2. **Inbox の該当タスクを `- [x]` に変更**
3. **`## Archive` セクションに月別で移動**

Archive のフォーマット:
```markdown
## Archive

### 2026-02

- [x] 確定申告の書類を準備する (2026-02-12) #planning
- [x] ジムのロッカーの使い方を確認する (2026-02-12) #diet
```
