---
name: resume
description: defer したタスクを再開するとき。「resume」「さっきの続き」「defer した何かやろう」などに使う。bd ready -l defer から選んで実行する。
---

# Resume - defer したタスクを再開する

`bd ready -l defer --json` で依存解消済み・未着手の defer タスクを抽出し、**priority 順で先頭1件を自動 claim・実行する。**

**前提:** このスキルは無人実行（cron 等）を想定しているため、`AskUserQuestion` を一切呼ばない。判断が必要な状況になったら `blocked:` notes を残して中断する。

## Step 1: ready リスト取得

```bash
bd ready -l defer --json
```

結果が空なら「defer キューに ready なタスクがないよ」と報告して終了。in_progress のものは `bd list -l defer --status in_progress --json` で別途確認できる旨を補足。

## Step 2: 自動選択

priority 昇順 → 作成日新しい順で **先頭 1 件を自動採用**。ユーザーに「`<id>` `<title>` を実行する」と1行で通告するだけ。確認は取らない。

5 件以上 ready があれば「他に N 件 ready あり」と一言添える（手動 resume 時の情報として）。

## Step 3: claim

```bash
bd update <id> --claim --json
```

status が `in_progress` になり assignee がセットされる。

## Step 4: 内容を読む

```bash
bd show <id> --json
```

返却される `description`（実行レシピ）と `notes`（過去のチェックポイント、あれば）を読む。

- `notes` に `blocked:` で始まる checkpoint があれば「人間の判断待ち」とみなして即スキップ、Step 1 に戻って次の ready タスクへ進む
- 全部 blocked なら「ready は全て blocked 状態。手動 resume が必要」と報告して終了
- `checkpoint:` 形式の notes があれば、その続きから着手する。最初からやり直さない

## Step 5: 実行

レシピに従って実行する。実行中に**判断が必要になったら以下のいずれか:**

a) description の「事前確認済み判断事項」に該当項目があれば、その判断に従って続行
b) 該当なし & Claude が安全に判断できる → 判断して続行し、その判断を checkpoint に残す:

```bash
bd update <id> --append-notes "checkpoint: <判断内容と理由>" --json
```

c) 該当なし & 安全に判断できない → 即中断:

```bash
bd update <id> --append-notes "blocked: <何が決まらず止まったか / ユーザーに何を聞きたいか>" --json
```

status は in_progress のまま、close しない。`AskUserQuestion` は絶対に呼ばない（無人想定）。

進捗の節目では必ず checkpoint を残す（読み込み完了、設計完了、実装完了 等）。中断する場合は手放す前に必ず checkpoint を書く。

## Step 6: 完了 or 中断

### 完了

```bash
bd close <id> --reason "<完了メッセージ>" --json
```

その後、変更ファイルがあれば自動コミットフロー（`.ai/rules/git-workflow.md`）に従って worktree 経由で commit / PR を作る。defer タスク 1 件 = 1 PR が基本。

### 中断（時間切れ等、続きから着手したいもの）

```bash
bd update <id> --append-notes "checkpoint: <最後にどこまで進んだか>" --json
```

`blocked:` プレフィックスは使わない（次回 resume で続きから着手させたいので）。status は `in_progress` のままで OK。

## checkpoint vs blocked の使い分け

| プレフィックス | 意味 | 次回 resume の挙動 |
|--------------|------|------------------|
| `checkpoint:` | 続きから着手可能（時間切れ・フェーズ完了等） | そのまま continue |
| `blocked:` | 人間判断が必要、無人実行不可 | スキップして次の ready へ |

ユーザーが手動で blocked タスクに対処したい場合は `bd list -l defer --status in_progress --json` で別途取得し、notes を読んで対応する。

## 依存解消後の確認

A タスクを close した後、それに依存していた B が ready になったかもしれない。close 直後に `bd ready -l defer --json` をもう一度叩いて、新しく ready になったものをユーザーに報告する（「A 完了したから B が ready になったよ」）。次の自動実行はせず、手動 or 次回 cron に任せる。

## 関連

- defer 登録: `/defer` または `.ai/rules/defer.md` 経由の自動提案
- 一覧確認: `bd list -l defer --json`（status=open のもの全部）
