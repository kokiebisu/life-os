# Study DB 設計ドキュメント

**日付:** 2026-03-18
**ステータス:** Draft

---

## 概要

`aspects/study/` の学習管理を Notion DB と連携させる。セッション中に Claude と対話しながらノートを取り、Notion カレンダーに学習記録を残す仕組みを構築する。

---

## Notion DB 構造

**DB名:** Study DB
**環境変数:** `NOTION_STUDY_DB`

| プロパティ | 型 | 必須 | 備考 |
|-----------|---|------|------|
| 名前 | Title | ✅ | 常に「勉強」固定 |
| 日付 | Date | ✅ | 開始〜終了時刻（JST: `+09:00`）。カレンダー表示用 |
| カテゴリ | Select | ✅ | algorithms / system-design / startup / law / tech / other |
| 本 | Text | — | 参照した本のタイトル（任意） |
| Chapter | Text | — | 章・節（任意） |
| ステータス | Status | ✅ | 学習中 / 完了 |

- 登録時に必ずアイコン・カバー画像を付ける
- 日時は必ず `+09:00` を付ける（UTC ずれ防止）

---

## Notion ページ装飾

`notion-update-page` の `replace_content` で以下の構造を書き込む：

```
[Callout] セッション情報
  - 📅 日付・時刻
  - 🏷 カテゴリ
  - 📗 本（あれば）
  - 📌 Chapter（あれば）

[Divider]

## ノート
（学習内容・メモ）

[Divider]

## まとめ
（key takeaways）
```

---

## ローカル MD 構造

**パス:** `aspects/study/{category}/notes/YYYY-MM-DD.md`

```
aspects/study/
  algorithms/notes/YYYY-MM-DD.md
  system-design/notes/YYYY-MM-DD.md
  startup/notes/YYYY-MM-DD.md
  law/notes/YYYY-MM-DD.md
  tech/notes/YYYY-MM-DD.md
  other/notes/YYYY-MM-DD.md
```

**MD フォーマット:**

```markdown
---
notion_id: <page-id>
date: 2026-03-18
start: 14:00
end: 15:00
category: algorithms
book: Cracking the Coding Interview
chapter: Chapter 4 - Trees and Graphs
status: 完了
---

# 勉強 - 2026-03-18

## ノート

（学習内容）

## まとめ

（key takeaways）
```

- Notion ページと同じ構造・内容を MD にも反映する
- `notion_id` で Notion ページと紐付け

---

## `/study` コマンド

**スキルファイル:** `.claude/skills/study.md`

### 引数

```
/study                          # 対話式（カテゴリ・時刻をすべて確認）
/study algorithms               # カテゴリ指定
/study algorithms --start 14:00 # 開始時刻も指定
```

### フロー

1. **情報収集**（未指定のものを確認）
   - カテゴリ（必須）
   - 開始時刻（必須）
   - 終了時刻（任意、未定なら後で更新）
   - 本・Chapter（任意）

2. **重複チェック**
   - `validate-entry.ts` で同日同時刻の重複を確認

3. **Notion 登録**
   - `notion-add.ts --db study` でエントリ作成
   - アイコン・カバー画像を付ける
   - `notion-update-page` の `replace_content` でページ装飾を書き込む

4. **ローカル MD 作成**
   - `aspects/study/{category}/notes/YYYY-MM-DD.md` を作成
   - フロントマターに `notion_id` を記録

5. **セッション開始**
   - 「セッション開始！何を学びますか？」と問いかける
   - 対話しながらノートを随時 Notion + MD に書き込む

6. **セッション終了**
   - 「終わり」等の合図でステータスを「完了」に更新
   - 終了時刻を記録
   - まとめセクションを書き込む

---

## 実装スコープ

### 新規作成

- [ ] Notion Study DB（手動で作成 or `notion-create-database` で作成）
- [ ] `.env` に `NOTION_STUDY_DB` 追加
- [ ] `scripts/notion-add.ts` に `study` DB 対応を追加
- [ ] `.claude/skills/study.md` スキルファイル作成

### 既存ファイル更新

- [ ] `.claude/rules/notion-workflow.md` に Study DB を追記
- [ ] `aspects/study/README.md` に `/study` コマンドの説明を追記

---

## 除外スコープ

- 既存の `roadmap.md` / `algorithms/README.md` の Notion 移行（別タスク）
- `review-log.json` の活用（現状空のまま）
- 複数セッション/日の扱い（同日2回勉強した場合は別ファイルに `-2` suffix で対応）
