# /gym コマンド 実装プラン

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/gym plan` でジム予定を Notion routine DB に登録し、`/gym log` で実績を Notion ジムログDB + ローカル MD に記録するスキルを作る。

**Architecture:** `/gym plan` は既存の `notion-add.ts --db routine` を使用するスタンダードなスケジュール登録。`/gym log` は種目・重量・セット数・回数のカスタムプロパティを持つため Notion MCP（`notion-create-pages`）を直接使用し、ローカル MD にも並行保存する。

**Tech Stack:** Claude Code Skill (SKILL.md)、Notion MCP、bun スクリプト（既存）

---

## ファイルマップ

| 操作 | ファイル | 内容 |
|------|---------|------|
| 新規作成 | `.claude/skills/gym/SKILL.md` | /gym スキル本体 |
| 更新 | `aspects/diet/CLAUDE.md` | gym-logs/ をディレクトリ構成表に追加 |
| 実行時作成 | `aspects/diet/gym-logs/YYYY-MM-DD.md` | 実績ログ MD（スキル実行時に生成） |

---

## 前提: 一回限りのセットアップ（実装前に手動実施）

スキル実装の前に以下をユーザーが手動で行う必要がある。

- [ ] **Notion でジムログDB を作成する**

  プロパティ:
  - 名前（title）
  - 日付（date）
  - 種目（select）: 選択肢 → `ベンチプレス`、`スクワット`、`デッドリフト`
  - 重量（number）
  - セット数（number）
  - 回数（number）
  - メモ（rich_text）

- [ ] **DB ID を `.env.local` に追加する**

  ```
  NOTION_GYM_DB=<作成したDBのID>
  ```

  `.env.local` はすでに存在する（`NOTION_*` 系の変数が入っている）。末尾に追記すればよい。

---

## Task 1: aspects/diet/CLAUDE.md を更新する

**Files:**
- Modify: `aspects/diet/CLAUDE.md:32-38`

- [ ] **Step 1: ディレクトリ構成表に gym-logs/ を追加する**

  `aspects/diet/CLAUDE.md` のディレクトリ構成テーブル（`## ディレクトリ構成` セクション）を開き、既存の5行の末尾に1行追加する:

  ```markdown
  | `gym-logs/YYYY-MM-DD.md` | ジムセッションの実績ログ |
  ```

- [ ] **Step 2: コミットする**

  ```bash
  git add aspects/diet/CLAUDE.md
  git commit -m "docs: diet CLAUDE.md に gym-logs/ ディレクトリを追記"
  ```

---

## Task 2: /gym スキルを作成する

**Files:**
- Create: `.claude/skills/gym/SKILL.md`

- [ ] **Step 1: スキルディレクトリを作成する**

  ```bash
  mkdir -p .claude/skills/gym
  ```

