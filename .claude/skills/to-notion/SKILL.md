---
name: to-notion
description: church MDファイル（prayer-requests.md, verses.md, messages/）をNotionに同期するとき。引数: $ARGUMENTS
---

# to:notion — Church ファイル → Notion 同期

church aspect の MD ファイルを対応する Notion ページ・DBに反映する。

## Notion ページ・DB

| ファイル | Notion ID | 種別 |
|---------|-----------|------|
| `aspects/church/prayer-requests.md` | `32dce17f-7b98-810a-a32d-ecdd6a40da78` | ページ（🙏 Prayer Requests） |
| `aspects/church/verses.md` | `32cce17f-7b98-81de-b010-fafa9f408669` | ページ（📖 聖書ハイライト） |
| `aspects/church/messages/*.md` | `339ce17f-7b98-80bf-95df-c3cbfda90046` | DB（メッセージ） |

親ページ（教会）: `328ce17f-7b98-808e-afcd-fe58a1f1fc1f`

## 引数

- 引数なし → 全ファイルを同期
- `prayer` → prayer-requests.md のみ
- `verses` → verses.md のみ
- `messages` → aspects/church/messages/*.md のみ

## サブページ一覧（Prayer Requests のサブページ ID）

| 名前 | Notion ページ ID |
|------|----------------|
| メンバー名 | `<notion-person-id>` |

> 各自のNotionワークスペースのユーザーIDに置き換えること。

## 手順

### prayer-requests.md の同期

メインページはグループ見出し＋サブページ一覧のみ。表やテキスト詳細は書かない。

1. `aspects/church/prayer-requests.md` を読む
2. `notion-fetch` でメインページの現在の子ページ一覧を確認
3. `notion-update-page`（`replace_content`）でメインページを更新

**メインページフォーマット（グループ別サブページ一覧）:**
```
## New Hope Yokohama
<page url="...">Shinya</page>
...（Yokohama メンバー）

## New Hope Tokyo
<page url="...">Nathan</page>
...（Tokyo メンバー）

## 家族
<page url="...">マリヤ</page>
...

## 自分
<page url="...">自分</page>
```

**重要:** `replace_content` 時は既存サブページを `<page url="...">名前</page>` タグで必ず含めること（含めないと削除される）。

4. 各人のサブページを `notion-update-page`（`replace_content`）で更新
   - 対応する `aspects/people/` ファイルを読んで最新の祈り内容・みことばを反映
   - フォーマット: `## プロフィール` + `## 祈り：テーマ（開始日）` + みことば引用 + `## 記録`

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

### messages/*.md の同期

```bash
bun run scripts/notion/notion-sync-messages.ts
```

- `aspects/church/messages/YYYY-MM-DD.md` ファイルを全件 Notion メッセージDB に同期
- 既存エントリは日付で照合し、あれば更新・なければ新規作成
- `--dry-run` でプレビュー、`--date YYYY-MM-DD` で特定日のみ

## 完了後

更新したページを `notion-fetch` で確認し、内容が正しく反映されているか確認する。
