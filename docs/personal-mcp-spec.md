# Personal MCP Server — 設計仕様書

> Version: 0.1.0 (Draft)
> Date: 2026-02-17
> Status: RFC（レビュー待ち）

---

## 1. 背景と動機

### 1.1 現状の課題

life リポジトリのコンテキスト（プロフィール・目標・スケジュール・意思決定履歴）は、すべて **Claude Code 固有の仕組み** に依存している:

- `CLAUDE.md` + `.claude/rules/` でファイル読み込みルールを定義
- Claude Code の `Read` ツールで markdown を直接読む
- Notion MCP は Claude Code のプラグインとして接続

この構成では:

1. **LLM ツールを乗り換えられない** — Open Code, Cursor, 自作エージェント等に移行すると、コンテキストの読み込みロジックを全て再構築する必要がある
2. **コンテキスト取得が非効率** — プロフィール参照のたびに複数ファイルを Read する（トークン消費）
3. **構造化データとして扱えない** — 体重推移やゴール進捗など、時系列・リレーショナルなクエリが markdown では困難
4. **外部アプリと共有できない** — ダッシュボード・モバイルアプリ等からプロフィールを参照する手段がない

### 1.2 解決策

**Personal MCP Server** — 自分自身のナレッジを MCP プロトコルで公開するローカルサーバー。

```
"自分のことを知っている API" を一つ立てれば、
どの AI ツールからでも同じ自分として扱ってもらえる。
```

### 1.3 なぜ MCP か

- **LLM agnostic** — Claude Code, Open Code, Cursor, 自作エージェント、すべてが MCP クライアントになれる
- **標準プロトコル** — Anthropic が推進、エコシステムが急速に拡大中
- **ローカル実行可能** — サーバーをローカルで動かせばデータは外に出ない
- **Tools + Resources** — 読み取り（Resources）と操作（Tools）を分離して公開できる

---

## 2. ゴールとノンゴール

### 2.1 ゴール

| # | ゴール | 指標 |
|---|--------|------|
| G1 | LLM ツール非依存のコンテキスト基盤 | Open Code から同等のプロフィール参照ができる |
| G2 | コンテキスト取得の効率化 | 1回の MCP 呼び出しで必要な情報が返る |
| G3 | 時系列データの蓄積・クエリ | 「過去3ヶ月の体重推移」が取れる |
| G4 | 将来のマルチアプリ対応の土台 | Web ダッシュボード等から API 経由でアクセス可能 |
| G5 | 段階的な移行 | 既存の markdown + Notion ワークフローを壊さない |

### 2.2 ノンゴール（スコープ外）

- Notion の完全置き換え（スケジュール管理は引き続き Notion）
- 汎用的な PIM（Personal Information Manager）の構築
- マルチユーザー対応
- クラウドデプロイ（ローカルのみ）
- モバイルアプリ（将来の可能性としてのみ言及）

---

## 3. アーキテクチャ

### 3.1 全体構成

```
┌─────────────────────────────────────────────────────┐
│                    MCP Clients                       │
│                                                     │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐          │
│  │ Claude   │  │  Open    │  │  自作     │  ...     │
│  │ Code     │  │  Code    │  │  Agent   │          │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘          │
│       │              │              │                │
│       └──────┬───────┴──────────────┘                │
│              │                                       │
│              │  MCP Protocol (stdio / SSE)            │
│              │                                       │
│  ┌───────────▼──────────────────────────────────┐   │
│  │          personal-mcp server                  │   │
│  │                                               │   │
│  │  ┌─────────┐  ┌─────────┐  ┌──────────────┐ │   │
│  │  │  Tools  │  │Resources│  │   Prompts    │ │   │
│  │  └────┬────┘  └────┬────┘  └──────┬───────┘ │   │
│  │       │             │              │          │   │
│  │  ┌────▼─────────────▼──────────────▼──────┐  │   │
│  │  │            Core Layer                   │  │   │
│  │  │  ┌──────┐  ┌───────┐  ┌─────────────┐ │  │   │
│  │  │  │  FS  │  │  DB   │  │ Notion API  │ │  │   │
│  │  │  │Reader│  │Client │  │   Client    │ │  │   │
│  │  │  └──┬───┘  └───┬───┘  └──────┬──────┘ │  │   │
│  │  └─────┼──────────┼─────────────┼─────────┘  │   │
│  └────────┼──────────┼─────────────┼────────────┘   │
│           │          │             │                  │
└───────────┼──────────┼─────────────┼─────────────────┘
            │          │             │
     ┌──────▼──┐  ┌────▼───┐  ┌─────▼─────┐
     │ profile/ │  │ Postgre│  │  Notion   │
     │planning/ │  │  SQL   │  │   API     │
     │aspects/  │  │(Docker)│  │           │
     └─────────┘  └────────┘  └───────────┘
     markdown      時系列DB     スケジュール
     (Git管理)     (volume)     (外部SaaS)
```

