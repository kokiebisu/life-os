/**
 * register-rebalance-notion — RebalanceReport を Notion DB「Portfolio Rebalance」に登録する。
 *
 * DB は事前に手作成済み（NOTION_REBALANCE_DB env）。プロパティ:
 *   名前 (title) / 日付 (date) / 保有銘柄数 (number) / Cash USD (number) / Cash CAD (number)
 *   / 警告銘柄 (multi_select) / ステータス (select)
 *
 * ページ本文には markdown report を rich_text に分解して書き込む。
 */

import { getScheduleDbConfig, notionFetch, pickCover } from "../lib/notion";
import type { RebalanceReport } from "./types";
import { renderRebalanceMarkdown } from "./write-rebalance-report";

type Block = Record<string, unknown>;

const p = (text = ""): Block => ({
  type: "paragraph",
  paragraph: { rich_text: text ? [{ type: "text", text: { content: text } }] : [] },
});
const code = (text: string, language = "markdown"): Block => ({
  type: "code",
  code: { rich_text: [{ type: "text", text: { content: text.slice(0, 1900) } }], language },
});
const callout = (text: string, emoji: string): Block => ({
  type: "callout",
  callout: { rich_text: [{ type: "text", text: { content: text } }], icon: { type: "emoji", emoji } },
});

function splitMarkdownToCodeBlocks(md: string, chunkSize = 1900): Block[] {
  const blocks: Block[] = [];
  for (let i = 0; i < md.length; i += chunkSize) {
    blocks.push(code(md.slice(i, i + chunkSize), "markdown"));
  }
  return blocks;
}

export async function registerRebalanceNotion(report: RebalanceReport): Promise<string> {
  const { apiKey, dbId, config } = getScheduleDbConfig("rebalance");

  const usdCash = report.cash.find((c) => c.currency === "USD")?.amount ?? 0;
  const cadCash = report.cash.find((c) => c.currency === "CAD")?.amount ?? 0;
  const warnedTickers = report.holdingDecisions
    .filter((d) => d.sanity && d.sanity.warnings.length > 0)
    .map((d) => d.ticker);

  const properties: Record<string, unknown> = {
    [config.titleProp]: {
      title: [{ type: "text", text: { content: `Rebalance ${report.date}` } }],
    },
    [config.dateProp]: {
      date: { start: report.date },
    },
    保有銘柄数: { number: report.holdingDecisions.length },
    "Cash USD": { number: usdCash },
    "Cash CAD": { number: cadCash },
    警告銘柄: { multi_select: warnedTickers.map((t) => ({ name: t })) },
    ステータス: { select: { name: "新規" } },
  };

  const md = renderRebalanceMarkdown(report);

  const blocks: Block[] = [
    callout(
      `教育目的の連想練習。投資助言ではありません。最終判断はご自身で公式 IR 等で確認の上行ってください。`,
      "⚠️",
    ),
    p(`Investor Profile: 30 歳 / 中長期 / aggressive growth`),
    p(""),
    ...splitMarkdownToCodeBlocks(md),
  ];

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
