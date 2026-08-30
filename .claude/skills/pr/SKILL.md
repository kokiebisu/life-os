---
name: pr
description: プルリクエストを作成するとき。変更をグループ化して PR を作成する。コミット後に自動で呼ばれることもある。
---

---
description: Create Pull Request. Supports Agent Teams for parallel multi-PR workflows.
allowed-tools: Bash, Read, Edit, Write, Grep, Glob, Task
---

# Create Pull Request

Create focused pull requests with changes grouped logically and limited to 200 lines each.
When multiple independent groups exist and Agent Teams is available, spawns parallel teammates for simultaneous PR creation.

## Step 1: Analyze Changes

1. Run `git status` to check current state
   - **unstaged changes がある場合は `git stash` で退避してからブランチ作成し、`git stash pop` で戻す**
2. Run `git diff --stat origin/main...HEAD` to get line counts per file
3. Run `git diff origin/main...HEAD` to analyze actual changes

## Step 2: Group Changes

Analyze all changes and group them by:

- **Feature**: Related functionality (e.g., "location picker", "date range picker")
- **Type**: Similar change types (e.g., "type fixes", "dependency updates")
- **Domain**: Same domain area (e.g., "auth", "listing", "admin")

For each group, calculate total line changes (additions + deletions).

Mark inter-group dependencies: does group B require group A's changes to build/work?

## Step 3: Split if Needed

If any group exceeds 200 lines:

- Split into smaller logical units
- Each PR should be independently reviewable
- Maintain dependency order (base changes first)

Present groups to user with dependency info:

```
Group 1: feat: add location picker (156 lines) [independent]
  - src/components/location-picker.tsx (+120, -0)
  - src/lib/geocoding.ts (+36, -0)

Group 2: fix: improve date range validation (89 lines) [independent]
  - src/components/date-range-picker.tsx (+45, -12)
  - src/lib/date-utils.ts (+32, -0)

Group 3: feat: use location in search (45 lines) [depends on Group 1]
  - src/components/search.tsx (+30, -15)

Strategy: Groups 1 & 2 in parallel, then Group 3 after Group 1 merges.
```

Ask user to confirm or adjust groupings.

## Step 4: Run Verification

Before creating any PRs, verify the full codebase passes:

1. **Run test suite**:

   ```bash
   bun run test
   ```

2. **Run type check**:

   ```bash
   bun run typecheck
   ```

3. **Run linter**:

   ```bash
   bun run lint
   ```

4. **Run build**:
   ```bash
   bun run build
   ```

If any check fails:

- **STOP** - Do not proceed with PR creation
- Report the failing checks to user
- Ask user how to proceed (fix issues or skip PR)

## Step 5: Route — Single vs Parallel

**Decision point based on group count and Agent Teams availability:**

- **1 group** → Step 6A (single PR, sequential)
- **2+ independent groups, Agent Teams available** → Step 6B (parallel via Agent Teams)
- **2+ groups, Agent Teams unavailable or groups have dependencies** → Step 6A sequentially, respecting dependency order

To check Agent Teams availability:

- The env var `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` must be set
- Must be in an interactive CLI session (not CI/headless)

If Agent Teams is available but all groups have chain dependencies (each depends on the previous), fall back to Step 6A sequential.

---

## Step 6A: Single PR Flow (Worktree ベース・Sequential)

**IMPORTANT**: 必ず worktree を作成してから作業する。main への直接コミット禁止。

> **`cd <worktree>` 禁止 / `git -C` 一択（厳守）** — 詳細は [.ai/rules/git-workflow.md](../../../.ai/rules/git-workflow.md) 参照。Bash の cwd は persist するため `cd .worktrees/...` した後の `git stash pop` / `worktree remove` で別セッションの未コミット変更を巻き込んで喪失する事故が発生済み。**`cd` してよいのは `cd /workspaces/life` だけ。**

For each approved group (in dependency order):

1. **Stash unstaged changes**（あれば）:

   ```bash
   git stash
   ```

2. **Worktree を作成**（main から feature ブランチ）:

   ```bash
   BRANCH="<type>/<short-description>"
   git worktree add .worktrees/$BRANCH -b $BRANCH
   WT=.worktrees/$BRANCH   # 以降は $WT を git -C で指す
   ```

3. **Worktree に変更を適用**（`git -C` で cwd を変えない）:

   ```bash
   git -C $WT stash pop   # stash した場合のみ（stash は worktree 間で共有される）
   ```

4. **Stage only group files**:

   ```bash
   git -C $WT add <file1> <file2> ...
   ```

