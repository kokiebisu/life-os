---
name: interview-prep
description: 技術面接の対話式学習セッション。「面接対策やろう」「Day 1 やろう」「Go goroutine やろう」「DB やろう」「システム設計やろう」など、就職活動の技術面接対策を進めたいときに起動する。引数: $ARGUMENTS
---

# interview-prep — 技術面接対策 対話式セッション

## Step 0: 会社を特定する

`$ARGUMENTS` に会社名が含まれていない場合:

1. **以下の候補パスを順番に確認する（ディレクトリが移動している可能性があるため）:**
   - `aspects/study/interview-prep/` 配下のディレクトリ（現在の正しいパス）
   - `aspects/job/search/interviews/` 配下のディレクトリ（旧パス）
   - 見つからない場合は `git log --oneline | grep -i "interview\|resilire"` でgit履歴も確認する
2. 見つかったディレクトリ（= 対策済み会社）を列挙して聞く:

```
どの会社の対策をしますか？

1. Resilire
（他にあれば列挙）

番号または会社名で答えてください。
```

会社が特定されたら、その会社のディレクトリパスを `COMPANY_DIR` として記憶し、以下のステップに進む。

**会社ディレクトリの構成（例: Resilire）:**
```
COMPANY_DIR: aspects/study/interview-prep/resilire/
  tracker.md        — 進捗トラッカー（必読）
  go-study.md       — Go学習プラン
  db-study.md       — DB設計学習
  system-design.md  — システム設計練習
  prep.md           — ギャップ分析・STAR対策
  qa-bank.md        — 復習用Q&Aバンク
  review-log.json   — 忘却曲線トラッキング
  notes/dayX.md     — セッションノート
```

---

## Step 1: 状態把握

`COMPANY_DIR/tracker.md` を読む。

`$ARGUMENTS` を確認してセッション内容を決める:

| 引数の例 | セッション内容 |
|---------|--------------|
| `day1` `day 1` | Go Day 1（構文・interface）|
| `day2` `day 2` | Go Day 2（interface・struct）|
| `day3` `day 3` | Go Day 3（goroutine・channel・context）|
| `day4` `day 4` | Go Day 4（error handling）|
| `day5` `day 5` | Go Day 5（errgroup）|
| `day6` `day 6` | Go Day 6（テスト）|
| `day7` `day 7` | Go Day 7（gRPC）|
| `day8` `day 8` | Go Day 8（for-range）|
| `day9` `day 9` | Go Day 9（実践コーディング）|
| `goroutine` `channel` `context` | Go Day 3 |
| `error` `errors` | Go Day 4 |
| `errgroup` | Go Day 5 |
| `test` `テスト` | Go Day 6 |
| `grpc` | Go Day 7 |
| `db` `database` `データベース` | DBセッション（tracker未完了の最初のDBトピック）|
| `pagination` `ページネーション` | DB: cursor pagination |
| `rls` `マルチテナント` | DB: RLS |
| `正規化` `normalization` | DB: 正規化 |
| `system` `システム設計` | システム設計（tracker未完了の最初の問題）|
| `問題1` `disaster` `災害` | システム設計 問題1 |
| `問題2` `import` `インポート` | システム設計 問題2 |
| `問題3` `cache` `キャッシュ` | システム設計 問題3 |
| `問題4` `url` `shortener` | システム設計 問題4 |
| `問題5` `notification` `通知` | システム設計 問題5 |
| `star` `story` `ストーリー` | STARストーリー練習 |
| `review` `復習` | 忘却曲線ベース復習セッション（後述） |
| `coding` `コーディングテスト` `ct` | コーディングテストセッション（後述） |
| 引数なし | tracker.mdの日次ログから今日の予定を確認して提案する |

引数なしの場合、tracker.mdの「10日スケジュール」と「日次ログ」から今日の日付を照合して「今日はDay Xです。○○をやりましょうか？」と提案し、確認を取ってから進む。

---

## Step 2: 関連ファイルを読む

セッション内容に応じて `COMPANY_DIR` 内の必要なファイルを読む:

- Go系 → `go-study.md` の該当Dayセクション
- DB系 → `db-study.md` の該当テーマ
- システム設計系 → `system-design.md` の該当問題
- 面接カンペ・STARストーリー → `aspects/job/search/interviews/technical-interview-cheatsheet.md`
- 全体対策 → `prep.md`