### 3.2 データソースの役割分担

| データソース | 役割 | データの性質 |
|---|---|---|
| **Filesystem (markdown)** | プロフィール、目標、意思決定、ルール | 静的〜低頻度更新。Human-readable、Git 履歴が価値 |
| **PostgreSQL** | 体重推移、食事ログ、ゴール進捗、行動ログ | 時系列・構造化データ。クエリ・集計が必要 |
| **Notion API** | スケジュール、タスク、ルーティン | 既存ワークフロー維持。Calendar UI の価値 |

**設計原則: markdown を DB に移行しない。** markdown の Human-readability と Git 履歴は保持し、DB は markdown では辛いデータ（時系列、集計）にのみ使う。

### 3.3 トランスポート

| Phase | トランスポート | 用途 |
|---|---|---|
| Phase 1-2 | **stdio** | Claude Code / Open Code からローカル起動 |
| Phase 3+ | **SSE (HTTP)** | Web ダッシュボード等のリモートクライアント |

Phase 1-2 は stdio で十分。SSE は外部アプリ連携が必要になった時点で追加する。

---

## 4. データモデル

### 4.1 Filesystem（既存 — 変更なし）

```
profile/
├── basic.md          # 基本情報（名前、居住、言語、趣味、性格）
├── health.md         # 健康（身体数値、食事制限、ジム、ダイエット目標）
├── career.md         # キャリア（学歴、職歴、スキル、sumitsugi）
├── love.md           # 恋愛（→ memory へのポインタ）
├── personality.md    # 価値観（軸、恐れ、ビジョン、矛盾と葛藤）
└── goals.md          # 目標リスト（チェックリスト形式）

planning/
├── tasks.md          # タスク Inbox / Archive
├── roadmap.md        # 3ヶ月ロードマップ
├── events/           # 未来のイベント
└── daily/            # デイリープラン

memory-bank/
└── decisions.md      # 設計判断ログ
```

MCP Server はこれらを **読み取り専用で公開** する（Resources）。
書き込みは Tools 経由で行い、既存の markdown フォーマットを維持する。

### 4.2 PostgreSQL スキーマ（Phase 2 で導入）

```sql
-- 体重・身体計測の時系列データ
CREATE TABLE health_metrics (
    id          SERIAL PRIMARY KEY,
    date        DATE NOT NULL UNIQUE,
    weight_kg   DECIMAL(4,1),          -- 63.0
    waist_cm    DECIMAL(4,1),          -- ウエスト
    body_fat_pct DECIMAL(3,1),         -- 体脂肪率（将来）
    note        TEXT,
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ゴール進捗の時系列トラッキング
CREATE TABLE goal_progress (
    id          SERIAL PRIMARY KEY,
    goal_key    VARCHAR(100) NOT NULL,  -- "weight_loss", "cooking_frequency"
    date        DATE NOT NULL,
    value       DECIMAL(10,2),          -- 数値（体重、自炊回数 等）
    note        TEXT,
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(goal_key, date)
);

-- 意思決定ログ（memory-bank/decisions.md の構造化版）
CREATE TABLE decisions (
    id          SERIAL PRIMARY KEY,
    date        DATE NOT NULL,
    title       VARCHAR(200) NOT NULL,
    decision    TEXT NOT NULL,
    reasoning   TEXT,
    alternatives TEXT,
    impact      TEXT,
    aspect      VARCHAR(50),            -- "diet", "career", "planning" 等
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- 行動ログ（何をしたかの記録）
CREATE TABLE activity_log (
    id          SERIAL PRIMARY KEY,
    timestamp   TIMESTAMPTZ NOT NULL,
    category    VARCHAR(50) NOT NULL,   -- "meal", "exercise", "study", "guitar"
    title       VARCHAR(200) NOT NULL,
    duration_min INTEGER,
    detail      JSONB,                  -- カテゴリ固有のデータ
    source      VARCHAR(50),            -- "notion", "manual", "auto"
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- インデックス
CREATE INDEX idx_health_metrics_date ON health_metrics(date);
CREATE INDEX idx_goal_progress_key_date ON goal_progress(goal_key, date);
CREATE INDEX idx_activity_log_ts ON activity_log(timestamp);
CREATE INDEX idx_activity_log_category ON activity_log(category);
```

