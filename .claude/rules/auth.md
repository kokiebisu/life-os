# 認証ルール（厳守）

## OAuth token のみ使用 / API Key 禁止

**Anthropic / Claude 関連のサービスへ認証するときは、OAuth token を使う。** API Key (`sk-ant-...`) は基本使わない。

### 対象

- Claude Code CLI
- Claude Agent SDK
- Anthropic SDK (`@anthropic-ai/sdk`, `anthropic` Python SDK)
- 自作のスクリプト・ツールが Claude API を叩く場合
- 新しい開発で Anthropic 系サービスに接続するとき

### 理由

- OAuth token は Claude Code のサブスクリプションに紐づくため、別課金が発生しない
- API Key は従量課金が別計上され、コスト管理が分散する
- 1人リポジトリなのでサブスク経由で十分

### やること

1. SDK / スクリプトを書くときは OAuth token (`CLAUDE_CODE_OAUTH_TOKEN` 等の環境変数) を使う
2. `ANTHROPIC_API_KEY` を要求するコードを書かない
3. ドキュメント・README で認証手順を書くときも OAuth を案内する

### 例外（ユーザーが明示的に許可した場合のみ）

- API Key でしか動かない機能（バッチ API 等）を使う必要があり、ユーザーが明示的に「API Key で OK」と言ったとき
- 例外を使う場合も `.env` に入れて gitignore する（`.ai/rules/security.md` 参照）

迷ったら OAuth。API Key を使う前に必ずユーザーに確認する。
