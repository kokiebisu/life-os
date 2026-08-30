/**
 * 選ばれたテーマに沿うバリュー候補銘柄を 8〜15 個ピックアップする（wide net）。
 * この段階ではティッカーと簡易理由だけ。財務指標は次段で取る。
 */

import { callClaude } from "../lib/claude";
import { extractJson } from "./util-json";
import type { Theme, Candidate } from "./types";

const SYSTEM = `あなたは長期バリュー投資のスクリーニングに長けたアナリストです。
PER / PBR / FCF / 配当利回り / 負債比率を意識して、市場に過小評価されているか、構造的優位を持つ銘柄を選びます。
教育目的の連想練習であり、投資助言ではありません。`;

export async function pickCandidates(theme: Theme): Promise<Candidate[]> {
  const userPrompt = `以下のテーマに沿って、**1 年以上のスパンで保有を検討する価値のあるバリュー寄り候補銘柄を 8〜15 個**挙げてください。

テーマ: ${theme.title}
背景: ${theme.reasoning}

選定基準:
- 単発の話題株や明らかな割高グロース株は避ける
- できるだけ「事業実体があり、利益・FCF を生んでいる」企業
- **米国上場銘柄のみ**（NYSE / Nasdaq）。日本上場（.T サフィックス）・その他国は対象外。米国上場 ETF / ADR は OK
- 同じテーマでも 1次連想（直接受益）/ 2次連想（バリューチェーン）/ 3次連想（インフラ）に幅を持たせる
- 仮想通貨そのものは選ばない。仮想通貨セクター関連株（COIN, MARA 等）は OK

以下の JSON 配列 **だけ** を出力してください（コードフェンス・前置きなし）:
[
  { "ticker": "AAPL", "name": "Apple Inc.", "rationale": "（1〜2 文の選定理由）" },
  ...
]`;

  const out = await callClaude(
    [{ role: "user", content: userPrompt }],
    { system: SYSTEM, maxTurns: 1, model: "claude-opus-4-7", maxTokens: 2048 },
  );

  const parsed = extractJson(out) as Candidate[];
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error(`pick-candidates: invalid JSON array from Claude:\n${out}`);
  }
  return parsed.filter((c) => typeof c.ticker === "string" && c.ticker.trim().length > 0);
}

if (import.meta.main) {
  const { fetchNews } = await import("./fetch-news");
  const { selectTheme } = await import("./select-theme");
  const news = await fetchNews();
  const theme = await selectTheme(news);
  console.log("Theme:", theme.title);
  const candidates = await pickCandidates(theme);
  console.log(JSON.stringify(candidates, null, 2));
}