### 4.3 Notion（既存 — 変更なし）

| DB | 用途 | MCP Server での扱い |
|---|---|---|
| routine | 繰り返しルーティン | 読み取り（今日のスケジュール取得） |
| events | 一回限りの予定 | 読み取り |
| todo | タスク | 読み取り + 書き込み |
| meals | 食事メニュー | 読み取り |
| guitar | ギター練習 | 読み取り |
| groceries | 買い出し | 読み取り |

Notion への書き込みは既存の `notion-add.ts` 等のスクリプトを内部で呼ぶか、Notion API を直接叩く。

---

## 5. MCP API 設計

### 5.1 Resources（読み取り専用コンテキスト）

Resources はクライアントが「このコンテキストを知りたい」と宣言的に取得するもの。
LLM のシステムプロンプトに注入する用途を想定。

```yaml
Resources:
  # --- プロフィール ---
  personal://profile/basic:
    description: "基本情報（居住、言語、趣味、性格傾向）"
    source: profile/basic.md
    mime: text/markdown

  personal://profile/health:
    description: "健康情報（身体数値、食事制限、ジム、ダイエット目標）"
    source: profile/health.md
    mime: text/markdown

  personal://profile/career:
    description: "キャリア（学歴、職歴、技術スキル、sumitsugi）"
    source: profile/career.md
    mime: text/markdown

  personal://profile/personality:
    description: "価値観・人生の軸・ビジョン・葛藤"
    source: profile/personality.md
    mime: text/markdown

  personal://profile/goals:
    description: "目標一覧（チェックリスト形式）"
    source: profile/goals.md
    mime: text/markdown

  # --- 計画 ---
  personal://planning/tasks:
    description: "タスク Inbox と Archive"
    source: planning/tasks.md
    mime: text/markdown

  personal://planning/roadmap:
    description: "3ヶ月ロードマップ"
    source: planning/roadmap.md
    mime: text/markdown

  # --- コンテキストサマリー ---
  personal://context/current:
    description: "今の状況サマリー（動的生成）"
    source: computed
    mime: application/json
    note: |
      プロフィール要点 + 今日のスケジュール + アクティブな目標 +
      直近の意思決定を1つの JSON にまとめて返す。
      LLM に「自分を知ってもらう」ための統合コンテキスト。
```

### 5.2 Tools（操作）

#### 5.2.1 プロフィール系

```yaml
profile_get:
  description: "プロフィール情報を取得する"
  params:
    section:
      type: string
      enum: [basic, health, career, personality, goals, all]
      description: "取得するセクション。all で全セクションを返す"
    format:
      type: string
      enum: [markdown, json]
      default: markdown
      description: "レスポンスフォーマット"
  returns:
    type: object
    properties:
      section: string
      content: string       # markdown or JSON string
      last_modified: string  # ISO 8601
  notes: |
    - markdown: ファイルをそのまま返す（Human-readable）
    - json: パース済みの構造化データ（プログラマティックアクセス用）
    - json フォーマットは Phase 2 で対応。Phase 1 は markdown のみ

profile_update:
  description: "プロフィール情報を更新する"
  params:
    section:
      type: string
      enum: [basic, health, career, personality, goals]
    updates:
      type: string
      description: "更新内容の自然言語記述（例: '体重を62.5kgに更新'）"
  returns:
    type: object
    properties:
      success: boolean
      diff: string  # 変更差分
  notes: |
    - 更新はファイル内の該当部分を書き換える
    - Git diff 形式で変更差分を返す
    - 構造を壊すような更新はエラーにする
```

#### 5.2.2 コンテキスト系

