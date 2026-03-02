# Cleanup - 未完了エントリの整理

過去数日分（デフォルト: 3日間）の未完了エントリをまとめて整理する。

## Steps

1. **対象期間のエントリを取得する**
   ```bash
   # デフォルト: 過去3日分を一括取得
   for i in 1 2 3; do
     bun run scripts/notion-list.ts --date $(TZ=Asia/Tokyo date -d "$i days ago" +%Y-%m-%d) --json
   done

   # 引数で日付指定（その日のみ）
   bun run scripts/notion-list.ts --date $ARGUMENTS --json
   ```

2. **未完了エントリを抽出する**
   - ステータスが「完了」「Done」**以外**のものを抽出
   - 完了済みエントリは無視する
   - 日付ごとにグループ化して見やすく表示する

3. **カテゴリ別に整理方針を決める**

   | DB | 方針 | 理由 |
   |----|------|------|
   | routine | 削除 | スケジュール同期が再配置する |
   | meals | 削除 | 過去の食事は不要 |
   | guitar | 削除（日付クリア） | カリキュラムは次回同期時に再配置 |
   | todo | 今日に移動（終日） | やるべきことは持ち越す |
   | events | ユーザーに確認 | キャンセル or 別日に移動 |
   | groceries | 削除 | 過去の買い出しは不要 |

4. **整理方針をユーザーに提示して確認を取る**
   - 全日分をまとめて一覧で見せる
   - events がある場合は個別に対応を確認する
   - todo が複数日に分散していても、まとめて今日に移動する提案をする

5. **実行する**
   - routine / meals / groceries の削除:
     ```bash
     bun run scripts/notion-delete.ts <page-id1> <page-id2> ...
     ```
   - guitar の日付クリア: `notion-update-page` で日付を null に
   - todo の移動: `notion-update-page` で日付を今日に変更（終日）
   - events: ユーザーの指示に従う

6. **結果を確認する**
   ```bash
   # 今日のエントリに移動分が反映されていることを確認
   bun run scripts/notion-list.ts --date $(TZ=Asia/Tokyo date +%Y-%m-%d)
   ```

7. **結果を報告する**
   - 削除件数・移動件数をサマリで報告

## 引数

- `$ARGUMENTS` が空 → 過去3日分（昨日・一昨日・3日前）をまとめて整理
- `$ARGUMENTS` が日付（YYYY-MM-DD） → その日のみを対象にする

## 注意

- 完了済みエントリには触らない
- guitar DB のエントリは削除ではなく日付クリア（Lesson ページは再利用するため）
- todo を移動するとき、時間指定は外して終日にする（今日のスケジュールで改めて配置）
- 同じ todo が複数日に跨って未完了のまま残っている場合、重複移動しないよう ID で管理する

## 予定キャンセル時

1. **Notion**: `notion-delete.ts` でページごと完全削除
2. **イベントファイル**: キャンセルセクションに記録を残す

## 一括削除後は代替エントリを登録する（厳守）

- カリキュラム改訂・入れ替え等で複数ページを削除した場合、削除だけで完了扱いにしない
- 新しいエントリを Notion に登録するまでがセット
- 削除後に `notion-list.ts` で対象 DB が空なら登録漏れの可能性が高い

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
