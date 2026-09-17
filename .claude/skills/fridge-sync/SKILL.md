---
name: fridge-sync
description: fridge.md（冷蔵庫在庫）を Notion の「冷蔵庫の在庫」ページに同期するとき。「冷蔵庫同期して」「fridge 更新して」に使う。
---

# Fridge Sync - 冷蔵庫在庫を Notion に同期

`aspects/diet/fridge.md` の内容を Notion の「冷蔵庫の在庫」ページに反映する。

## Notion ページ ID

`328ce17f-7b98-8123-be6b-e0bacfc7622e`

## 手順

1. `aspects/diet/fridge.md` を読む
2. テーブル部分を Notion Markdown 形式に変換
3. `notion-update-page`（`replace_content`）でページ本文を丸ごと置き換える

内容フォーマット:

```
> 最終更新: YYYY-MM-DD
> 買い出し後・消費後に更新する。献立・買い出しリスト作成時に参照。

| 食材 | 数量 | 備考 |
| --- | --- | --- |
| ... | ... | ... |

> その他の調味料 → pantry.md を参照
```

## 注意

- ページ ID 行（`Notion ページ ID:`）はテーブルに含めない
- 同期後に「Notion に反映しました」と1行報告する