```yaml
context_get:
  description: "現在のコンテキストサマリーを取得する"
  params:
    include:
      type: array
      items:
        type: string
        enum: [profile, schedule, goals, tasks, decisions, health_trends]
      default: [profile, schedule, goals, tasks]
      description: "含めるコンテキストの種類"
    date:
      type: string
      format: date
      default: today
      description: "基準日（スケジュール取得用）"
  returns:
    type: object
    properties:
      date: string
      profile_summary:          # markdown からパースした構造化フィールド
        type: object
        properties:
          age: number             # 生年月日から算出（例: 30）
          gender: string          # "男性"
          location: string        # "横浜"
          housing: string         # "シェアハウス"
          nationality: string     # "日本"
          languages: string[]     # ["日本語", "英語"]
          mbti: string            # "INFJ"
          current_work: string    # "life OS（個人プロジェクト）開発"
          priorities: string[]    # ["life OS開発", "運動/減量", ...]
          diet_restrictions: string[]  # ["トマト", "マヨネーズ", ...]
          weight_kg: number       # 63.0（health.md から）
          weight_target_kg: number # 58.0（health.md から）
          sleep_goal: string      # "22:00-05:00"
          faith: string           # "プロテスタント"
          hobbies: string[]       # ["ギター", "サウナ", "お酒", ...]
      schedule: array           # 今日の予定一覧
      active_goals: array       # 進行中の目標 + 進捗
      pending_tasks: array      # Inbox のタスク
      recent_decisions: array   # 直近の意思決定（最大5件）
      health_snapshot: object   # 最新の体重、目標との差分（Phase 2）
  notes: |
    これが MCP の核心。1回の呼び出しで「自分の全体像」が返る。
    LLM のシステムプロンプトに注入すれば、どのツールでも
    「あなたのことを知っている AI」になる。

    profile_summary の各フィールドは profile/*.md から正規表現・行パースで抽出する。
    markdown のフォーマットが変わったらパーサも更新が必要（トレードオフ）。
    抽出ロジックは core/markdown.ts に集約する。
```

#### 5.2.3 目標・タスク系

```yaml
goals_list:
  description: "目標一覧を取得する"
  params:
    status:
      type: string
      enum: [active, completed, all]
      default: active
  returns:
    type: array
    items:
      type: object
      properties:
        key: string             # "weight_loss"
        title: string           # "3ヶ月で5kg減量"
        category: string        # "体づくり"
        completed: boolean
        progress: object        # Phase 2: { current: 63, target: 58, unit: "kg" }

goals_log_progress:
  description: "目標の進捗を記録する"
  params:
    goal_key: string            # "weight_loss"
    value: number               # 62.5
    note: string                # "朝の計測"
    date:
      type: string
      format: date
      default: today
  returns:
    type: object
    properties:
      success: boolean
      goal_key: string
      value: number
      trend: object  # Phase 2: { week_avg, month_avg, delta_from_start }
  notes: |
    Phase 1: goals.md のチェックリストを更新
    Phase 2: goal_progress テーブルに INSERT + トレンド計算

tasks_list:
  description: "タスク一覧を取得する"
  params:
    filter:
      type: string
      enum: [inbox, archive, all]
      default: inbox
    aspect:
      type: string
      description: "アスペクトでフィルタ（例: diet, planning）"
  returns:
    type: array
    items:
      type: object
      properties:
        title: string
        date_added: string
        due_date: string | null
        aspect: string | null
        completed: boolean

tasks_add:
  description: "タスクを Inbox に追加する"
  params:
    title: string
    aspect: string | null
    due_date: string | null     # YYYY-MM-DD
  returns:
    type: object
    properties:
      success: boolean
      task: object
      notion_synced: boolean    # Notion todo DB にも同期したか
  notes: |
    1. planning/tasks.md の ## Inbox 末尾に追加
    2. Notion todo DB にも登録（notion-add.ts --db todo --allday）
    3. 既存タスクとの重複チェック
```

#### 5.2.4 健康データ系（Phase 2）

