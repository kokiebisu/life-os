# Study DB 設計ドキュメント

**日付:** 2026-03-18
**ステータス:** Draft v3

---

## 概要

`aspects/study/` の学習管理を Notion DB と連携させる。セッション中に Claude と対話しながらノートを取り、Notion カレンダーに学習記録を残す仕組みを構築する。1 Notion ページ = 1章のイメージで管理する。

---

## Notion DB 構造

**DB名:** Study DB
**環境変数:** `NOTION_STUDY_DB`

| プロパティ | 型 | 必須 | 備考 |
|-----------|---|------|------|
| 名前 | Title | ✅ | 常に「勉強」固定 |
| 日付 | Date | ✅ | 開始〜終了時刻（JST: `+09:00`）。カレンダー表示用 |
| カテゴリ | Select | ✅ | algorithms / system-design / startup / law / tech / other |
| 本 | Select | — | 参照した本（任意）。既存の選択肢から選ぶか新規追加 |
| Chapter | Text | — | 章・節（任意） |

- 登録時に必ずアイコン（📖）・カバー画像（Notion ネイティブの単色またはグラデーション）を付ける
- 日時は必ず `+09:00` を付ける（UTC ずれ防止）
- ステータスプロパティは持たない（セッション完了 = ページにノートが書かれた状態で十分）

### `ScheduleDbConfig` マッピング

`scripts/lib/notion.ts` の `ScheduleDbName` 型と `SCHEDULE_DB_CONFIGS` に以下を追加：

```typescript
// ScheduleDbName に追加
type ScheduleDbName = ... | 'study'

// SCHEDULE_DB_CONFIGS に追加
study: {
  envKey: 'NOTION_STUDY_DB',
  titleProp: '名前',
  dateProp: '日付',
  descProp: '',
}
```

---

## カスタムプロパティの設定方法

`notion-add.ts` は `titleProp` / `dateProp` のみ対応。`カテゴリ`（Select）・`本`（Select）・`Chapter` は `notion-add.ts` では設定できないため、以下の2ステップで登録する：

1. `notion-add.ts --db study --start HH:MM --end HH:MM` でページ作成（名前・日付のみ）
2. `notion-update-page` で `カテゴリ`・`本`・`Chapter` プロパティを設定 + ページ本文を書き込む

---

## Notion ページ装飾

カバー画像は Notion ネイティブの単色またはグラデーション（例: `"type": "external"` ではなく Notion カラーカバー）を使用。

`notion-update-page` の `replace_content` で以下の構造を書き込む：

```
[Callout 📚] セッション情報
  - 📅 日付・時刻（例: 2026-03-18 14:00 → 15:00）
  - 🏷 カテゴリ（例: algorithms）
  - 📗 本（あれば）
  - 📌 Chapter（あれば）

[Divider]

[Heading 2] 🎯 今日の目標・疑問
（このセッションで答えたいこと。セッション開始時に記入）

[Heading 2] 📝 ノート
（対話内容・学習内容をリアルタイムで追記）

[Heading 2] 🔑 キーワード
（重要用語・概念をリスト形式で）

[Heading 2] 💡 まとめ
（key takeaways。セッション終了時に記入）

[Heading 2] ❓ 残った疑問・次回へ
（理解できなかった点、次のセッションで深めたいこと）
```

このフォーマットはコーネルノート式（東大ノート術）に基づく：疑問を先に立て → ノートを取り → キーワードで整理 → まとめで定着 → 残った疑問で次回につなぐ。

---

## ローカル MD 構造

**パス:** `aspects/study/{category}/notes/YYYY-MM-DD-{book-slug}.md`

- 本がない場合: `YYYY-MM-DD.md`
- 同日・同カテゴリ・同本で複数セッション: `YYYY-MM-DD-{book-slug}-2.md`

**book-slug ルール:** 本のタイトルを小文字ケバブケースに変換（例: `cracking-the-coding-interview`、`system-design-interview`）

```
aspects/study/
  algorithms/notes/
    2026-03-18-cracking-the-coding-interview.md
    2026-03-18-cracking-the-coding-interview-2.md  ← 同日2回目
  system-design/notes/
    2026-03-18-system-design-interview.md
    2026-03-18.md                                  ← 本なしの場合
  startup/notes/
  law/notes/
  tech/notes/
  other/notes/
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
---

# 勉強 - 2026-03-18

## 🎯 今日の目標・疑問

（このセッションで答えたいこと）

## 📝 ノート

（対話内容・学習内容）

## 🔑 キーワード

（重要用語・概念）

## 💡 まとめ

（key takeaways）

## ❓ 残った疑問・次回へ

（理解できなかった点、次のセッションで深めたいこと）
```