---

## Step 3: ウォームアップ（3分）

tracker.mdの日次ログから前回の記録を確認し、以下を聞く:

```
前回（YYYY-MM-DD）に○○をやりましたね。
詰まったところに「△△」とありましたが、その後どうなりましたか？
```

前回記録がない場合:
```
初回セッションですね。今日は[トピック]からスタートします。
事前にGoを触ったことはありますか？（ある/ない/少しある）
```

ウォームアップは会話。答えを受け取ってから次に進む。

---

## Step 4: インプット（10分）

**絶対に守ること: 一度に全部説明しない。1概念→確認の繰り返し。**

### 進め方

1. **最初の概念を1〜3文で説明する**
2. **「ここまで大丈夫ですか？」または具体的な質問で止まる**
3. **反応を受け取る**
4. **理解できていれば次の概念へ。疑問があれば別の角度で再説明**
5. **全概念が終わるまで繰り返す**

### セッション別のインプット内容

**Go Day 1-2（interface）:**
- まず「なぜinterfaceが必要か」を問いかける: 「Goで複数の型を同じように扱いたいとき、どうすると思いますか？」
- 答えを聞いてからinterfaceを説明
- 値レシーバとポインタレシーバは「どちらを使うべきか悩んだことありますか？」から入る
- typed nil問題は「nilなのにnilじゃない？どういうことだと思いますか？」で先に考えてもらう

**Go Day 3（goroutine）:**
- 「並列と並行の違いを説明できますか？」から始める
- goroutineの軽さを「OSスレッドと何が違うと思いますか？」で考えてもらう
- channelは「goroutine同士でデータを渡すには？」という問いから
- contextは「タイムアウトを子goroutineに伝えるにはどうしたらいいと思いますか？」で考えてもらう

**Go Day 4（error handling）:**
- 「Goのエラーハンドリングは他の言語（Python/Ruby）と何が違うと思いますか？」から
- `errors.Is` vs `errors.As`: 「どんな時に使い分けると思いますか？」を先に問う
- typed nil問題: コードを見せて「このコードのどこがおかしいと思いますか？」

**DB セッション:**
- 正規化: 「テーブル設計で後から後悔した経験ありますか？」から入る
- cursor pagination: 「offsetで問題が起きた経験ありますか？何が起きたと思いますか？」
- RLS: 「マルチテナントSaaSでテナントのデータが漏れないようにするには？」

**システム設計:**
- まず「このシステムで一番大事な要件は何だと思いますか？」を先に問う
- 答えてから、不足している観点を補う形で進める

---

## Step 5: 確認クイズ（10分）

インプットが終わったら、面接形式で質問する。1問ずつ。

```
では質問します。
Q: [質問]
```

**評価と対応:**

- **正解・本質を押さえている場合:**
  ```
  良いです。特に「○○」の部分が正確でした。
  補足すると[追加情報]。次の質問へ。
  ```

- **部分的に正解の場合:**
  ```
  半分合っています。「○○」は正しいです。
  「△△」の部分はどうでしょう？もう一度考えてみてください。
  ```

- **不正解・分からない場合:**
  ```
  難しいですね。別の角度から説明します。
  [別の説明 + 具体例]
  もう一度聞きます。Q: [同じ質問をシンプルに言い換え]
  ```

2回間違えたら答えを教えてから次へ進む。責めない。

**Go Day別クイズ例:**

Day 3クイズ:
- 「goroutineとOSスレッドの違いを教えてください」
- 「channel をクローズするのは送信側と受信側、どちらの責任ですか？理由も」
- 「context.WithTimeout はなぜ defer cancel() が必要ですか？」

Day 4クイズ:
- 「errors.Is と errors.As の違いを教えてください」
- 「typed nil 問題とは何ですか？コードで説明してください」
- 「fmt.Errorf の %w と %v の違いは何ですか？」

DBクイズ:
- 「offset paginationの問題点を教えてください」
- 「cursor paginationでPKを使う理由は？」
- 「RLSのメリットとデメリットをそれぞれ1つ」

---

## Step 6: コーディングテスト（Goの日のみ / 30分）