```yaml
health_log:
  description: "健康データを記録する"
  params:
    date:
      type: string
      format: date
      default: today
    weight_kg: number | null
    waist_cm: number | null
    note: string | null
  returns:
    type: object
    properties:
      success: boolean
      entry: object
      trends:
        week_avg: number
        month_avg: number
        delta_from_start: number
  notes: |
    - health_metrics テーブルに INSERT/UPSERT
    - profile/health.md の体重も自動更新
    - トレンドデータを返す

health_trends:
  description: "健康データの推移を取得する"
  params:
    metric:
      type: string
      enum: [weight, waist, body_fat]
    period:
      type: string
      enum: [week, month, quarter, year]
      default: month
  returns:
    type: object
    properties:
      metric: string
      period: string
      data_points: array        # [{ date, value }]
      summary:
        start: number
        current: number
        min: number
        max: number
        avg: number
        trend: string           # "decreasing", "stable", "increasing"
```

#### 5.2.5 意思決定ログ系

```yaml
decision_log:
  description: "意思決定を記録する"
  params:
    title: string
    decision: string
    reasoning: string
    alternatives: string | null
    impact: string | null
    aspect: string | null
  returns:
    type: object
    properties:
      success: boolean
      id: number
  notes: |
    Phase 1: memory-bank/decisions.md に追記
    Phase 2: decisions テーブルに INSERT + md にも追記（二重書き込み）

decisions_search:
  description: "過去の意思決定を検索する"
  params:
    query: string               # 自然言語クエリ
    aspect: string | null
    limit: number
    default: 5
  returns:
    type: array
    items:
      type: object
      properties:
        date: string
        title: string
        decision: string
        reasoning: string
  notes: |
    Phase 1: markdown を grep してマッチ
    Phase 2: DB から検索 + 将来的にベクトル検索
```

#### 5.2.6 スケジュール系

```yaml
schedule_get:
  description: "指定日のスケジュールを取得する"
  params:
    date:
      type: string
      format: date
      default: today
    source:
      type: string
      enum: [notion, local, merged]
      default: merged
      description: "Notion / ローカルmd / 両方マージ"
  returns:
    type: object
    properties:
      date: string
      day_of_week: string       # "月", "火", ...
      entries: array
        - title: string
          start: string         # "09:00"
          end: string           # "10:00"
          db: string            # "routine", "events", "meals", ...
          status: string        # "未着手", "進行中", "完了"
          location: string | null
      free_slots: array         # 空き時間帯
        - start: string
          end: string
          duration_min: number
  notes: |
    内部で notion-list.ts --date --json を呼ぶ。
    free_slots は隣接エントリ間のギャップから自動計算。
```

### 5.3 Prompts（定型プロンプトテンプレート）

```yaml
prompts:
  daily_briefing:
    description: "朝のブリーフィング用プロンプト"
    template: |
      以下はユーザーの今日のコンテキストです。
      これを踏まえて、今日の計画を確認・調整してください。

      ## プロフィール
      {{profile_summary}}

      ## 今日のスケジュール
      {{schedule}}

      ## アクティブな目標
      {{active_goals}}

      ## 未完了タスク
      {{pending_tasks}}

  aspect_context:
    description: "アスペクト別のコンテキスト注入用"
    params:
      aspect: string
    template: |
      以下はユーザーの {{aspect}} に関するコンテキストです。

      ## プロフィール（関連部分）
      {{relevant_profile}}

      ## 目標
      {{aspect_goals}}

      ## 直近の活動
      {{recent_activity}}
```

---

## 6. 技術スタック

| 要素 | 選定 | 理由 |
|---|---|---|
| Runtime | **Bun** | 既存スクリプトと同じ。起動が速い |
| 言語 | **TypeScript** | 既存コードベースと統一 |
| MCP SDK | **@modelcontextprotocol/sdk** | 公式 TypeScript SDK |
| DB | **PostgreSQL 16** | sumitsugi と同じ。JSONB, 時系列に強い |
| ORM | **Drizzle ORM** | sumitsugi と同じ。Type-safe, 軽量 |
| Container | **Docker Compose** | DB をローカル volume で管理 |
| Markdown Parser | **unified / remark** | markdown → 構造化データの変換（json format 用） |

### 6.1 依存関係（最小構成）

```json
{
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.x",
    "drizzle-orm": "^0.x",
    "postgres": "^3.x"
  },
  "devDependencies": {
    "drizzle-kit": "^0.x",
    "@types/bun": "latest"
  }
}
```

Phase 1（DB なし）では `drizzle-orm`, `postgres` は不要。

---

## 7. ディレクトリ構成

