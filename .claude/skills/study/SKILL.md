---
name: study
description: 学習セッションの開始・ノート記録・Notion登録。引数: $ARGUMENTS
---

# study — 学習セッション管理

## 引数パース

`$ARGUMENTS` を確認する:
- `<カテゴリ>` のみ → そのカテゴリでセッション開始
- `<カテゴリ> --start HH:MM` → カテゴリ + 開始時刻指定
- 引数なし → 対話でカテゴリを確認する

カテゴリ選択肢: `algorithms` / `system-design` / `startup` / `law` / `tech` / `other`

---

## Step 1: 情報収集

未指定の情報をユーザーに確認する（一度にまとめて確認してよい）:

1. **カテゴリ**（必須）: algorithms / system-design / startup / law / tech / other
2. **開始時刻**（必須）: `TZ=Asia/Tokyo date` で現在時刻を確認し、未指定ならユーザーに確認
3. **終了時刻**（任意）: 未定なら「後で更新」として進める
4. **本**（任意）: 参照する本のタイトル
5. **Chapter**（任意）: 章・節

---

## Step 2: 重複チェック

```bash
TZ=Asia/Tokyo date +%Y-%m-%d  # 今日の日付を確認
bun run scripts/validate-entry.ts --date YYYY-MM-DD --title "勉強" --start HH:MM --end HH:MM --db study
```

- **終了コード 1**（類似エントリあり）→ 既存エントリの内容を `notion-fetch` で確認してユーザーに提示し、以下を確認する:
  - **上書き**: 既存エントリを削除して新規作成
  - **追記**: 既存エントリのノートに追記する形で継続（Step 3 をスキップして既存 notion_id を使う）
- **終了コード 0** → 次のステップへ

---

## Step 3: Notion 登録（2ステップ）

### Step 3a: `notion-add.ts` でページ作成

```bash
bun run scripts/notion-add.ts --title "勉強" --date YYYY-MM-DD --start HH:MM --end HH:MM --db study
```

出力から page ID を取得する（Notion API で当日の study DB を query して最新エントリの ID を取得）:

```bash
bun -e "
const { getApiKey, loadEnv } = await import('./scripts/lib/notion.ts');
const apiKey = getApiKey();
const env = loadEnv();
const dbId = env['NOTION_STUDY_DB'];
const res = await fetch('https://api.notion.com/v1/databases/' + dbId + '/query', {
  method: 'POST',
  headers: { 'Authorization': 'Bearer ' + apiKey, 'Notion-Version': '2022-06-28', 'Content-Type': 'application/json' },
  body: JSON.stringify({ page_size: 1, sorts: [{ timestamp: 'created_time', direction: 'descending' }] }),
});
const data = await res.json();
console.log(data.results[0]?.id);
"
```

### Step 3b: `notion-update-page` でプロパティ + ページ本文を設定

Notion MCP の `notion-update-page` を使って以下を設定する（page_id は Step 3a で取得した ID）:

**プロパティ設定:**
```
select:カテゴリ: <カテゴリ名>
select:本: <本のタイトル>  (あれば)
rich_text:Chapter: <章・節>  (あれば)
cover:
  type: "external"
  external.url: "https://www.notion.so/images/page-cover/gradients_8.png"
```

**ページ本文（`replace_content`）:**

```
[callout] 📚
テキスト: 📅 YYYY-MM-DD  HH:MM → HH:MM  |  🏷 {カテゴリ}  |  📗 {本}（あれば）  |  📌 {Chapter}（あれば）

[divider]

[heading_2] 🎯 今日の目標・疑問

[paragraph] （ユーザーから聞いた目標・疑問をここに書く）

[divider]

[heading_2] 📝 ノート

[paragraph] （セッション中に追記）

[divider]

[heading_2] 🔑 キーワード

[paragraph] （重要用語・概念）

[divider]

[heading_2] 💡 まとめ

[paragraph] （セッション終了時に記入）

[divider]

[heading_2] ❓ 残った疑問・次回へ

[paragraph] （理解できなかった点、次のセッションで深めたいこと）
```

---

## Step 4: ローカル MD を作成する

### ファイルパスの決定

- 本あり: `aspects/study/{category}/notes/YYYY-MM-DD-{book-slug}.md`
- 本なし: `aspects/study/{category}/notes/YYYY-MM-DD.md`
- 同日同カテゴリ同本で既存ファイルがある場合: `-2.md`、`-3.md` と連番

book-slug ルール: タイトルを小文字ケバブケースに変換（例: `cracking-the-coding-interview`）

### MD 内容

```markdown
---
notion_id: <page-id>
date: YYYY-MM-DD
start: HH:MM
end: HH:MM
category: <カテゴリ>
book: <本のタイトル>
chapter: <Chapter>
---

# 勉強 - YYYY-MM-DD

## 🎯 今日の目標・疑問

<ユーザーから聞いた目標・疑問>

## 📝 ノート

（セッション中に追記）

## 🔑 キーワード

（重要用語・概念）

## 💡 まとめ

（セッション終了時に記入）

## ❓ 残った疑問・次回へ

（理解できなかった点、次のセッションで深めたいこと）
```

### キャッシュクリア

```bash
bun run scripts/cache-status.ts --clear
```

---

## Step 5: セッション開始

ユーザーに伝える:

```
セッションを開始しました 📖
📅 YYYY-MM-DD  HH:MM〜
🏷 {カテゴリ}  📗 {本}（あれば）

今日の目標・疑問は何ですか？
```

ユーザーの回答を受け取り、MD と Notion の「🎯 今日の目標・疑問」セクションに書き込む。

---

## Step 6: 対話セッション（ノート取り）

- ユーザーの質問・学習内容に答えながら、**会話の要点を Claude が整理して MD の「📝 ノート」に随時書き込む**
- 重要な用語・概念が出たら「🔑 キーワード」にも追記する
- Notion への書き込み: ノートが一定量溜まったとき、またはユーザーが「メモして」「Notionに書いて」と言ったとき
- Notion 書き込みには `notion-update-page`（`replace_content`）を使い、MD の内容全体を反映する（差分ではなく全文置き換え）

**同期ルール（厳守）:**
- MD と Notion の内容は常に一致させる
- Notion に書き込んだ後、MD も同じ内容に更新する（逆も同様）
- 片方だけの更新で終わらせない

---

## Step 7: セッション終了

「終わり」「完了」「終了」「おわり」「セッション終了」のいずれかが来たら:

1. **終了確認をする**:
   ```
   セッションを終了してよいですか？まとめと残った疑問を一緒に整理してから閉じます。
   ```

2. ユーザーが確認したら、まとめと残った疑問を一緒に作成する:
   - 「今日学んだことを3点でまとめると？」などと問いかけて内容を引き出す
   - Claude がまとめ文を作成してユーザーに確認してもらう

3. **MD を最終内容で更新する** （終了時刻 + まとめ + 残った疑問）

4. **Notion に最終内容を同期する** (`notion-update-page` の `replace_content` で MD 全体を反映)
   - 終了時刻も更新: `date:日付:end: YYYY-MM-DDThh:mm:00+09:00`

5. **キャッシュクリア**:
   ```bash
   bun run scripts/cache-status.ts --clear
   ```

6. **完了報告**:
   ```
   セッション終了 ✅

   📅 YYYY-MM-DD  HH:MM〜HH:MM
   🏷 {カテゴリ}  📗 {本}（あれば）

   Notion ✅ / ローカル MD ✅
   📄 aspects/study/{category}/notes/{filename}.md
   ```
