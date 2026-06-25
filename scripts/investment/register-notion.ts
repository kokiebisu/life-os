/**
 * 投資ヒント DB に 1 ページを作成する。
 *
 * プロパティは最小（名前 / 日付 / カテゴリ / 銘柄 / ソース / ステータス）。
 * 詳細はページ本文に書く（CLAUDE.md notion-workflow ルール準拠）。
 */

import { getScheduleDbConfig, notionFetch, pickCover, todayJST } from "../lib/notion";
import type { Analysis, ValuePick } from "./types";

type Block = Record<string, unknown>;

const h2 = (text: string): Block => ({
  type: "heading_2",
  heading_2: { rich_text: [{ type: "text", text: { content: text } }] },
});
const h3 = (text: string): Block => ({
  type: "heading_3",
  heading_3: { rich_text: [{ type: "text", text: { content: text } }] },
});
const p = (text = ""): Block => ({
  type: "paragraph",
  paragraph: { rich_text: text ? [{ type: "text", text: { content: text } }] : [] },
});
const bullet = (text: string): Block => ({
  type: "bulleted_list_item",
  bulleted_list_item: { rich_text: [{ type: "text", text: { content: text } }] },
});
const callout = (text: string, emoji: string): Block => ({
  type: "callout",
  callout: { rich_text: [{ type: "text", text: { content: text } }], icon: { type: "emoji", emoji } },
});
const code = (text: string, language = "markdown"): Block => ({
  type: "code",
  code: { rich_text: [{ type: "text", text: { content: text } }], language },
});
const divider = (): Block => ({ type: "divider", divider: {} });

function fmtNum(v: number | null, fmt: "raw" | "pct" | "money" = "raw"): string {
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

function buildPickBlocks(pick: ValuePick): Block[] {
  const f = pick.fundamentals;
  const meta = [
    f.sector ? `🏷 ${f.sector}` : null,
    f.industry ? `🏭 ${f.industry}` : null,
    f.price !== null ? `💰 ${fmtNum(f.price)} ${f.currency}` : null,
    f.marketCap !== null ? `📊 時価総額 ${fmtNum(f.marketCap, "money")}` : null,
  ].filter(Boolean).join("  ·  ");

  const metrics =
    `PER(trail): ${fmtNum(f.trailingPE)}  |  PER(fwd): ${fmtNum(f.forwardPE)}  |  PBR: ${fmtNum(f.priceToBook)}\n` +
    `ROE: ${fmtNum(f.returnOnEquity, "pct")}  |  配当利回り: ${fmtNum(f.dividendYield, "pct")}  |  D/E: ${fmtNum(f.debtToEquity)}\n` +
    `FCF: ${fmtNum(f.freeCashFlow, "money")}  |  52週レンジ: ${fmtNum(f.fiftyTwoWeekLow)} - ${fmtNum(f.fiftyTwoWeekHigh)}`;

  const flagged = pick.sanity && pick.sanity.warnings.length > 0;
  const titleSuffix = flagged ? " 🚨" : "";
  const blocks: Block[] = [
    h3(`${pick.ticker} — ${pick.name}${titleSuffix}`),
  ];

  if (flagged && pick.sanity) {
    const summary = `5日: ${pick.sanity.pct5d.toFixed(1)}%  ·  30日: ${pick.sanity.pct30d.toFixed(1)}%  ·  180日高値からの drawdown: ${pick.sanity.drawdownPct.toFixed(1)}%`;
    const detail = pick.sanity.warnings.map((w) => `・${w}`).join("\n");
    blocks.push(callout(`直近の値動きに警告。Claude の thesis はこのドローダウン直前のスナップショットに基づきます。最新の earnings / ニュースで根拠が崩れている可能性があるため、採用前に必ず原因を確認してください。\n\n${summary}\n\n${detail}`, "🚨"));
  }

  blocks.push(meta ? callout(meta, "🏢") : p());
  blocks.push(code(metrics, "plain text"));
  blocks.push(p(pick.thesis));

  if (pick.catalysts.length > 0) {
    blocks.push(p("**カタリスト**"));
    for (const c of pick.catalysts) blocks.push(bullet(c));
  }
  if (pick.risks.length > 0) {
    blocks.push(p("**リスク**"));
    for (const r of pick.risks) blocks.push(bullet(r));
  }
  return blocks;
}

export function buildPageBlocks(analysis: Analysis): Block[] {
  const blocks: Block[] = [
    callout(
      `教育目的の連想練習。投資助言ではありません。バリュー指標は yahoo-finance2 の遅延データに基づきます。最終判断はご自身で公式 IR 等で確認の上行ってください。`,
      "⚠️",
    ),
  ];

  const flaggedPicks = analysis.picks.filter((p) => p.sanity && p.sanity.warnings.length > 0);
  if (flaggedPicks.length > 0) {
    const tickers = flaggedPicks.map((p) => p.ticker).join(", ");
    blocks.push(callout(`直近の値動きに異常がある銘柄が ${flaggedPicks.length} 件あります: ${tickers}。各銘柄の警告ブロックを必ず確認してください。`, "🚨"));
  }

  blocks.push(
    h2("ニュース要約"),
    p(analysis.newsSummary),
    h2("テーマ"),
    p(analysis.theme.title),
    p(analysis.theme.reasoning),
    divider(),
    h2("注目銘柄"),
  );

  for (const pick of analysis.picks) {
    blocks.push(...buildPickBlocks(pick));
    blocks.push(divider());
  }

  if (analysis.overallRisks.length > 0) {
    blocks.push(h2("テーマ全体のリスク"));
    for (const r of analysis.overallRisks) blocks.push(bullet(r));
  }

  if (analysis.theme.primarySourceLink) {
    blocks.push(h2("ソース"));
    blocks.push(p(analysis.theme.primarySourceLink));
  }

  return blocks;
}

export async function registerNotion(analysis: Analysis): Promise<string> {
  const { apiKey, dbId, config } = getScheduleDbConfig("investment");

  const tickers = analysis.picks.map((p) => p.ticker);

  const properties: Record<string, unknown> = {
    [config.titleProp]: {
      title: [{ type: "text", text: { content: analysis.theme.title } }],
    },
    [config.dateProp]: {
      date: { start: analysis.date },
    },
    カテゴリ: { select: { name: analysis.theme.category } },
    銘柄: { multi_select: tickers.map((t) => ({ name: t })) },
    ステータス: { select: { name: "新規" } },
  };

  if (analysis.theme.primarySourceLink && /^https?:\/\//.test(analysis.theme.primarySourceLink)) {
    properties.ソース = { url: analysis.theme.primarySourceLink };
  }

  const blocks = buildPageBlocks(analysis);

  const initialBlocks = blocks.slice(0, 90);
  const remainingBlocks = blocks.slice(90);

  const res = await notionFetch(apiKey, "/pages", {
    parent: { database_id: dbId },
    icon: config.defaultIcon ? { type: "emoji", emoji: config.defaultIcon } : undefined,
    cover: pickCover(),
    properties,
    children: initialBlocks,
  });

  const pageId = res.id as string;

  if (remainingBlocks.length > 0) {
    for (let i = 0; i < remainingBlocks.length; i += 90) {
      const chunk = remainingBlocks.slice(i, i + 90);
      await notionFetch(apiKey, `/blocks/${pageId}/children`, { children: chunk }, "PATCH");
    }
  }

  return pageId;
}

export function todayJSTDate(): string {
  return todayJST();
}