```
mcp/
└── personal/
    ├── package.json
    ├── tsconfig.json
    ├── drizzle.config.ts        # Phase 2
    ├── docker-compose.yml       # Phase 2（PostgreSQL）
    ├── src/
    │   ├── index.ts             # MCP Server エントリポイント
    │   ├── server.ts            # Server 設定・Tool/Resource 登録
    │   │
    │   ├── resources/           # Resource ハンドラ
    │   │   ├── profile.ts       # personal://profile/*
    │   │   ├── planning.ts      # personal://planning/*
    │   │   └── context.ts       # personal://context/current
    │   │
    │   ├── tools/               # Tool ハンドラ
    │   │   ├── profile.ts       # profile_get, profile_update
    │   │   ├── context.ts       # context_get
    │   │   ├── goals.ts         # goals_list, goals_log_progress
    │   │   ├── tasks.ts         # tasks_list, tasks_add
    │   │   ├── health.ts        # health_log, health_trends (Phase 2)
    │   │   ├── decisions.ts     # decision_log, decisions_search
    │   │   └── schedule.ts      # schedule_get
    │   │
    │   ├── prompts/             # Prompt テンプレート
    │   │   └── templates.ts
    │   │
    │   ├── core/                # コアロジック
    │   │   ├── fs-reader.ts     # markdown ファイル読み書き
    │   │   ├── markdown.ts      # markdown パーサ・フォーマッタ
    │   │   ├── notion-client.ts # Notion API ラッパー（scripts/lib/ 再利用）
    │   │   └── config.ts        # 設定・パス解決
    │   │
    │   └── db/                  # Phase 2
    │       ├── schema.ts        # Drizzle スキーマ定義
    │       ├── client.ts        # DB 接続
    │       └── migrations/      # マイグレーションファイル
    │
    └── tests/
        ├── resources.test.ts
        ├── tools.test.ts
        └── fixtures/            # テスト用 markdown ファイル
```

---

## 8. フェーズ計画

### Phase 1 — Filesystem MCP（最小構成）

**目標:** MCP 経由でプロフィール・タスク・目標にアクセスできる状態を作る。

**スコープ:**
- Resources: `profile/*`, `planning/tasks`, `planning/roadmap`
- Tools: `profile_get`, `context_get`, `tasks_list`, `tasks_add`, `goals_list`, `schedule_get`
- データソース: Filesystem のみ（DB なし）
- トランスポート: stdio

**やらないこと:**
- PostgreSQL / Docker Compose
- 時系列データ
- profile_update（読み取り専用で開始）

**完了条件:**
- Claude Code から `profile_get` で全プロフィールセクションが取れる
- Open Code（または別の MCP クライアント）から同じ操作ができる
- `context_get` で今日のコンテキストサマリーが返る

**想定期間:** 1-2日

### Phase 2 — PostgreSQL 導入 + 時系列

**目標:** 時系列データの蓄積と傾向分析。

**スコープ:**
- Docker Compose で PostgreSQL 追加
- Drizzle ORM + マイグレーション
- Tools: `health_log`, `health_trends`, `goals_log_progress`, `decision_log`
- `profile_get` の json format 対応
- `profile_update` の実装

**完了条件:**
- 体重を記録して3ヶ月の推移グラフデータが取れる
- ゴール進捗が数値で追跡できる
- 意思決定ログが検索できる

**想定期間:** 2-3日

### Phase 3 — Notion 統合強化

**目標:** Notion のデータを MCP 経由で統合的に取得。

**スコープ:**
- `schedule_get` の Notion 連携強化
- アスペクト別コンテキスト（`aspect_context` prompt）
- 食事ログの activity_log への蓄積
- Notion → DB の定期同期

**完了条件:**
- 1回の MCP 呼び出しで Notion + ローカル + DB の統合コンテキストが返る

### Phase 4 — SSE トランスポート + 外部アプリ

**目標:** Web ダッシュボード等からアクセス可能に。

**スコープ:**
- SSE (HTTP) トランスポート追加
- 認証（ローカルトークン）
- Web ダッシュボード（任意）

---

## 9. セキュリティ

### 9.1 データ分類

| レベル | データ | 扱い |
|---|---|---|
| **Public** | 基本プロフィール（名前、趣味、スキル） | MCP で公開可 |
| **Internal** | 健康データ、目標、スケジュール | MCP で公開可（ローカルのみ） |
| **Sensitive** | 住所、財務、恋愛 | MCP で公開しない。memory/ に留める |

