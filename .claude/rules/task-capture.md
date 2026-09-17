# Task Capture（タスク自動キャプチャ）

## ルール

会話中にユーザーが「やるべきこと」「やりたいこと」を言ったら、**自動で `aspects/tasks.md` の Inbox に追加する。**

### タスクと判断する基準

- 「〜しなきゃ」「〜やらないと」「〜する必要がある」
- 「〜買わないと」「〜確認しておく」「〜連絡する」
- 「〜調べたい」「〜申し込む」「〜予約する」
- 明らかにアクションが必要な発言全般
- ただし、今この会話の中で完結する作業（「このファイル編集して」等）はタスクではない

### イベント（タスクではない → `aspects/events/` へ）

- 飲み会・会議・予定など「日時が決まっているスケジュール」はイベント
- `aspects/events/YYYY-MM-DD.md` に追加
- **Notion events DB にも必ず登録する**（`notion-add.ts --db events --start HH:MM --end HH:MM`）。説明が必要なら作成後に `notion-update-page` の `replace_content` でページ本文に書き込む
- `aspects/tasks.md` には入れない

### 買いたいもの（タスクではない → `aspects/shopping/stores/` へ）

「〇〇で〜買いたい」「〇〇の〜が欲しい」などの発言は、**`tasks.md` ではなく `aspects/shopping/stores/` で管理する。**

1. Web Search で商品を調べる（価格・商品ページURL・画像URL）
2. 該当店舗の `aspects/shopping/stores/店舗名.md` に追記する（ファイルがなければ新規作成）
3. Notion ショッピング DB（`51f39ff99e804451a4f17d60f6869755`）にレコードを作成する
   - `notion-create-pages` で商品名・店舗・価格・URLをプロパティにセット
   - カバー画像に商品画像URLをセット
   - ページ本文にも商品画像を `![]()` で埋め込む
4. `tasks.md` には**入れない**

> 食材・食品の買い出しは `aspects/shopping/groceries/` で管理する（`/kondate` 経由）。`stores/` には入れない。

### 今日・明日など日付が明示された買い出し（タスクではない → Notion 当日スケジュールへ）

「今日〇〇買いに行きたい」「明日〇〇に行く」など**日付が明示された行動**は、`tasks.md` ではなく **`notion-add.ts` で当日の Notion スケジュールに直接登録する。**

- DB は内容で判断（買い出し → `--db groceries` / 外出・用事 → `--db events`）
- 時間未指定の場合は**当日の Notion スケジュールを確認し、文脈に合った最適なスロットを入れる**（`notion-list.ts --date` で既存予定を取得してから判断する）
  - 外出予定がすでにある → その前後に寄せて動線を合わせる
  - 空き時間が多い → 無理なく過ごせる午後帯に配置する
  - ジム・面接など動けない予定がある → それを避けて入れる
- `tasks.md` には入れない

### タスクと判断しないもの

- イベント・予定（上記参照）
- 買いたいもの（上記参照）
- 会話中に Claude に依頼して、その場で完了するもの
- 単なる感想・雑談
- 既に `tasks.md` に存在するもの（重複しない）
- レッスン内容・カリキュラムの学習トピック・CLAUDE.md の「次の課題」（ユーザー自身の発言ではない）

### 追加フォーマット

```markdown
- [ ] タスク内容 (YYYY-MM-DD)
```

- 日付はキャプチャした日
- 期限がわかる場合は `📅 YYYY-MM-DD` を末尾に追加
- aspect が明確なら `#aspect名` タグをつける

例:
```markdown
- [ ] 確定申告の書類を準備する (2026-02-12) #planning
- [ ] ジムのロッカーの使い方を確認する (2026-02-12) #diet 📅 2026-02-14
```

### 動作

1. タスクを検出したら `aspects/tasks.md` の `## Inbox` セクション末尾に追加
2. **Notion todo DB にも登録する**（`notion-add.ts --db todo --start HH:MM --end HH:MM`）。時間はユーザーに確認するか、文脈から適切に設定する。説明が必要なら作成後に `notion-update-page` の `replace_content` でページ本文に書く
3. ユーザーに「タスクに追加しておいた」と軽く報告（1行で十分）
4. 会話の流れを止めない。メインの話題を優先する

### 既存タスクの編集（厳守）

タスクの内容を変更（説明追加・タイトル変更・ステータス変更等）したら、**md と Notion の両方を更新する。** 片方だけで終わらせない。

- md を編集 → 対応する Notion ページも更新
- Notion を編集 → 対応する md も更新

### Notion 側で完了済みタスクの同期（厳守）

ユーザーが「Notion で完了した」「もう終わった」「全部 DONE」など**既存タスクの完了を言及した**ら、即座に `notion-sync-tasks.ts` で全件同期する。

```bash
bun run scripts/notion/notion-sync-tasks.ts --dry-run   # プレビュー
bun run scripts/notion/notion-sync-tasks.ts             # 実行
```

- `/from-notion`（`notion-pull.ts`）は**日付範囲フィルタ付き**のため、過去日に完了した Inbox の古いタスクは拾えない。必ず `notion-sync-tasks.ts` を使う
- 手で tasks.md の `[ ]` を `[x]` に書き換えるのは禁止。Notion が source of truth なのでスクリプト経由で同期する