5. **Commit with conventional commit format**:
   - `feat:` - New feature
   - `fix:` - Bug fix
   - `refactor:` - Code refactoring
   - `docs:` - Documentation
   - `test:` - Tests
   - `chore:` - Maintenance
   - `perf:` - Performance
   - `ci:` - CI/CD

   ```bash
   git -C $WT commit -m "<type>: <description>"
   ```

6. **Push branch**:

   ```bash
   git -C $WT push -u origin HEAD
   ```

7. **Immediately create PR** (DO NOT SKIP THIS) — `gh` は cwd 依存なのでサブシェルで囲む:

   ```bash
   (cd $WT && gh pr create --title "<type>: <description>" --body "$(cat <<'EOF'
   ## Summary
   <2-4 bullet points describing what changed and why>

   ## Changes
   <bulleted list of specific changes made>

   ## Test Plan
   - [ ] <verification step 1>
   - [ ] <verification step 2>
   - [ ] <verification step 3>

   Generated with Claude Code
   EOF
   )")
   ```

8. **Monitor CI** (per PR):

   ```bash
   gh pr checks <pr-number>
   # Wait for all checks to pass
   ```

9. **Worktree cleanup → マージの順（厳守）**（cwd は終始 `/workspaces/life`）:

   ```bash
   # 先に worktree を削除する（branch が checked-out 状態だと --delete-branch が失敗するため）
   git worktree remove $WT --force
   # その後マージ。--delete-branch は local + remote の両方を削除する
   gh pr merge <pr-number> --squash --delete-branch
   git pull origin main
   ```

   **Why:** `gh pr merge --delete-branch` は merge 後に local branch も削除しようとする。branch が worktree に checked-out されたままだと local branch 削除に失敗してコマンドが exit 1 になる（merge 自体は成功するが、後続スクリプトが「失敗した」と誤解する原因になる）。worktree を先に削除してから merge することで、`--delete-branch` が local + remote の両方をクリーンに削除できる。

10. If more groups remain, return to substep 1 for the next group.

---

## Step 6B: Parallel PR Flow (Agent Teams)

When 2+ independent groups exist and Agent Teams is available, spawn teammates for parallel execution.

### Phase 1: Prepare Worktrees

Create one worktree per independent group:

```bash
for each group {n}:
  bun run worktree:create pr-group-{n}
```

Copy the relevant files for each group into its worktree (each worktree starts from main, so the changed files from the current branch need to be applied).

For each worktree:

```bash
# From the current branch, checkout only this group's files into the worktree
cd /workspace/.worktrees/pr-group-{n}
git checkout <current-branch> -- <file1> <file2> ...
```

### Phase 2: Spawn PR Team

Create an agent team with one teammate per independent group. Use **delegate mode**.

```
Create an agent team for parallel PR creation.
Spawn {N} teammates, one per PR group below.
Use delegate mode -- coordinate only, do not implement yourself.

Groups:
1. Teammate "pr-group-1": {type}: {description} ({line_count} lines)
   Worktree: /workspace/.worktrees/pr-group-1
   Files: {file1}, {file2}, ...

2. Teammate "pr-group-2": {type}: {description} ({line_count} lines)
   Worktree: /workspace/.worktrees/pr-group-2
   Files: {file1}, {file2}, ...

[... up to 5 groups]
```

#### Teammate Prompt

````
You are creating a PR for one group of changes in the life repository.

## Your Group
**Title:** {type}: {description}
**Files:** {file list}
**Line count:** {additions + deletions}

## Your Worktree
Work ONLY in: /workspace/.worktrees/pr-group-{n}
cd /workspace/.worktrees/pr-group-{n}

## Steps (follow exactly)
1. Verify the changed files are present: `git diff --stat origin/main`
2. Run verification in your worktree:
   - `bun run test:run`
   - `bun run lint`
   - `bun run typecheck`
   - `bun run build`
   If any fail, message the lead with the error.
3. Stage explicitly: `git add <files>` (NEVER `git add .` or `-A`)
4. Commit: `git commit -m "{type}: {description}"`
5. Push: `git push -u origin HEAD`
6. Create PR:
   ```bash
   gh pr create --title "{type}: {description}" --body "$(cat <<'EOF'
   ## Summary
   <2-4 bullet points>

   ## Changes
   <bulleted list>

   ## Test Plan
   - [ ] <step 1>
   - [ ] <step 2>

   Generated with Claude Code
   EOF
   )"
   ```
7. CI Loop (max 5 iterations):
   - `gh pr checks <pr-number>`
   - If fail: `gh run view <id> --log-failed` -> fix -> push -> repeat