### 9.2 アクセス制御

- Phase 1-2: **stdio のみ** → ローカルプロセスしかアクセスできない（事実上の認証）
- Phase 4 (SSE): ローカルトークン認証を必須にする
- Sensitive データは MCP の Tool/Resource に含めない
- `profile_get` で `love` セクションを指定した場合 → "このセクションは MCP 経由では利用できません" を返す

### 9.3 Git コミットルール

- `mcp/personal/` 内に `.env` や DB 接続情報をコミットしない
- Docker volume のデータはコミット対象外
- テスト fixtures にリアルデータを入れない

---

## 10. Devcontainer 統合

### 10.1 既存 Devcontainer への追加（Phase 2）

```jsonc
// .devcontainer/docker-compose.yml (新規)
{
  "services": {
    "app": {
      "build": { "context": ".", "dockerfile": "Dockerfile" },
      "volumes": [
        "..:/workspaces/life:cached"
      ],
      "depends_on": ["db"]
    },
    "db": {
      "image": "postgres:16-alpine",
      "environment": {
        "POSTGRES_USER": "life",
        "POSTGRES_PASSWORD": "life_local",
        "POSTGRES_DB": "personal"
      },
      "volumes": [
        "pgdata:/var/lib/postgresql/data"
      ],
      "ports": ["5432:5432"]
    }
  },
  "volumes": {
    "pgdata": {}
  }
}
```

### 10.2 MCP サーバー登録

```jsonc
// .claude/settings.json に追加
{
  "mcpServers": {
    "personal": {
      "command": "bun",
      "args": ["run", "/workspaces/life/mcp/personal/src/index.ts"],
      "env": {
        "LIFE_ROOT": "/workspaces/life",
        "DATABASE_URL": "postgres://life:life_local@db:5432/personal"
      }
    }
  }
}
```

Open Code やその他のクライアントでも同様の MCP 設定を行えば、同じサーバーに接続できる。

---

## 11. 移行戦略

### 11.1 段階的移行（既存ワークフローを壊さない）

```
現在:
  CLAUDE.md rules → Read tool → profile/*.md
  ↓
Phase 1:
  CLAUDE.md rules → personal MCP → profile/*.md  (裏では同じファイルを読む)
  ↓                    ↑
  Read tool は引き続き使える（互換性維持）
  ↓
Phase 2+:
  CLAUDE.md rules を徐々に簡素化
  「プロフィールは personal MCP を使え」の1行に集約
```

### 11.2 CLAUDE.md の変化

**Before (現在):**
```markdown
## Profile
各 aspect は profile/ を参照。health.md にダイエット情報、career.md に...
（10行以上のファイル読み込みルール）
```

**After (Phase 1 完了後):**
```markdown
## Profile
MCP server `personal` の `profile_get` / `context_get` を使うこと。
```

ルールが CLAUDE.md から MCP サーバーの内部に移動する = **ツール非依存** になる。

---

## 12. 設計判断（確定）

| # | 論点 | 選択肢 | 決定 |
|---|------|--------|------|
| Q1 | Notion 書き込みは MCP 経由にすべきか | A) MCP Tool にラップ B) 既存スクリプトを維持 | **B** — 既存ワークフロー（PostToolUse hook 等）が複雑で、MCP にまとめるメリットが薄い |
| Q2 | profile_update の実装方針 | A) 自然言語 → diff B) JSON patch C) セクション丸ごと上書き | **A** — LLM が使うことを前提に、自然言語入力が最も自然 |
| Q3 | `scripts/lib/notion.ts` の共有方法 | A) シンボリックリンク B) ワークスペース C) コピー | **B** — Bun workspace で `scripts/lib` を共有 |
| Q4 | activity_log のデータソース | A) Notion から定期同期 B) MCP Tool で手動記録 C) 両方 | **C** — Notion 同期をベースに、手動補完も可能に |
| Q5 | DB バックアップ戦略 | A) pg_dump を Git 管理 B) volume snapshot C) なし（再構築可能） | **A** — 時系列データは再構築不可なので dump を定期保存 |
| Q6 | stdio の同時接続制限 | A) 気にしない（同時に使わない） B) 最初から SSE C) 両方サポート | **A** — 同時使用の実需がまだない |
| Q7 | `schedule_get` の Phase 1 スコープ | A) Phase 1 に入れる（Notion API は既にある） B) Phase 2 に回す | **A** — `notion-list.ts` を内部で呼ぶだけで実装コスト低い |
| Q8 | `context_get` の profile_summary 生成方法 | A) テンプレート+構造化フィールド B) LLM 動的生成 C) 手書きサマリー | **A** — markdown からパーサで構造化データを抽出。LLM 依存を避ける |
| Q9 | goals.md の json パース深度 | A) タイトル+completed のみ B) カテゴリ見出しも解析 C) 数値目標まで抽出 | **B** — カテゴリ（体づくり/生活リズム等）は有用。数値抽出は Phase 2 の DB で |
| Q10 | テスト戦略 | A) fixtures で単体テスト B) 実ファイルで統合テスト C) 両方 | **A** — fixtures で。実ファイルはパスが環境依存 |