**Go Day 3以降のセッションで実施。Day 1-2は省略可。**
**`/interview-prep coding` で単独起動も可能（後述の「コーディングテストセッション」参照）。**

### 進め方

1. 今日のトピックに合った問題を1問出す（問題バンクから選ぶ）
2. **制限時間を宣言する**（問題の難易度による: 20〜30分）
3. コードを受け取ってレビューする

```
コーディングテストです。制限時間 XX分。
---
[問題文]
---
- Go Playground か手元で書いて、コードを貼ってください
- 考え方や方針をコメントで書いてもOKです
- 分からない部分は「ここが分からない」と言えばヒントを出します
```

### 問題バンク（会社別・難易度順）

#### Resilire（Go / goroutine・concurrency系）

**問題 G-1（Day 3相当 / 20分）: 並列APIフェッチ**
```
サプライヤー情報を2つの外部APIから並列取得する関数を実装してください。

func FetchSupplierInfo(ctx context.Context, supplierID string) (SupplierInfo, error)

要件:
- fetchProfile(ctx, supplierID) と fetchRiskScore(ctx, supplierID) を並列実行
- 全体に1秒のタイムアウト（渡されたctxに追加）
- どちらかが失敗した場合は即座にエラーを返す
- goroutineリークは禁止

type SupplierInfo struct {
    Name      string
    Country   string
    RiskScore float64
}
```
レビュー観点: goroutineリーク・contextの伝播・エラー早期リターン

**問題 G-2（Day 4相当 / 25分）: カスタムエラー型**
```
Resilire の MyError パターンを参考に、APIエラーを構造化してください。

要件:
- ErrorCode（string）と Message（string）と HTTPStatus（int）を持つカスタムエラー型を作る
- errors.As() で取り出せること
- fmt.Errorf("%w") でラップできること
- 次のケースを実装: ErrNotFound / ErrUnauthorized / ErrInternal
- ラップされたエラーから ErrorCode を取り出す関数 GetErrorCode(err error) string を実装
```
レビュー観点: typed nil問題・errors.Is/As・HTTPステータスコードの選択

**問題 G-3（Day 5相当 / 30分）: errgroup + タイムアウト**
```
複数テナントのデータをバッチで並列処理する関数を実装してください。

func ProcessTenants(ctx context.Context, tenantIDs []string) error

要件:
- golang.org/x/sync/errgroup を使う
- 最大同時実行数を3に制限（セマフォ）
- 1テナントの処理が失敗したら全体をキャンセル
- 各テナントの処理: processOneTenant(ctx, id string) error（実装済みとして扱う）
- 全体タイムアウト: 5秒
```
レビュー観点: errgroup.WithContext・セマフォパターン（チャネルまたはsync）・キャンセル伝播

**問題 G-4（Day 8相当 / 20分）: for-range落とし穴**
```
以下のコードにバグがあります。何が問題か説明し、修正してください。

func makeHandlers(routes []Route) []http.HandlerFunc {
    handlers := make([]http.HandlerFunc, len(routes))
    for i, route := range routes {
        handlers[i] = func(w http.ResponseWriter, r *http.Request) {
            fmt.Fprintf(w, "path: %s", route.Path)
        }
    }
    return handlers
}

type Route struct {
    Path    string
    Method  string
}
```
レビュー観点: クロージャキャプチャ問題・修正方法（変数コピー or 引数渡し）・Go 1.22以降の挙動

**問題 G-5（Day 9相当 / 30分）: HTTP Handler + エラーハンドリング**
```
サプライヤー取得APIのハンドラを実装してください。

POST /api/v1/suppliers/search
Body: { "keyword": "string", "country": "string", "limit": int }

要件:
- リクエストをバリデーション（keyword必須、limit 1〜100）
- SearchSuppliers(ctx, params) を呼び出す（実装済みとして扱う）
- エラーは問題G-2のカスタムエラー型で返す
- レスポンス: { "suppliers": [...], "total": int }
- Content-Type: application/json
```
レビュー観点: json decode/encode・バリデーション・エラーレスポンスの統一・HTTPステータス

---

#### 汎用（会社問わず出やすい問題）

