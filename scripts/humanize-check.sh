#!/usr/bin/env bash
# humanize-ja PostToolUse hook
# aspects/job/ 配下のファイルが Edit/Write された後、AI 臭の可能性ある表現を検知して
# Claude にコンテキストを返す。検知のみで blocking はしない。
#
# パターンの追加・削除は skills/humanize-ja/patterns.md と整合させる。

set -u

# stdin から file_path を取得
INPUT=$(cat)
F=$(printf '%s' "$INPUT" | jq -r '.tool_input.file_path // .tool_response.filePath // empty' 2>/dev/null || true)

# aspects/job/ 配下の md でなければスキップ
case "$F" in
  */aspects/job/*.md) ;;
  *) exit 0 ;;
esac

# ファイルが読めなければスキップ
[ -f "$F" ] || exit 0

# v3.1 NG パターン (humanize-ja patterns.md C1, C2, C7, C9 由来)
PATTERNS='組み込み|最大化|横断的に|一貫して|自分が|自身が|自身も|二重の技術的不確実性|複雑なステークホルダー|構造的な支援|経験してきました|引き受け'

HITS=$(grep -nE "$PATTERNS" "$F" 2>/dev/null || true)

# v3.2 JP-EN 全角半角境界スペース (patterns.md C10 由来)
# perl の \p{sc=Han} (Script not Script_Extensions) で 〜 (U+301C) の誤マッチを回避
SPACE_HITS=$(perl -CSD -ne 'print "$.:$_" if /(\p{sc=Han}|\p{sc=Hiragana}|\p{sc=Katakana}) [A-Za-z0-9%]|[A-Za-z0-9%] (\p{sc=Han}|\p{sc=Hiragana}|\p{sc=Katakana})/' "$F" 2>/dev/null || true)

if [ -z "$HITS" ] && [ -z "$SPACE_HITS" ]; then
  exit 0
fi

DETAIL=""
if [ -n "$HITS" ]; then
  DETAIL="検知箇所:
${HITS}"
fi
if [ -n "$SPACE_HITS" ]; then
  if [ -n "$DETAIL" ]; then
    DETAIL="${DETAIL}

JP-EN 全角半角境界スペース (C10):
${SPACE_HITS}"
  else
    DETAIL="JP-EN 全角半角境界スペース (C10):
${SPACE_HITS}"
  fi
fi

# Claude に通知 (additionalContext で再 humanize を促す)
MSG="humanize-ja: $F に AI 臭パターンを検知しました。/humanize で修正を検討してください。

${DETAIL}"

jq -nc \
  --arg msg "$MSG" \
  '{systemMessage: $msg, hookSpecificOutput: {hookEventName: "PostToolUse", additionalContext: $msg}}'
