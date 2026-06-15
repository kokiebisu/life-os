/**
 * LLM プロバイダー抽象レイヤー
 *
 * LLM_PROVIDER 環境変数で切り替える（デフォルト: claude）
 * - claude: claude -p CLI 経由（Claude Code OAuth 認証）
 * - openai: OpenAI SDK 経由（OPENAI_API_KEY 必須）
 */

import { callClaude } from "./claude.ts";
import OpenAI from "openai";

export interface LLMMessage {
  role: "user" | "assistant";
  content: string;
}

export interface LLMOptions {
  model?: string;
  maxTokens?: number;
  system?: string;
  /** Claude Code CLI のみ有効。OpenAI では無視される。 */
  allowedTools?: string[];
  /** Claude Code CLI のみ有効。OpenAI では無視される。 */
  maxTurns?: number;
}

/** Claude モデル名 → OpenAI モデル名のマッピング */
const MODEL_MAP: Record<string, string> = {
  "claude-haiku-4-5-20251001": "gpt-4o-mini",
  "claude-haiku-4-5": "gpt-4o-mini",
  "claude-sonnet-4-5": "gpt-4o",
  "claude-sonnet-4-6": "gpt-4o",
  "claude-opus-4-6": "o1",
};

export async function callLLM(
  messages: LLMMessage[],
  options: LLMOptions = {},
): Promise<string> {
  const provider = process.env.LLM_PROVIDER ?? "claude";
  if (provider === "openai") {
    return callOpenAI(messages, options);
  }
  return callClaude(messages, options);
}

async function callOpenAI(
  messages: LLMMessage[],
  options: LLMOptions,
): Promise<string> {
  const client = new OpenAI(); // OPENAI_API_KEY を環境変数から読む
  const claudeModel = options.model ?? "claude-haiku-4-5-20251001";
  const model = MODEL_MAP[claudeModel] ?? "gpt-4o-mini";

  const response = await client.chat.completions.create({
    model,
    max_tokens: options.maxTokens ?? 4096,
    messages: [
      ...(options.system
        ? [{ role: "system" as const, content: options.system }]
        : []),
      ...messages.map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      })),
    ],
  });

  return response.choices[0]?.message?.content ?? "";
}