- [ ] **Step 2: SKILL.md を作成する**

  `.claude/skills/gym/SKILL.md` を以下の内容で作成する:

  ```markdown
  ---
  name: gym
  description: ジムセッションの予定登録（/gym plan）と実績ログ記録（/gym log）。引数: $ARGUMENTS
  ---

  # gym — ジムセッション管理

  ## 引数パース

  `$ARGUMENTS` を確認する:
  - `plan` または `plan <日付>` または `plan <日付> <時間>` → `/gym plan` フローへ
  - `log` → `/gym log` フローへ
  - 引数なし or 不明 → ユーザーに「plan か log を指定してください」と確認する

  ---

  ## /gym plan — ジム予定を routine DB に登録

  ### 日付・時刻の決定

  1. `TZ=Asia/Tokyo date` で今日の日付を確認する
  2. `$ARGUMENTS` から日付・時刻を抽出する:
     - 日付未指定: 今日の日付を使う（ユーザーに確認して進む）
     - 時刻未指定: デフォルトは `12:30`（開始）、`14:00`（終了）
     - 開始時刻指定あり: 終了時刻 = 開始時刻 + 90分で計算する
  3. ISO8601 形式に変換する: `YYYY-MM-DDT12:30:00+09:00`（JST 必須）

  ### 重複チェック

  ```bash
  bun run scripts/validate-entry.ts --date YYYY-MM-DD --title "ジム（BIG3）" --start HH:MM --end HH:MM
  ```

  - 終了コード 1（類似エントリあり）→ ユーザーに確認してから登録するか判断する
  - 終了コード 0 → 次のステップへ

  ### 登録

  ```bash
  bun run scripts/notion-add.ts --db routine --title "ジム（BIG3）" --date YYYY-MM-DD --start YYYY-MM-DDT12:30:00+09:00 --end YYYY-MM-DDT14:00:00+09:00
  ```

  ### キャッシュクリア

  ```bash
  bun run scripts/cache-status.ts --clear
  ```

  ### 完了報告

  「ジム（BIG3）を [日付] [時間] で routine DB に登録しました」と報告する。

  ---

  ## /gym log — ジム実績を記録する

  ### 準備

  1. `TZ=Asia/Tokyo date +%Y-%m-%d` で今日の日付（`DATE`）を取得する
  2. `aspects/diet/gym-logs/` ディレクトリが存在しない場合は作成する:
     ```bash
     mkdir -p aspects/diet/gym-logs
     ```
  3. 最新のログファイルを確認して前回の重量を取得する:
     ```bash
     ls -t aspects/diet/gym-logs/*.md 2>/dev/null | head -1
     ```
     存在する場合はそのファイルを読み、ベンチプレス・スクワット・デッドリフトの重量を抽出してユーザーに提示する。

  ### データ収集

  BIG3の種目ごとにユーザーに確認する:

  ```
  今日のジムログを記録します。前回: ベンチ 20kg / スクワット 20kg / デッドリフト 20kg

  ベンチプレス: 重量(kg)・セット数・回数を教えてください
  （例: 22.5 3 15）
  ```

  スクワット、デッドリフトも同様に確認する。体感メモも任意で確認する。

  ### Notion 重複チェック

  `.env.local` から `NOTION_GYM_DB` を読み取る。

  Notion MCP の `notion-search` で同日・同種目のエントリを確認する:
  - 検索クエリ: `ジム DATE`
  - 既存エントリがあればユーザーに確認してから登録する（種目単位で判定）

  ### Notion ジムログDB に登録（3エントリ）

  `.env.local` から `NOTION_GYM_DB` の値を取得し、Notion MCP の `notion-create-pages` を使って BIG3の各種目を1エントリずつ登録する。

  各エントリのパラメータ:
  - `database_id`: `NOTION_GYM_DB` の値
  - `icon`: `{"type": "emoji", "emoji": "🏋️"}`
  - `cover`: `{"type": "external", "external": {"url": "https://images.unsplash.com/photo-1534438327276-14e5300c3a48?w=1200"}}`
  - `title:名前`: `ジム DATE`（例: `ジム 3/17`）
  - `date:日付`: `DATE`（`YYYY-MM-DD` 形式、タイムゾーン不要）
  - `select:種目`: `ベンチプレス` / `スクワット` / `デッドリフト`
  - `number:重量`: 重量の数値（例: `22.5`）
  - `number:セット数`: セット数（例: `3`）
  - `number:回数`: 回数（例: `15`）
  - `rich_text:メモ`: 体感メモ（空でも可）

  ### キャッシュクリア

  ```bash
  bun run scripts/cache-status.ts --clear
  ```

  ### ローカル MD を保存

  `aspects/diet/gym-logs/DATE.md` を以下のフォーマットで作成する:

  ```markdown
  # ジムログ DATE

  ## ベンチプレス
  - 重量: Xkg × Y回 × Zセット

  ## スクワット
  - 重量: Xkg × Y回 × Zセット

  ## デッドリフト
  - 重量: Xkg × Y回 × Zセット

  メモ: （体感メモがあれば）
  ```

  ### 前回比を計算して報告

  前回ログと比較し、各種目の重量差を計算して報告する:

  ```
  ジムログを記録しました（DATE）

  | 種目 | 今回 | 前回 | 差 |
  |------|------|------|-----|
  | ベンチプレス | 22.5kg | 20kg | +2.5kg |
  | スクワット | 20kg | 20kg | ±0 |
  | デッドリフト | 20kg | 20kg | ±0 |

  Notion ジムログDB ✅ / ローカル MD ✅
  ```

  前回ログがない場合は「初回セッションです」と記載する。
  ```

- [ ] **Step 3: スキルが正しく配置されているか確認する**

  ```bash
  cat .claude/skills/gym/SKILL.md | head -5
  ```

  Expected: frontmatter の `name: gym` が見えること

- [ ] **Step 4: コミットする**

  ```bash
  git add .claude/skills/gym/SKILL.md
  git commit -m "feat: /gym スキル追加（plan/log サブコマンド）"
  ```

---

## Task 3: 動作確認（手動テスト）

セットアップ（Task 0）が完了している前提で確認する。

- [ ] **Step 1: /gym plan を動作確認する**

  Claude Code で以下を実行:
  ```
  /gym plan
  ```

  確認ポイント:
  - 今日の日付で `12:30-14:00` の routine エントリが提案されること
  - `validate-entry.ts` が実行されること
  - `notion-add.ts --db routine` が実行されること
  - `cache-status.ts --clear` が実行されること

- [ ] **Step 2: /gym plan に日付・時刻を渡して確認する**

  ```
  /gym plan 3/25 15:00
  ```

  確認ポイント:
  - `3/25 15:00-16:30`（+90分）で登録されること
  - 時刻が `+09:00` 付き ISO8601 形式で渡されること

- [ ] **Step 3: /gym log を動作確認する**

  ```
  /gym log
  ```

  確認ポイント:
  - 前回の重量が提示されること（初回は「初回」と表示）
  - BIG3の重量・セット数・回数をインタラクティブに確認されること
  - `notion-create-pages` が3回呼ばれること
  - `aspects/diet/gym-logs/YYYY-MM-DD.md` が作成されること
  - 前回比テーブルが表示されること

- [ ] **Step 4: PR を作成する**

  ```
  /pr
  ```
