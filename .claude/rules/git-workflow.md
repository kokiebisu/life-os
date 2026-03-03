# Git Workflow

## Commit Message Format
```
<type>: <description>
```
Types: feat, fix, refactor, docs, chore

## コミット後の PR 作成（厳守）
- コミット後は自動で `/pr` を実行する（ユーザーに確認不要）
- PR にはそのセッションで変更されたコミットのみ含める（他の未プッシュコミットは含めない）

## Submodule（sumitsugi）
- `projects/sumitsugi` のサブモジュールポインタ変更は PR に含めない
- サブモジュールの更新は sumitsugi リポジトリ側で管理する
- `git status` に出ても基本スキップする
