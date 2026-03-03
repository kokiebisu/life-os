# Calendar Sync ルール

## 睡眠（厳守）
- 目標: 22:00就寝→5:00起床（7h）。理想23:00 / MUST 24:00
- 24:00以降にタスクを配置しない。就寝遅延時は起床もずらす

## 食事（厳守）
- 食事エントリは原則1時間。fridge.md で食材在庫を確認する

## DB 優先度
events > todo > guitar = sound > routine > meals > groceries

## md↔Notion 同期（必須）
- md を変更したら Notion も更新。逆も同様。片方だけで終わらせない
- スケジュール変更後は `notion-list.ts --date` で全エントリを再確認する

## 連鎖チェック（厳守）
- 時間変更時: 前後の予定も連鎖チェック
- 買い出し移動時: その買い出しで調達する食材を使う食事も確認・移動する

## 基本ルール
- 1ブロック=1タスク（「A + B」「A or B」禁止）
- ルーティンを events/ に書かない（routine DB 側で管理）
- events/ = 未来の一回限り予定（行事・集まり）、daily/ = その日の実績記録
- events/ にタスク（手続き・作業）が混在していても、Notion 登録先は内容で判断する（→ todo DB）
- 曜日は `date` コマンドで確認。暗算しない
- キャンセル: Notion は `notion-delete.ts` で完全削除、events/ にキャンセル記録