8. Message the lead when done with: group number, PR URL, CI status
````

### Phase 3: Coordinate

The lead monitors teammate progress:

- Track each teammate's PR URL and CI status
- If a teammate hits CI failure after 5 iterations: mark as blocked, continue with others
- When all independent teammates finish: proceed to merge

### Phase 4: Worktree Cleanup → Merge の順（厳守）

`--delete-branch` は branch が worktree に checked-out 状態だと local 削除に失敗するため、**worktree 削除を先に行う。**

**worktree 削除（branch を free にする）:**

```bash
# 各 worktree を削除（branch がどこにも checked-out されていない状態にする）
git worktree remove /workspace/.worktrees/pr-group-{n} --force
```

**マージ（local + remote の branch も削除）:**

```bash
# For each PR (no dependency order needed -- they're independent)
gh pr merge <pr-number> --squash --delete-branch
```

### Phase 5: Handle Dependent Groups

If there are groups that depend on now-merged groups:

1. Pull latest main
2. Repeat Step 6B Phase 1-4 for the next batch of unblocked groups
3. Continue until all groups are processed

### Phase 6: Final Sync

```bash
git pull origin main
```

### Phase 7: Dismiss Team

Dismiss the agent team after all PRs are merged and worktrees cleaned up.

---

## Step 7: Report

Print summary:

```
## PR Summary
| # | Group | PR | Status | Lines |
|---|-------|----|--------|-------|
| 1 | feat: add location picker | #142 | merged | 156 |
| 2 | fix: date range validation | #143 | merged | 89 |

Mode: {sequential | parallel (Agent Teams)}
Total PRs: {N} | Merged: {X} | Failed: {Y}
```

## Step 8: Task Closure

After all PRs are merged, close related tasks:

```bash
./scripts/linear-done.sh TSU-xxx
```

Update DASHBOARD.md if applicable.

## Rules

- **ALWAYS create PRs automatically** - Never just push and tell user to create PR manually
- **All checks must pass** before pushing (test, lint, type check, build)
- **Max 200 lines per PR** (additions + deletions)
- **Title MUST use conventional commits** format
- **One logical change per PR** - independently reviewable
- **No uncommitted changes** - commit or stash first
- **Dependencies first** - if PR B depends on PR A, merge A first
- **Use `gh pr create`** - Not just `git push`
- **Parallel when possible** - Use Agent Teams for 2+ independent groups
- **Sequential fallback** - Always works, even without Agent Teams

## PR Workflow Details

### Complete PR Lifecycle
1. Create/update PR
2. Wait for CI checks (`gh pr checks`) — all must pass
3. If CI fails: fix iteratively, go back to 2
4. Check for PR review comments (`gh pr view <number> --comments`)
5. Address relevant comments, push fixes, go back to 2
6. **worktree を先に削除**（`git worktree remove $WT --force`）— branch を free にする
7. Merge (`gh pr merge <number> --squash --delete-branch`) — worktree 削除後に実行
8. `git pull origin main`
9. Clean up merged branches (see below)

> **Why この順序:** `gh pr merge --delete-branch` は merge 後に local branch を削除しようとする。branch が worktree に checked-out されたままだと local 削除に失敗してコマンドが exit 1 を返す（merge 自体は成功するが、自動化スクリプトが失敗扱いする原因になる）。

### When to merge automatically
- Docs, config, small fixes, refactoring (no behavior changes)

### Wait for user approval when
- Breaking changes, major structural decisions, large features

### Creating Multiple PRs from Grouped Changes
For each group:
1. `git worktree add .worktrees/<branch-name> -b <branch-name>`
2. `git -C $WT add <specific-files>` (NOT `git add .`)
3. `git -C $WT status` — verify only intended files
4. `git -C $WT commit -m "..."`
5. `git -C $WT push -u origin HEAD && (cd $WT && gh pr create ...)`
6. `git worktree remove $WT --force` — **先に worktree 削除**
7. `gh pr merge <number> --squash --delete-branch` — **その後マージ**
8. `git pull origin main`
9. Repeat

### Post-Merge Cleanup
```bash
# List local branches (excluding main)
git branch | grep -v "^\* main$" | grep -v "^  main$" | sed 's/^[* ] //'
# Cross-reference with merged PRs
gh pr list --state merged --json headRefName --jq '.[].headRefName'
# Delete merged branches
git branch -D <merged-branches>
# Prune stale remotes
git remote prune origin
```
Notes: `git branch --merged` doesn't detect squash-merged — use `gh pr list`. Use `-D` for squash-merged. Never delete main/master.
