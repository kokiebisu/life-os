# エントリー削除（厳守）

エントリを削除するときは**必ず以下の手順を踏む。** 省略・自己判断での削除は禁止。

## 禁止事項

- Notion MCP (`notion-update-page` 等) で直接ステータス変更して削除扱いにすること
- md ファイルだけ、または Notion だけを削除すること
- `notion-delete.ts` を使わずに削除すること

## 必須手順

1. `bun run scripts/notion-delete.ts <id>` で Notion ページを完全削除
2. 対応する md ファイルから該当行を削除
3. 連鎖チェック: 削除対象に依存する予定を確認（買い出し→食事、イベント→関連タスク等）
4. `bun run scripts/cache-status.ts --clear`
5. `bun run scripts/notion-list.ts --date` で削除後の状態を確認
