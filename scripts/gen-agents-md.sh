#!/usr/bin/env bash
# Generates AGENTS.md from CLAUDE.md + rules + skills summaries
# Rules are read from .claude/rules/ when present, falling back to .agents/rules/.
# Run this after editing .claude/rules/, .agents/rules/, .agents/skills/, or CLAUDE.md

set -e

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUTPUT="$REPO_ROOT/AGENTS.md"
RULES_DIR="$REPO_ROOT/.claude/rules"
if [ ! -d "$RULES_DIR" ]; then
  RULES_DIR="$REPO_ROOT/.agents/rules"
fi

{
  # Main instructions
  cat "$REPO_ROOT/CLAUDE.md"
  echo ""

  # Rules (full content)
  for f in "$RULES_DIR/"*.md; do
    echo "---"
    echo ""
    cat "$f"
    echo ""
  done

  # Commands (summaries only — full definitions in .agents/skills/<name>/SKILL.md)
  echo "---"
  echo ""
  echo "## Available Commands"
  echo ""
  echo "コマンドを呼び出すときは、対応する \`.agents/skills/<name>/SKILL.md\` を読んでその指示に従うこと。"
  echo ""

  for skill_dir in "$REPO_ROOT/.agents/skills/"/*/; do
    name="$(basename "$skill_dir")"
    f="$skill_dir/SKILL.md"
    [ -f "$f" ] || continue
    # Extract description from frontmatter, fallback to first heading
    desc="$(awk '
      /^---$/ { if (fm==0) { fm=1; next } else { fm=0; next } }
      fm==1 && /^description:/ { sub(/^description:[[:space:]]*/, ""); print; exit }
    ' "$f")"
    if [ -z "$desc" ]; then
      desc="$(awk '
        /^---$/ { if (fm==0) { fm=1; next } else { fm=0; next } }
        fm==1 { next }
        /^#/ { sub(/^#+ /, ""); print; exit }
      ' "$f")"
    fi
    echo "- **\`/$name\`** — $desc → \`.agents/skills/${name}/SKILL.md\`"
  done
  echo ""
} > "$OUTPUT"

size=$(wc -c < "$OUTPUT")
echo "Generated $OUTPUT (${size} bytes)"
if [ "$size" -gt 32768 ]; then
  echo "WARNING: AGENTS.md exceeds 32KB (${size} bytes)."
fi
