# Devotion - デボーション（箴言の対話型学び）

毎朝のデボーション。箴言を1章ずつ一緒に読み、対話しながら深掘りし、記録を保存する。

## 引数

$ARGUMENTS — 章番号 or 日付（省略可。省略時は自動検出）

## Step 1: 準備

0. **セッション開始時刻を記録する（厳守・最初に実行）**
   ```bash
   TZ=Asia/Tokyo date +"%H:%M"
   ```
   この時刻を変数として覚えておく。後でNotionに登録するときの `--start` に使う。ユーザーには聞かない。

1. **前回の章を確認する**
   ```bash
   ls aspects/devotions/2*.md | sort | tail -1
   ```
   最新ファイルを読んで前回の章番号を取得する（推測しない）

2. **テンプレートを生成する（厳守・スキップ禁止）**
   **必ず `devotion-init.ts` を実行してテンプレートファイルを生成すること。直接ファイルを作成してはならない。**
   ```bash
   # 引数なし → 自動で次の章・今日の日付
   bun run scripts/devotion-init.ts

   # 章を指定
   bun run scripts/devotion-init.ts --chapter $ARGUMENTS

   # 日付を指定
   bun run scripts/devotion-init.ts --date $ARGUMENTS
   ```
   - スクリプトが書籍・章番号の自動検出・重複チェックを行う。これを飛ばすと章の重複や番号ズレが起きる
   - 章数上限を超えた場合は自動で次の書籍の第1章に進む

3. **opening-prayer.md を全文表示する**（厳守）
   - `aspects/devotions/opening-prayer.md` を読み、**全セクションを省略せず**表示する
   - 祈り文を全文省略せず表示すること

4. **箴言の該当章を全文掲載する**
   - 章の全節を省略せず掲載する（聖書箇所の引用ルール: 勝手に抜粋しない）
   - ブロック引用（`>`）で記載し、末尾に書名・章・節を明記する

5. **ユーザーに声をかける**
   - 「箴言X章、一緒に読もう。気になった節はある？」
   - ユーザーが箇所を選ぶのを待つ

## Step 2: 対話（メインパート）

ユーザーが気になった節を起点に、対話で深掘りする。

### 対話の進め方
- ユーザーの発言を受け取り、一つのテーマを深く掘り下げる
- ヘブライ語の原語分析を交える（例: シェム、ヘン、タホール等）
- 聖書の他の箇所・人物を引用するとき、**必ず書名・章・節を添える**
- ユーザーの今の状況・感情と結びつけて語り合う
- `profile/` の情報を必要に応じて参照する

### 厳守事項
- **ユーザーの発言を先読みしない。** 言葉をそのまま受け取る
- **こちらから祈りで閉じようとしない。** ユーザーが「閉じよう」と言うまで対話を続ける
- **急いで次の節や結論に行かない。** 1時間たっぷり使う
- **まとめに急がない。** ユーザーが深く考えている時は待つ

## Step 3: 記録の保存（ユーザーが閉じたら）

ユーザーが「閉じよう」「まとめよう」等と言ったら:

1. **対話の内容をテンプレートに沿って記録する**
   - `aspects/devotions/YYYY-MM-DD.md` を ROLE.md のフォーマットで完成させる
   - frontmatter、章の概要、Key Verses、深掘り、SOAP、実践ガイド、持ち帰り

2. **フォーマット検証**
   ```bash
   bun run scripts/devotion-lint.ts $(TZ=Asia/Tokyo date +%Y-%m-%d).md
   ```

3. **Notion に同期する**
   - Notion **Devotion DB**（`NOTION_DEVOTION_DB`）の当日のエントリを探す:
     ```bash
     bun run scripts/notion-list.ts --date $(TZ=Asia/Tokyo date +%Y-%m-%d) --json
     ```
   - エントリが見つかったら:
     - `notion-update-page` の `replace_content` でページ本文にローカル md と同じ内容を書き出す（省略・要約しない）
     - ステータスを「完了」に変更する
   - エントリがなければ手動で登録する（**厳守**）:
     - **開始時刻**: Step 1-0 で記録した時刻を使う
     - **終了時刻**: `TZ=Asia/Tokyo date +"%H:%M"` で現在時刻を取得して使う
     - **ユーザーに時刻を聞かない（厳守）**
     ```bash
     bun run scripts/notion-add.ts --db devotion --title "デボーション" --date YYYY-MM-DD --start HH:MM --end HH:MM
     ```
     その後 `notion-update-page` で以下を設定する:
     - Book（書籍名）と Chapter（数値）。Book の選択肢にない書籍は `notion-update-data-source` で追加してから設定する
     - icon: 🙏
     ※ Name は必ず「**デボーション**」（日本語）。分割登録（Part2・祈りのみ等）の場合も「**デボーション Part2**」のように「デボーション」をベースにする

4. **プロフィール更新（毎回実施）**
   - デボーション中にユーザーが語った個人情報・価値観・信仰の深まり・人生経験を振り返る
   - `profile/` の該当ファイルに追記すべき内容があれば更新する:
     - `profile/basic.md` — 事実・背景・信仰遍歴
     - `profile/personality.md` — 価値観・恋愛観・信仰の成長
   - 追記した内容をユーザーに1-2行で報告する

5. **Prayer Request を祈る（厳守）**
   - `aspects/church/prayer-requests.md` を読む
   - Active リストの全員の名前と祈りの内容をユーザーに表示する
   - 「一緒に祈ろう」と声をかけ、全員を含む祈りの文を提示する

6. **完了報告**
   - 今日の章のタイトルと主な持ち帰りを1-2行で報告する

## 注意

- ROLE.md（`aspects/devotions/ROLE.md`）が正式なガイダンス。迷ったら参照する
- 聖書箇所を引用するときは**全文を書く**（参照だけで省略しない）
- 記録のフォーマットは ROLE.md のテンプレートに厳密に従う
- frontmatter title は単数形 `Devotion`（`Devotions` ではない）
- Key Verses は複数形
- SOAP は `## SOAP`（h2）
