---
name: from-notion
description: Notion の変更をリポジトリの md ファイルに逆同期するとき。Notion 上で時間変更・完了マーク・フィードバックをした後に使う。
---

# Sync from Notion

Notion → repo 逆同期。Notion 上の変更（時間変更・完了マーク・フィードバック）をリポジトリのイベントファイルに反映する。

## 自動エンリッチ機能

pull 時に以下を自動検出・補完する:

- **移動時間**: `@ 場所名` を含むイベントの移動時間を自動計算し、Notion の日付・開始時間・終了時間・場所プロパティを更新
- **アイコン・カバー**: 未設定のページにアイコンとカバー画像を自動追加

`--no-enrich` でスキップ可能。dry-run でもエンリッチのプレビューが表示される。

## 重複解決（Conflict Resolution）

pull 後、自動解決された `conflictResolutions` を確認:

- `delete` → `notion-delete.ts` で Notion ページ削除
- `shift` → `notion-update-page` で時間変更
- `shrink` → `notion-update-page` で時間変更

## Steps

1. dry-run でプレビュー → ユーザーに確認
2. 実行
3. 結果報告（追加・更新・保持・エンリッチ件数、フィードバック内容）
4. **Post-sync 重複検証（必須）**: 実行後に `notion-list.ts --date` で当日の全エントリを取得し、以下を確認:
   - 同じ DB 内に食事内容が酷似するエントリがないか（朝食/昼食の名前違い等）
   - 同じ時間帯に同じ DB のエントリが重複していないか
   - 重複があれば即座にユーザーに報告し、不要なエントリを `notion-delete.ts` で削除

## Commands

```bash
# プレビュー
bun run scripts/notion/notion-pull.ts --dry-run

# 実行
bun run scripts/notion/notion-pull.ts

# 特定日
bun run scripts/notion/notion-pull.ts --date $ARGUMENTS --dry-run

# エンリッチなし
bun run scripts/notion/notion-pull.ts --no-enrich
```

## Cross-DB 重複自動解決

`notion-pull.ts` はDB間の時間重複を自動解決する。優先度の高いDBが勝ち、低優先エントリは削除される。

**DB 優先度:** events > todo > routine > meals > groceries

- 手動イベント追加後に `from:notion` → 自動エントリとの重複が解消
- 削除されたルーティンは `notion-sync-schedule.ts` が再配置
- 同じDB内のエントリ同士は重複解決の対象外

## 重複解決ルール（conflictRules）

- **events / todo**: keep（絶対に動かさない）
- **Devotion**: shift（後ろにずらす。削除禁止）
- **meals / groceries**: delete（外食イベントと重複したら削除）
- **routine（その他）**: shift

## notion-pull 対象 DB

| DB        | 同期先ファイル                         |
| --------- | -------------------------------------- |
| events    | `planning/events/YYYY-MM-DD.md`        |
| meals     | `aspects/diet/events/YYYY-MM-DD.md`    |
| groceries | `aspects/shopping/groceries/YYYY-MM-DD.md` |
| todo      | `aspects/tasks.md`（Inbox / Archive） |

- 完了ステータスの判定: `"Done"` or `"完了"` → `[x]` にマーク
- devotion DB のステータスプロパティは `ステータス`（日本語）。`Status`（英語）ではない

## todo DB の Inbox 同期には `notion-sync-tasks.ts` を使う（厳守）

`notion-pull.ts` は**日付範囲フィルタ付き**のため、過去日に完了マークされた Inbox の古いタスクは拾えない。`aspects/tasks.md` の Inbox と Notion todo DB を完全同期したい場合は、全件取得する `notion-sync-tasks.ts` を使う。

```bash
bun run scripts/notion/notion-sync-tasks.ts --dry-run
bun run scripts/notion/notion-sync-tasks.ts
```

## 一括削除直後に `notion-pull.ts` を実行しない（厳守）

`notion-pull.ts` はローカルの既存データからエントリを再作成する。一括削除直後に pull すると削除済みエントリが復活する。

- 一括削除後は先にローカルファイルもクリーンアップしてから pull する
- または `--no-enrich` + 特定日だけ pull するなど影響範囲を限定する
