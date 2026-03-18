# Life - 人生管理リポジトリ

> GitHub を使った人生管理リポジトリ
> 日記を読んで、チームが理解して、明日のタスクが進化する。

## Quick Reference

**リポジトリ:** life（人生管理）
**言語:** 日本語（コード・ファイル名は英語）
**構造:** aspects/ 配下に生活の各側面を管理

## Commands

```bash
./dev                    # devcontainer を起動して Claude Code を開く
./scripts/sumitsugi-sync.sh            # sumitsugi ↔ LIFE タスク同期
./scripts/sumitsugi-sync.sh --dry-run  # 同期プレビュー（変更なし）
```

### Claude Code コマンド

```bash
/ask:diet                # ダイエットチームに相談
/ask:job:search          # 就職活動チームに相談
/from:notion             # Notion からデータ同期
/from:sumitsugi          # sumitsugi ↔ LIFE Linear タスク同期
/goal                    # 壁打ちして新しい目標を追加
/pr                      # 変更をグループ化してPR作成
/tidy                    # 指示ファイルの重複・配置を整理
/calendar                # Notion カレンダー操作
/cleanup                 # 未完了エントリの整理（デフォルト: 昨日）
/event                   # イベント登録
/cache                   # キャッシュ管理（status / clear / analyze）
/learn                   # ミスからの学習・再発防止
/process                 # クイックメモの言語化・配置
```

## Directory Structure

```
profile/                 # ユーザープロフィール（basic/health/career/goals/love/personality）
aspects/                 # 生活の各側面（各ディレクトリに CLAUDE.md あり）
  tasks.md               # タスク管理（Inbox / Archive）
  events/                # 一回限りの予定
  daily/                 # デイリーログ
projects/sumitsugi/      # 個人プロジェクト（サブモジュール）
memory-bank/             # セッション間の記憶（decisions.md）
```

## Git & Security

- コミット形式・PR ワークフロー → `.claude/rules/git-workflow.md`
- セキュリティガイドライン → `.claude/rules/security.md`

## Aspects（生活の側面）

各 aspect は `aspects/` 配下。固有の指示は各 `CLAUDE.md` に記載。

| Aspect | チーム | 概要 |
|--------|--------|------|
| diet | 6人チーム | ダイエット・健康管理 → Notion: 食事DB |
| guitar | 3人チーム | ギター練習 → Notion: ギターDB |
| investment | 11人チーム | 投資 |
| study | 9人チーム | 学習（起業・法律・技術） |
| job/search | 6人チーム | 就職活動 |
| fukuoka | 田中誠 | 福岡移住検討 |
| reading | 村上葉月 | 読書記録 |
| routine | - | 習慣・ルーティン → Notion: 習慣DB |
| sound | 3人チーム | 教会音響PA → Notion: カリキュラムDB |
| church | - | 教会関連 |

**その他:**
- `aspects/tasks.md` — タスク管理（Inbox / Archive）
- `aspects/events/` — 一回限りの予定
- `aspects/daily/` — デイリーログ
- `projects/sumitsugi/` — 個人プロジェクト・本業（サブモジュール）

## Devcontainer

- **ランタイム:** Node.js 20, Bun
- **ツール:** Claude Code CLI, GitHub CLI
- **起動:** `./dev` スクリプトで devcontainer 起動 + Claude Code 自動開始

## 実装プラン実行

- **常に Subagent-Driven（現セッション内）で実行する。** Parallel Session は使わない
- 理由: タスクは順番依存が多く、1人リポジトリなのでワークツリー分離のメリットがない

## Memory Bank

`memory-bank/decisions.md` に設計判断とその理由を記録する。重要な判断をしたら追記すること。
