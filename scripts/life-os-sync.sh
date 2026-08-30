#!/usr/bin/env bash
# life-os-sync.sh — bidirectional sync helper between life and life-os
# Usage:
#   ./scripts/life-os-sync.sh status        # show divergence
#   ./scripts/life-os-sync.sh pull          # life-os/main → life (merge)
#   ./scripts/life-os-sync.sh push          # push to origin; auto cherry-pick generic commits to life-os
#   ./scripts/life-os-sync.sh contrib       # show commits safe to push to life-os

set -e

REMOTE="life-os"
UPSTREAM_BRANCH="life-os/main"

cmd="${1:-status}"

case "$cmd" in
  status)
    echo "=== life-os fork status ==="
    git fetch "$REMOTE" --quiet
    ahead=$(git log --oneline "$UPSTREAM_BRANCH..HEAD" | wc -l | tr -d ' ')
    behind=$(git log --oneline "HEAD..$UPSTREAM_BRANCH" | wc -l | tr -d ' ')
    echo "life is $ahead commits ahead, $behind commits behind life-os"
    echo ""
    if [ "$behind" -gt 0 ]; then
      echo "--- Commits in life-os not yet in life ---"
      git log --oneline "HEAD..$UPSTREAM_BRANCH"
      echo ""
    fi
    if [ "$ahead" -gt 0 ]; then
      echo "--- Recent commits in life not yet in life-os ---"
      git log --oneline "$UPSTREAM_BRANCH..HEAD" | head -20
    fi
    ;;

  pull)
    echo "=== Merging life-os/main into life ==="
    git fetch "$REMOTE"
    behind=$(git log --oneline "HEAD..$UPSTREAM_BRANCH" | wc -l | tr -d ' ')
    if [ "$behind" -eq 0 ]; then
      echo "Already up to date with life-os/main."
      exit 0
    fi

    # Read private paths from .life-private
    PRIVATE_FILE=".life-private"
    private_paths=()
    if [ -f "$PRIVATE_FILE" ]; then
      while IFS= read -r line; do
        [[ "$line" =~ ^#.*$ || -z "$line" ]] && continue
        private_paths+=("${line%/}")  # strip trailing slash
      done < "$PRIVATE_FILE"
    fi

    # Run merge (allow failures — we fix conflicts below)
    git merge "$UPSTREAM_BRANCH" --no-ff -m "chore: merge life-os/main upstream" || true

    # Restore all private paths to HEAD (our version), resolving any delete/modify conflicts
    if [ ${#private_paths[@]} -gt 0 ]; then
      for p in "${private_paths[@]}"; do
        git checkout HEAD -- "$p" 2>/dev/null || true
      done
      git add "${private_paths[@]}" 2>/dev/null || true
    fi

    # Check for remaining unresolved conflicts outside private paths
    remaining=$(git diff --name-only --diff-filter=U 2>/dev/null || true)
    if [ -n "$remaining" ]; then
      echo ""
      echo "⚠️  Unresolved conflicts in non-private files:"
      echo "$remaining"
      echo "Resolve manually, then: git commit && git push origin main"
    else
      git commit --no-edit 2>/dev/null || git commit -m "chore: merge life-os/main upstream"
      echo ""
      echo "✅ Done. Push with: git push origin main"
    fi
    ;;

  push)
    git fetch origin --quiet
    git fetch "$REMOTE" --quiet

    # Load private paths
    private_paths=()
    if [ -f ".life-private" ]; then
      while IFS= read -r line; do
        [[ "$line" =~ ^#.*$ || -z "$line" ]] && continue
        private_paths+=("${line%/}")
      done < ".life-private"
    fi

    # Classify each unpushed commit
    generic_commits=()
    personal_commits=()
    while IFS= read -r hash; do
      [ -z "$hash" ] && continue
      is_personal=false
      while IFS= read -r file; do
        for p in "${private_paths[@]}"; do
          if [[ "$file" == "$p"* || "$file" == "$p" ]]; then
            is_personal=true
            break 2
          fi
        done
      done < <(git diff-tree --no-commit-id -r --name-only "$hash")
      if $is_personal; then
        personal_commits+=("$hash")
      else
        generic_commits+=("$hash")
      fi
    done < <(git log --reverse --format="%H" origin/main..HEAD)

    # Summary
    echo "=== Push classification ==="
    echo "Generic (→ origin + life-os): ${#generic_commits[@]} commits"
    echo "Personal (→ origin only):     ${#personal_commits[@]} commits"
    echo ""

    # Push all to origin
    git push origin main

    # Cherry-pick generic commits to life-os
    if [ ${#generic_commits[@]} -gt 0 ]; then
      echo "Cherry-picking ${#generic_commits[@]} generic commit(s) to life-os..."
      git checkout -b _life-os-push "$UPSTREAM_BRANCH"
      failed=false
      for hash in "${generic_commits[@]}"; do
        msg=$(git log --format="%s" -1 "$hash")
        if git cherry-pick "$hash" --quiet; then
          echo "  ✅ $msg"
        else
          echo "  ⚠️  conflict: $msg — skipping"
          git cherry-pick --abort 2>/dev/null || true
          failed=true
        fi
      done
      git push "$REMOTE" _life-os-push:main
      git checkout main
      git branch -D _life-os-push
      $failed && echo "" && echo "Some commits had conflicts and were skipped."
    fi

    echo ""
    echo "✅ Done."
    ;;

  contrib)
    echo "=== Commits potentially safe to contribute to life-os ==="
    echo "(touches only generic paths: scripts/, aspects/diet|gym|study config, .claude/, CLAUDE.md, etc.)"
    echo ""
    git fetch "$REMOTE" --quiet
    git log --oneline "$UPSTREAM_BRANCH..HEAD" -- \
      scripts/ \
      "aspects/diet/CLAUDE.md" "aspects/diet/aspect.json" \
      "aspects/gym/CLAUDE.md" "aspects/gym/aspect.json" "aspects/gym/profile.md" \
      "aspects/study/CLAUDE.md" "aspects/study/aspect.json" \
      ".claude/rules/" ".claude/skills/" \
      "CLAUDE.md" "package.json" "tsconfig.json" "life.config.example.json" \
      "bun.lock" \
      2>/dev/null || true
    ;;

  *)
    echo "Usage: $0 [status|pull|push|contrib]"
    exit 1
    ;;
esac
