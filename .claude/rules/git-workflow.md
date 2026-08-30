# Git Workflow

## Commit Message Format
```
<type>: <description>
```
Types: feat, fix, refactor, docs, chore

## main への直接コミット禁止 / worktree 必須（厳守）

**PR を出すときは必ず git worktree を使う。** main への直接コミット・プッシュ禁止。

### `cd <worktree>` 禁止 / `git -C` 一択（厳守）

worktree 内で git 操作するときは**絶対に `cd .worktrees/<branch>` しない。** 必ず `git -C .worktrees/<branch> <cmd>` を使う。

- **理由:** Bash tool の cwd は呼び出し間で persist する。worktree に `cd` した後の `git stash pop` / `git status` / `git worktree remove` 等が、main を意図していたのに worktree を対象にしてしまう。`--force remove` と組み合わさると別セッションの未コミット変更を消失させる
- **過去のインシデント:** 2026-04-29 PR #605 セッションで unrelated changes を worktree に巻き込んで force remove で喪失（dangling stash から復旧）
- **唯一の例外:** `git -C` 形式を持たないコマンド（`gh pr create`、`bun run` / `npm` / `pytest` などのスクリプト実行系）は `(cd /workspaces/life/.worktrees/$BRANCH && <cmd>)` のように**サブシェル**で囲む。サブシェルは exit すると cwd が戻るので persist しない
  - ✅ `(cd .worktrees/$BRANCH && bun run scripts/notion/notion-pull.ts --dry-run)`
  - ❌ `cd .worktrees/$BRANCH && bun run ... ; cd /workspaces/life`（trailing `cd` が失敗したら次の Bash 呼び出しが worktree のままになる）
- **`cd` してよいのは `cd /workspaces/life`（main に戻すとき）だけ。** 他の `cd` は禁止

### 標準フロー（コピペ用）

```bash
# 1. unstaged changes があれば stash
git stash

# 2. worktree を作成（main から feature ブランチ）
BRANCH="<type>/<short-description>"
git worktree add .worktrees/$BRANCH -b $BRANCH
WT=.worktrees/$BRANCH

# 3. worktree 内で作業（git -C で cwd を変えない）
git -C $WT stash pop   # stash した場合のみ
git -C $WT add <files>
git -C $WT commit -m "..."
git -C $WT push -u origin HEAD
(cd $WT && gh pr create ...)   # gh は cwd 依存なのでサブシェル

# 4. マージ後に worktree を削除（cwd は終始 /workspaces/life）
git worktree remove $WT --force
git branch -D $BRANCH 2>/dev/null || true
git pull origin main
```

セッションごとに worktree を作成して影響範囲を分離すること。

## worktree 削除前の uncommitted check（厳守）

`git worktree remove --force` の前に、**必ず** `git -C .worktrees/<branch> status --porcelain` で未コミット変更がないか確認する。

- 空でない場合: その worktree に次の PR の変更が残っている可能性あり。`--force` で消すと untracked file は完全消失する
- 残っている変更が必要なものなら: その worktree でコミット・push してから削除、または stash してから削除
- 不要なゴミなら: ユーザーに確認してから `--force`

`git fsck --lost-found` で復旧できる場合もあるが（stash や tracked file の blob は残る）、untracked file は消える。force は最後の手段。

複数 PR を順番に作るとき、Group 1 の worktree に Group 2 の変更が残ったままになる動線が起きやすい。`status --porcelain` を必ず挟むこと。

## セッション開始時の worktree チェック（厳守）

セッション開始時に `git worktree list` で残存 worktree を確認する。main 以外の worktree があれば:

1. 各ブランチの PR 状態を `gh pr list --head <branch> --state all` で確認
2. **マージ済み PR あり** → worktree を削除（`git worktree remove --force` + `git branch -D`）
3. **PR なし・未マージ** → ユーザーに報告し、削除 or 継続を確認
4. 確認後 `git pull origin main` で main を最新にする

放置 worktree は main と乖離してマージ不能になるため、早めに処理する。

## 自動コミットポイント（厳守）

セッション中、Claude が「切れ目」を判断し、worktree → コミット → PR → マージまで**ユーザーに確認せず自動実行する。**

### コミットポイントの判断基準

以下のいずれかに該当し、未コミットの変更がある場合にコミットポイントとする：

1. **スキル完了時** — `/meal`、`/devotion`、`/study`、`/kondate`、`/gym`、`/event` 等のスキルが完了し、ファイル変更が発生したとき
2. **話題の切り替わり時** — ユーザーが別トピックに移る発言をしたとき、それまでの変更を先にコミット
3. **変更蓄積時** — 未コミットの変更ファイルがある状態で新しい作業に入ろうとしたとき

### 自動実行の手順

1. `git stash` → worktree 作成 → `git stash pop`
2. `git add` → `git commit` → `git push -u origin HEAD`
3. `gh pr create` → `gh pr merge --merge --delete-branch`
4. main に戻って worktree 削除 → `git pull origin main`

### PR の粒度

- 1コミットポイント = 1PR（変更をまとめすぎない）
- PR タイトル・本文は `/pr` スキルに従う

## `gh pr create` 失敗時のフォールバック（厳守）<!-- コード化済み: scripts/create-pr.ts -->

`gh pr create` が "No commits between main and ..." エラーで失敗した場合、**即座に `gh api` で直接 PR を作成する。** リトライしない。

```bash
gh api repos/kokiebisu/life/pulls --method POST \
  --field title="<title>" \
  --field head="<branch>" \
  --field base="main" \
  --field body="<body>"
```

## unstaged changes がある状態での操作（厳守）

`git pull` / `git checkout` がエラーになっても `git reset --hard` で解決しない。

1. `git stash` で変更を退避する
2. 操作を実行する（pull / checkout 等）
3. `git stash pop` で変更を戻す

`git reset --hard` を実行する前は必ず `git status` で unstaged changes がないことを確認すること。

## `git stash drop` 禁止（厳守）

`git stash drop` は使わない。代わりに `git stash pop` を使う。

- 理由: stash には**現セッションと無関係な未コミット変更も含まれる**（他のスキル・他のセッションが残した dirty file）。drop は不可逆で、無関係な作業を巻き込んで消す
- `pop` は apply 成功時だけ stash を消すので安全（conflict 時は stash を保持）
- 「stash の中身は不要」と判断したくなっても、`pop` で戻して再判断する
- 古い stash の整理が本当に必要な場合は、必ず `git stash show -p stash@{N}` で全内容を確認してから drop する
- **複数 stash を drop する場合、必ず高い index から低い index へ順に drop する**（`{3}` → `{2}` → `{1}` → `{0}`）。低い index から drop すると残り stash の index が前にシフトし、想定外の別 stash を消す
- 連続 drop の前に毎回 `git stash list` を再実行して、残った index を確認しなおす

復旧手段: `git fsck --no-reflogs --lost-found` で dangling commit を見つけて `git checkout <sha> -- <path>` で個別ファイル復旧は可能だが、最後の手段。untracked を含む stash は復旧困難。

