---
name: tidy
description: 指示ファイル（CLAUDE.md・rules・commands・memory）の重複・配置ミスを整理するとき。「ルールが散らかってきた」「指示ファイル整理したい」などに使う。
---

# Tidy - 指示ファイルの整理・重複削減

指示ファイル（CLAUDE.md、rules、commands、memory-bank）を横断スキャンし、重複・配置ミス・トークン無駄を検出して整理する。

## 対象ファイル

### 常時ロードされるファイル（= トークンコスト高）
- `/workspaces/life/CLAUDE.md` — ルート指示
- `/workspaces/life/.claude/rules/*.md` — 全セッションに自動ロード
- `/home/node/.claude/projects/-workspaces-life/memory/MEMORY.md` — 自動ロード（200行制限）

### スキル起動時のみロード（= コスト低）
- `/workspaces/life/.claude/skills/*/SKILL.md` — スキル起動時のみ
- `aspects/*/CLAUDE.md` — そのディレクトリ作業時のみ

### セッション開始時に読むファイル（= 明示的 Read）
- `memory-bank/*.md` — 手動読み込み

## Step 1: 全ファイル読み込み

以下を全て読む:

```
CLAUDE.md
.ai/rules/*.md
.claude/skills/*/SKILL.md
aspects/*/CLAUDE.md (再帰的に検索)
/home/node/.claude/projects/-workspaces-life/memory/MEMORY.md
```

## Step 2: 重複・問題の検出

以下の観点でチェックする:

### 2a. コンテンツ重複
同じ情報が複数ファイルに書かれていないか。特に:
- 優先度リスト（就職活動 > 運動 > ...）が複数箇所にないか
- ルーティンスケジュールが複数箇所にないか
- チームメンバー一覧が skills/ と aspects/*/CLAUDE.md の両方にないか
- Notion コマンド例が rules/ と skills/ で重複していないか
- ユーザー状況が memory-bank/ と MEMORY.md で重複していないか

### 2b. 配置の問題
- **常時ロードの rules/ に、特定コマンドでしか使わない情報がないか**
  → commands/ に移すべき
- **CLAUDE.md に、rules/ と同じ内容が要約で書かれていないか**
  → 参照だけにすべき
- **memory-bank/ と MEMORY.md の役割が重複していないか**
  → 片方に統合すべき

### 2c. トークン削減の余地
- 冗長な説明、例が多すぎる箇所
- テンプレート・フォーマット例が不必要に長い箇所
- 空の placeholder セクション（内容がないのにヘッダーだけある）
- 使われていない・古い情報

## Step 3: レポート作成

検出結果を以下の形式でユーザーに報告する:

```
## Tidy Report

### 重複検出
| # | 内容 | 出現箇所 | 推奨アクション |
|---|------|---------|--------------|
| 1 | 優先度リスト | CLAUDE.md, planning/CLAUDE.md, goal.md | planning/CLAUDE.md に一本化、他は参照 |

### 配置改善
| # | ファイル | 問題 | 推奨 |
|---|---------|------|------|

### トークン削減
| # | ファイル | 現在行数 | 推定削減 | 内容 |
|---|---------|---------|---------|------|

### 推定トークン影響
- 常時ロード合計: 現在 ~XXX 行 → 整理後 ~XXX 行（-XX%）
- コマンド別: 変更なし / XX 行削減
```

## Step 4: ユーザー承認

レポートを見せて、どの修正を適用するか確認する。
一括適用 or 個別選択。

## Step 5: 修正適用

承認された修正を適用する。変更は `/pr` で PR にまとめる。

## ルール

- **常時ロードファイルの削減を最優先する**（rules/ と CLAUDE.md）
- **情報は1箇所に。他は参照リンクで。** DRY 原則
- **commands/ の情報はそのまま残す**（コマンド時のみロードなのでコスト低い）
- **意味のある内容は削除しない。** 移動・統合のみ
- **空の placeholder は削除する**（将来使うかもは不要）