---

## 13. 成功指標

| 指標 | Phase 1 | Phase 2 | Phase 3 |
|------|---------|---------|---------|
| Open Code でプロフィール参照可能 | Yes | Yes | Yes |
| コンテキスト取得の MCP 呼び出し回数 | 1-2回 | 1回 | 1回 |
| 体重推移クエリ | - | Yes | Yes |
| Notion + ローカル統合ビュー | - | - | Yes |
| CLAUDE.md のプロフィール関連行数 | 削減開始 | 大幅削減 | 最小化 |

---

## Appendix A: 既存スクリプトとの関係

| 既存スクリプト | MCP での扱い | 理由 |
|---|---|---|
| `notion-add.ts` | ラップしない | PostToolUse hook との連携が複雑 |
| `notion-list.ts` | `schedule_get` の内部で呼ぶ | 既にパース処理が完成している |
| `notion-pull.ts` | 独立で継続 | 逆同期のトリガーは MCP の外 |
| `notion-daily-plan.ts` | 将来的に `context_get` に統合検討 | デイリープラン生成は複雑 |
| `notion-grocery-gen.ts` | ラップしない | 専用ワークフローが確立済み |

## Appendix B: `context_get` レスポンス例

```json
{
  "date": "2026-02-17",
  "day_of_week": "火",
  "profile_summary": {
    "age": 30,
    "gender": "男性",
    "location": "横浜",
    "housing": "シェアハウス",
    "nationality": "日本",
    "languages": ["日本語", "英語"],
    "mbti": "INFJ",
    "current_work": "life OS（個人プロジェクト）開発",
    "priorities": ["life OS開発", "運動/減量", "ギター", "投資", "study", "読書", "福岡検討"],
    "diet_restrictions": ["トマト", "マヨネーズ", "ケチャップ", "マスタード"],
    "weight_kg": 63.0,
    "weight_target_kg": 58.0,
    "sleep_goal": "22:00-05:00",
    "faith": "プロテスタント",
    "hobbies": ["ギター", "サウナ", "お酒", "Claude を使った開発", "料理"]
  },
  "schedule": [
    { "time": "05:00-05:30", "title": "起床・体重測定", "db": "routine" },
    { "time": "05:30-06:30", "title": "Devotion", "db": "routine" },
    { "time": "06:30-07:00", "title": "朝シャワー", "db": "routine" },
    { "time": "07:00-08:00", "title": "朝食: 鮭の塩焼き定食", "db": "meals" },
    { "time": "08:00-12:00", "title": "life OS 開発", "db": "routine" }
  ],
  "active_goals": [
    {
      "key": "weight_loss",
      "title": "3ヶ月で5kg減量",
      "category": "体づくり",
      "completed": false,
      "progress": null
    },
    {
      "key": "cooking_frequency",
      "title": "自炊を週6回に増やす",
      "category": "体づくり",
      "completed": false,
      "progress": null
    }
  ],
  "pending_tasks": [
    { "title": "ハローワークで手続き", "date_added": "2026-02-13", "aspect": "planning", "due": null, "completed": false },
    { "title": "失業保険の手続き", "date_added": "2026-02-13", "aspect": "planning", "due": null, "completed": false }
  ],
  "recent_decisions": [
    { "date": "2026-02-13", "title": "tsumugi → sumitsugi に改名", "reasoning": "..." }
  ]
}
```
