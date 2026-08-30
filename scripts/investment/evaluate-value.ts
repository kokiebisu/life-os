/**
 * 候補ティッカー + 実データ（yahoo-finance2）を Claude に渡して、
 * バリュー基準で 3〜5 銘柄に絞り、1 年 thesis とリスクを生成する。
 */

import { callClaude } from "../lib/claude";
import { extractJson } from "./util-json";
import type { Theme, Candidate, Fundamentals, ValuePick } from "./types";

const SYSTEM = `あなたは長期バリュー投資の意思決定に長けたアナリストです。
PER / PBR / ROE / FCF / 配当利回り / 負債比率 / 時価総額 / 52週レンジ を見て、
過小評価かつクオリティのある銘柄を選びます。バリュートラップ（割安に見えて構造的に衰退）には特に注意します。
教育目的の連想練習であり、投資助言ではありません。「買え」「売れ」のような断定的トーンは使わないでください。`;

function formatNumber(v: number | null, fmt: "raw" | "pct" | "money" = "raw"): string {
  if (v === null) return "—";
  if (fmt === "pct") return `${(v * 100).toFixed(1)}%`;
  if (fmt === "money") {
    if (Math.abs(v) >= 1e12) return `${(v / 1e12).toFixed(2)}T`;
    if (Math.abs(v) >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
    if (Math.abs(v) >= 1e6) return `${(v / 1e6).toFixed(2)}M`;
    return v.toFixed(0);
  }
  return Number.isInteger(v) ? v.toString() : v.toFixed(2);
}

function fundamentalsTable(fundamentals: Fundamentals[], candidates: Candidate[]): string {
  const lines = [
    "| ticker | name | sector | price | mkt cap | PER(trail) | PER(fwd) | PBR | ROE | div yield | D/E | FCF | 52w range | 候補理由 |",
    "|---|---|---|---|---|---|---|---|---|---|---|---|---|---|",
  ];
  for (const f of fundamentals) {
    const cand = candidates.find((c) => c.ticker === f.ticker);
    const rangeLow = formatNumber(f.fiftyTwoWeekLow);
    const rangeHigh = formatNumber(f.fiftyTwoWeekHigh);
    const range = f.fiftyTwoWeekLow !== null && f.fiftyTwoWeekHigh !== null ? `${rangeLow}-${rangeHigh}` : "—";
    lines.push(
      `| ${f.ticker} | ${f.name} | ${f.sector ?? "—"} | ${formatNumber(f.price)} ${f.currency} | ${formatNumber(f.marketCap, "money")} | ${formatNumber(f.trailingPE)} | ${formatNumber(f.forwardPE)} | ${formatNumber(f.priceToBook)} | ${formatNumber(f.returnOnEquity, "pct")} | ${formatNumber(f.dividendYield, "pct")} | ${formatNumber(f.debtToEquity)} | ${formatNumber(f.freeCashFlow, "money")} | ${range} | ${cand?.rationale ?? "—"} |`,
    );
  }
  return lines.join("\n");
}

export async function evaluateValue(
  theme: Theme,
  candidates: Candidate[],
  fundamentals: Fundamentals[],
): Promise<{ picks: ValuePick[]; overallRisks: string[] }> {
  const table = fundamentalsTable(fundamentals, candidates);

  const userPrompt = `テーマ「${theme.title}」の候補銘柄について、**バリュー基準で 3〜5 銘柄に絞り**、1 年スパンの thesis と主なリスクを生成してください。

テーマ背景: ${theme.reasoning}

候補一覧（yahoo-finance2 実データ。null は取得できなかった値）:

${table}

絞り込み基準:
- **割安性**: PER（特に forward）が同セクター平均と比べて低い、PBR が低い、FCF yield が出ている、配当利回りが妥当
- **クオリティ**: ROE が安定しているか、負債比率が極端でないか
- **構造的優位**: テーマと因果でつながる事業を持っているか
- **バリュートラップ警告**: 数字が割安でも、構造的衰退・利益縮小傾向・粉飾疑惑等があれば候補から外す

注意:
- 数字が null の銘柄は不確実性が高いので、選ぶ場合は thesis の中で「データ未取得」と明記
- 「買え」「売れ」のような断定は避け、「〜の点でアンダーバリューと見ている」「リスクは〜」のように記述
- thesis は 1 年スパンの「なぜこれが報われるか」を 2〜3 文で

以下の JSON 形式 **だけ** を出力してください（コードフェンス・前置きなし）:
{
  "picks": [
    {
      "ticker": "AAPL",
      "name": "Apple Inc.",
      "thesis": "（1 年スパンで何が報われるか、2〜3 文）",
      "catalysts": ["（カタリスト 1）", "（カタリスト 2）"],
      "risks": ["（個別リスク 1）", "（個別リスク 2）"]
    }
  ],
  "overallRisks": ["（テーマ全体に効くリスク 1）", "（テーマ全体に効くリスク 2）"]
}`;

  const out = await callClaude(
    [{ role: "user", content: userPrompt }],
    { system: SYSTEM, maxTurns: 1, model: "claude-opus-4-7", maxTokens: 3072 },
  );

  const parsed = extractJson(out) as { picks: Array<Omit<ValuePick, "fundamentals">>; overallRisks: string[] };
  if (!parsed.picks || !Array.isArray(parsed.picks) || parsed.picks.length === 0) {
    throw new Error(`evaluate-value: invalid JSON from Claude:\n${out}`);
  }

  const fundMap = new Map(fundamentals.map((f) => [f.ticker.toUpperCase(), f]));
  const picks: ValuePick[] = parsed.picks
    .map((p) => {
      const f = fundMap.get(p.ticker.toUpperCase());
      if (!f) return null;
      return {
        ticker: p.ticker,
        name: p.name,
        thesis: p.thesis,
        catalysts: p.catalysts ?? [],
        risks: p.risks ?? [],
        fundamentals: f,
      };
    })
    .filter((p): p is ValuePick => p !== null);

  return { picks, overallRisks: parsed.overallRisks ?? [] };
}