- Notion ページと同じ構造・内容を MD にも反映する（乖離させない）
- `notion_id` で Notion ページと紐付け

---

## md ↔ Notion 同期ルール

- セッション中にノートを書いたら **MD と Notion の両方に書く**（片方だけにしない）
- Notion への書き込みは `notion-update-page`（`replace_content`）で MD の内容をそのまま反映する
- セッション終了時に最終的な内容で両方を同期し、一致した状態で終わる
- 乖離が検知された場合（ユーザーが直接 Notion 編集した等）は、どちらを正とするか確認してから同期する

---

## `/study` コマンド

**スキルファイル:** `.claude/skills/study/SKILL.md`

### 引数

```
/study                          # 対話式（カテゴリ・時刻をすべて確認）
/study algorithms               # カテゴリ指定
/study algorithms --start 14:00 # 開始時刻も指定
```

### フロー

1. **情報収集**（未指定のものを確認）
   - カテゴリ（必須）: algorithms / system-design / startup / law / tech / other
   - 開始時刻（必須）
   - 終了時刻（任意、未定なら後で更新）
   - 本・Chapter（任意）

2. **重複チェック**
   - `validate-entry.ts` で同日同時刻の重複を確認
   - 重複が見つかった場合：既存エントリの内容を表示し、「上書き」または「追記」を確認してから進む
     - **上書き**: 既存ページの内容を新しいセッションで置き換える
     - **追記**: 既存ページの「📝 ノート」セクションに追記する形で継続

3. **Notion 登録**（2ステップ）
   - `notion-add.ts --db study --start HH:MM --end HH:MM` でページ作成
     - アイコン（📖）は `notion-add.ts` が「勉強」タイトルから自動設定するため追加不要
   - `notion-update-page` で `カテゴリ`・`本`・`Chapter` プロパティ + カバー画像（単色/グラデーション）を設定
   - `notion-update-page`（`replace_content`）でページ装飾テンプレートを書き込む

4. **ローカル MD 作成**
   - `aspects/study/{category}/notes/YYYY-MM-DD-{book-slug}.md` を作成
   - フロントマターに `notion_id` を記録
   - `bun run scripts/cache-status.ts --clear` を実行

5. **セッション開始**
   - 「今日の目標・疑問は何ですか？」と確認し、MD・Notion のテンプレートに書き込む
   - 対話しながら、**Claude が会話内容を要約・整理して MD と Notion に随時書き込む**
   - Notion への書き込み: ノートが一定量溜まったタイミング（区切り）または「メモして」の合図で実行
   - MD への書き込み: より頻繁に（各応答後）更新

6. **セッション終了**
   - 「終わり」「完了」「終了」「おわり」「セッション終了」のいずれかでセッション終了とみなす
   - **必ず確認する**:「セッションを終了してよいですか？まとめと残った疑問を書いてから閉じます。」
   - ユーザーが確認後、まとめ・残った疑問を一緒に作成
   - 終了時刻を更新
   - MD・Notion 両方を最終内容で同期
   - `bun run scripts/cache-status.ts --clear`

---

## 実装スコープ

### 新規作成

- [ ] Notion Study DB（`notion-create-database` または手動で作成）
- [ ] `.env` に `NOTION_STUDY_DB` を追加
- [ ] `.claude/skills/study.md` スキルファイル作成
- [ ] `aspects/study/` — `startup/notes/`, `law/notes/`, `tech/notes/`, `other/notes/` ディレクトリを作成（`algorithms/` と `system-design/` は既存）

### 既存ファイル更新

- [ ] `scripts/lib/notion.ts` — `ScheduleDbName` に `study` を追加、`SCHEDULE_DB_CONFIGS` にエントリ追加
- [ ] `scripts/validate-entry.ts` — `DB_LABELS` に `study: '学習'` を追加（重複チェック自体は `SCHEDULE_DB_CONFIGS` 追加で自動対応）
- [ ] `.claude/rules/notion-workflow.md` — Study DB を Schedule DB テーブルと「重複バリデーション」対象リスト（`study`）に追記
- [ ] `aspects/study/README.md` — 「学習セッションの記録」セクションを追加し `/study` コマンドの説明を記載

---

## 除外スコープ

- 既存の `roadmap.md` / `algorithms/README.md` の Notion 移行（別タスク）
- `review-log.json` の活用（現状空のまま）
