# 自動化ルール

## Claude 依存の自動化を避ける（厳守）

定期実行・cron 系の自動化は **GitHub Actions / shell スクリプト / TypeScript スクリプトを優先**する。Claude routine（`/schedule`）は提案しない・使わない。

**Why:** Claude への依存を最小化したい。Claude routine は claude.ai の API・サブスクリプション・モデル可用性に依存するため、長期運用に向かない。判断ロジックの再現性・コスト・可観測性すべてで GitHub Actions が優位。

**How to apply:**

- 「定期実行したい」「cron で回したい」と言われたら → **GitHub Actions ワークフローを提案する**
- 「これ自動化したい」→ deterministic な箇所はスクリプト化、判断が必要な箇所のみ Claude を呼ぶ設計にする
- `/schedule` の自動オファー（feature flag のクリーンアップ等）は控える
- 既存の参考実装: `.github/workflows/gym-auto.yml`, `.github/workflows/kondate-auto.yml`, `.github/workflows/monthly-tidy.yml`
