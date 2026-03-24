---
name: to-notion
description: church MDファイル（prayer-requests.md, verses.md）をNotionページに同期するとき。引数: $ARGUMENTS
---

# to:notion — Church ファイル → Notion 同期

church aspect の MD ファイルを対応する Notion ページに反映する。

## Notion ページ

| ファイル | Notion ページ ID | ページ名 |
|---------|-----------------|---------|
| `aspects/church/prayer-requests.md` | `32dce17f-7b98-810a-a32d-ecdd6a40da78` | 🙏 Prayer Requests |
| `aspects/church/verses.md` | `32cce17f-7b98-81de-b010-fafa9f408669` | 📖 聖書ハイライト |

親ページ（教会）: `328ce17f-7b98-808e-afcd-fe58a1f1fc1f`

## 引数

- 引数なし → 両ファイルを同期
- `prayer` → prayer-requests.md のみ
- `verses` → verses.md のみ

## 手順

### prayer-requests.md の同期

1. `aspects/church/prayer-requests.md` を読む
2. `notion-update-page`（`replace_content`）で Notion ページを更新

**フォーマット規則:**
- `## Active` セクション: 各人を `### 名前` + `**内容:** ...` + `**開始日:** YYYY-MM-DD` + `---` で区切る
- `## Answered` セクション: そのまま反映（中身なければコメントテキストを保持）
- ページ冒頭の説明文も保持

### verses.md の同期

1. `aspects/church/verses.md` を読む
2. `notion-update-page`（`replace_content`）で Notion ページを更新

**フォーマット規則:**
- `## セクション名` → Notion の `## 使う場面` 見出しとして
- `### 書名 章:節` → `### 書名 章:節`
- 引用 `> ...` → そのまま引用ブロック
- `**使う場面:**` `**ポイント:**` → bold テキスト
- セクション間は `---` で区切る
- 冒頭の説明文を保持

## 完了後

更新したページを `notion-fetch` で確認し、内容が正しく反映されているか確認する。