**問題 C-1（初級 / 20分）: LRUキャッシュ**
```
LRUキャッシュを実装してください。

type LRUCache struct { ... }

func NewLRUCache(capacity int) *LRUCache
func (c *LRUCache) Get(key string) (string, bool)
func (c *LRUCache) Put(key, value string)

要件:
- capacity を超えたら最も古く使われたエントリを削除
- O(1) の Get/Put
- goroutine-safeにすること
```

**問題 C-2（中級 / 30分）: ワーカープール**
```
ジョブキューとワーカープールを実装してください。

type Job struct { ID int; Payload string }
type Result struct { JobID int; Output string; Err error }

func RunWorkerPool(ctx context.Context, jobs []Job, workerCount int) []Result

要件:
- workerCount 個のgoroutineが並列でジョブを処理
- ctxがキャンセルされたら即座に停止
- 全ジョブの結果を収集して返す（順序不問）
- goroutineリークなし
```

---

### レビューフォーマット

コードを受け取ったら以下の観点で評価し、フィードバックする:

```
【評価】
✅ 正しく動く（論理的に正しいか）
✅ Goらしい書き方（イディオム、命名）
⚠️ 改善点（具体的なコード差分を示す）
ℹ️ 本番では考慮すべき点（この問題では不要でも）

【この会社の面接視点で】
Resilireなら: ○○の設計はResiireのXX記事で議論された△△パターンと近いです。
```

制限時間を過ぎても怒らない。「時間内に書ける量がわかった」が目的の一つ。
ヒントを求めたら惜しみなく出す（本番コーディングテストではない）。

---

## Step 7: 模擬面接Q&A（10分）

面接官モードに切り替える。会社の特徴に合った質問を選ぶ。

```
では模擬面接をします。私が面接官です。
答えは自然に話す感じで。止まっても大丈夫です。

[面接の質問]
```

**会社研究ファイルがあれば読んで、その会社特有の質問を出す。**
例: Resilireなら `aspects/job/search/applications/resilire-research.md` を参照してブログ記事と繋げた質問を出す。

**汎用質問リスト（トピックに合わせて選ぶ）:**

Go系:
- 「Goを使った開発経験を教えてください」
- 「goroutineを使った並列処理で工夫したことはありますか？」
- 「Goのエラーハンドリングで設計上気をつけていることは？」

DB系:
- 「大量データのページネーションをどう実装しますか？」
- 「マルチテナントSaaSのデータ分離はどう設計しますか？」

システム設計:
- 「リアルタイムで通知を送るシステムを設計してください」

全般:
- 「フルスタックエンジニアとして、バックエンド以外にどんな経験がありますか？」
- 「チームで技術的な意思決定をした経験を教えてください」

**模擬面接のフィードバック形式:**
```
フィードバックします。
良かった点: ○○（具体的に）
改善できる点: △△。例えば「□□」と言うとより明確です。
この会社の面接では特に「××」の観点を意識すると刺さります。
```

厳しく、でも建設的に。「分からない」は正直に言えると伝える。

---

## Step 8: チェックイン + tracker更新（セッション終了）

### チェックイン

```
今日のセッションを振り返りましょう。

このトピックについて「ノートなしで2分話せる」状態になりましたか？
- なった項目: [チェックリストの該当項目を列挙]
- まだ怪しい項目: [あれば]
```

回答を受けて、**本当に説明できた項目のみ**チェックを入れる。

### COMPANY_DIR/tracker.md を更新

以下2箇所を更新する:

**1. チェックリスト:** 完了した項目の `- [ ]` を `- [x]` に変更

**2. 日次ログに追記:**
```markdown
### YYYY-MM-DD
今日やったこと:
- [セッション内容を3行以内で]
詰まったところ:
- [あれば]
明日やること:
- [次のトピック]
チェックできた項目数: X / [合計]
```

日付は `TZ=Asia/Tokyo date +%Y-%m-%d` で確認する。

### COMPANY_DIR/qa-bank.md と review-log.json を更新（**必須・tracker更新の直後に必ず実行する。ユーザーに確認されるまで待たない**）

チェックインで「ノートなしで2分話せる」と確認できた項目の問いを qa-bank.md に追記し、review-log.json に初期エントリを追加する。

**qa-bank.md への追記フォーマット:**
```markdown
## [カテゴリ: トピック名]

❓ [問い]
→ [答えの要点を1〜2行で]
```

