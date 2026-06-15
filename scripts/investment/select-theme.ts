/**
 * ニュース見出し群から「1 年スパンで波及効果の大きそうな長期テーマ」を 1 つ選ぶ。
 */

import { callClaude } from "../lib/claude";
import { extractJson } from "./util-json";
import type { NewsItem, Theme } from "./types";

const SYSTEM = `あなたは長期バリュー投資の連想に長けたアナリストです。
短期の値動きやヘッドラインの瞬発力ではなく、「1 年以上のスパンで波及する構造的トレンド」を見抜くことが仕事です。
教育目的の連想練習であり、投資助言ではありません。「買え」「売れ」のような断定的表現は避けてください。`;

export async function selectTheme(news: NewsItem[]): Promise<Theme> {
  const headlines = news
    .slice(0, 60)
    .map((n, i) => `${i + 1}. [${n.source}] ${n.title}${n.summary ? ` — ${n.summary.slice(0, 160)}` : ""}`)
    .join("\n");

  const userPrompt = `次の最新ニュース見出しの中から、**1 年スパンで構造的に効いてくるテーマを 1 つだけ**選んでください。
短期事象（特定企業の決算サプライズ、地政学の瞬間的緊張など）ではなく、**長期トレンドの兆候**を優先してください。
仮想通貨そのもののテーマは避け、仮想通貨セクター関連株（取引所・マイニング装置・決済等）に転換できる場合のみ採用可。

ニュース見出し:
${headlines}

以下の JSON 形式 **だけ** を出力してください（コードフェンス・前置きなし）:
{
  "title": "（簡潔なテーマ名、20 字以内）",
  "reasoning": "（なぜこれが 1 年スパンで効くか、3-4 文）",
  "primarySourceLink": "（最も関連が深い見出しの URL or '#1' のような番号参照）",
  "category": "株" | "仮想通貨セクター" | "その他"
}`;

  const out = await callClaude(
    [{ role: "user", content: userPrompt }],
    { system: SYSTEM, maxTurns: 1, model: "claude-opus-4-7", maxTokens: 1024 },
  );

  const parsed = extractJson(out) as Partial<Theme>;
  if (!parsed.title || !parsed.reasoning) {
    throw new Error(`select-theme: invalid JSON from Claude:\n${out}`);
  }

  let primarySourceLink = parsed.primarySourceLink ?? "";
  const refMatch = primarySourceLink.match(/^#?(\d+)$/);
  if (refMatch) {
    const idx = Number.parseInt(refMatch[1], 10) - 1;
    if (news[idx]?.link) primarySourceLink = news[idx].link;
  }

  return {
    title: parsed.title,
    reasoning: parsed.reasoning,
    primarySourceLink,
    category: (parsed.category as Theme["category"]) ?? "株",
  };
}

if (import.meta.main) {
  const { fetchNews } = await import("./fetch-news");
  const news = await fetchNews();
  const theme = await selectTheme(news);
  console.log(JSON.stringify(theme, null, 2));
}
