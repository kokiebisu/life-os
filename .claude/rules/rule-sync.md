# ルールファイル管理

## `.agents/rules/` 追加時は `.claude/rules/` に symlink を張る（厳守）

`.agents/rules/<new>.md` を新規追加したら、**必ず `.claude/rules/<new>.md` に symlink を張る。**

```bash
cd /workspaces/life/.claude/rules
ln -s ../../.agents/rules/<new>.md <new>.md
```

**Why:** Claude Code は `.claude/rules/*.md` を auto-load する。`.agents/rules/` 直接ではなく `.claude/rules/` の symlink 経由でロードされるため、symlink が無いとルールが認識されない。

**How to apply:**

- `.agents/rules/` に `Write` で新ファイル作成 → 直後に `.claude/rules/` に symlink を張る
- `.agents/rules/<old>.md` を `<new>.md` にリネームしたら、`.claude/rules/` 側の symlink も張り直す
- 動作確認: 次のセッション開始時に system-reminder のロード一覧に新ルールが含まれるか確認

**過去の漏れ:** 新ルールを追加したのに `.claude/rules/` 側に symlink を張り忘れ、次セッションでルールが認識されないまま動いた事例あり（2026-04-29）