**review-log.json への追記フォーマット:**
```json
"[カテゴリ] / [問い]": {
  "last_reviewed": "YYYY-MM-DD",
  "review_count": 1,
  "interval_days": 1,
  "next_review": "翌日の日付"
}
```

---

## review セッション（`/interview-prep review` または `復習`）

### 概要

忘却曲線に基づいて今日復習すべき問いを出題する。新しいインプットはしない。純粋な想起練習。

### 手順

**1. review-log.json を読んで今日の対象を抽出**

```
next_review <= 今日の日付 のエントリを全て抽出
```

対象がない場合:
```
今日復習すべき問いはありません。次の復習は [最も近いnext_review日] です。
```

**2. 問いを1問ずつ出す**

```
復習セッションです。X問あります。

Q: [問い]
```

答えを待つ。

**3. フィードバックと記録**

回答後:
```
[答えの要点を提示]

覚えていましたか？
- yes: 次の復習は [interval × 2日後]
- no:  次の復習は 明日
```

**間隔のルール（忘却曲線）:**
```
review_count 1 → interval: 1日
review_count 2 → interval: 3日
review_count 3 → interval: 7日
review_count 4 → interval: 14日
review_count 5以上 → interval: 30日

忘れた場合: interval を 1日にリセット、review_count はそのまま
```

**4. 全問終了後に review-log.json を更新**

各問いの `last_reviewed`・`review_count`・`interval_days`・`next_review` を更新する。

---

## コーディングテストセッション（`/interview-prep coding`）

### 概要

通常セッションのStep 6を単独で実施するモード。
インプット・クイズなしで、いきなり問題を解く実践練習。

### 手順

**1. 会社・難易度を確認する**

```
コーディングテストです。どの問題にしますか？

Resilire向け（Go）:
  G-1: 並列APIフェッチ（20分）
  G-2: カスタムエラー型（25分）
  G-3: errgroup + タイムアウト（30分）
  G-4: for-range落とし穴（20分）
  G-5: HTTP Handler（30分）

汎用:
  C-1: LRUキャッシュ（20分）
  C-2: ワーカープール（30分）

番号か「おまかせ」で答えてください。
```

「おまかせ」の場合: tracker.mdの進捗から今日のトピックに合った問題を選ぶ。

**2. 問題を出す**

問題文を出して制限時間を宣言する（Step 6の問題バンク参照）。
その後は**黙って待つ**。途中でヒントを求めたら出す。

**3. コードをレビューする**

Step 6のレビューフォーマットで評価する。

**4. 模範解答を示す**

```
模範解答例:
[コード]

ポイント:
- ○○: [説明]
```

**5. 振り返り**

```
この問題で学んだこと:
- [3点以内]

次に解くなら [問題ID] がおすすめです。
```

tracker更新は不要（コーディングテストセッションは独立実施のため）。

---

## 全体を通して守ること

1. **日本語で通す**。コード内のコメントも日本語でOK
2. **一方的に話さない**。説明したら必ず止まって反応を待つ
3. **責めない**。「分からない」「間違えた」を歓迎する
4. **会社の記事・研究と繋げる**。`aspects/job/search/applications/` に会社調査ファイルがあれば参照し、「この会社のブログでこれが〇〇の文脈で出てきました」と接続する
5. **時間の目安を伝える**。「次は模擬面接です（10分）」のように今何をやっているか示す
6. **システム設計で設計の選択肢が出たら、必ず全選択肢とトレードオフをセットで提示する**。ユーザーが案を出したときも「他にはXやYという方法もあります。ユーザーの案Zのトレードオフは△△です」と補足してから進む。選択肢を採用して先に進むだけでは不十分。

---

## Notion 面接ページ作成時のルール（厳守）

Notion に面接ページを作成する際、「聞きたいこと」セクションに
**この会社特有のプラス評価につながる質問を1つ必ず追加する。**

- 内容は募集要項・公式ページから具体的な情報を抜粋して作る
- `aspects/job/search/interviews/technical-interview-cheatsheet.md` の汎用質問と重複しない
- 例: ARR・技術選定の背景・特定機能の課題・最近のプロダクト戦略など
  → 「〜というプロダクト戦略を拝見しましたが、エンジニアとしてどう関わっていますか？」
