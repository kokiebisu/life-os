/**
 * write-rebalance-report — RebalanceReport を markdown に整形してファイル出力する。
 */

import { writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";
import type { RebalanceReport, HoldingDecision, BuyDecision, NewsItem } from "./types";

const REPORTS_DIR = "aspects/investment/reports";

function fmtPct(v: number | null): string {
  if (v === null) return "—";
  return `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`;
}

function fmtPctRaw(v: number | null): string {
  if (v === null) return "—";
  return `${(v * 100).toFixed(1)}%`;
}

function fmtNum(v: number | null, mode: "raw" | "money" = "raw"): string {
  if (v === null) return "—";
  if (mode === "money") {
    if (Math.abs(v) >= 1e12) return `${(v / 1e12).toFixed(2)}T`;
    if (Math.abs(v) >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
    if (Math.abs(v) >= 1e6) return `${(v / 1e6).toFixed(2)}M`;
    return v.toFixed(0);
  }
  return Number.isInteger(v) ? v.toString() : v.toFixed(2);
}

function fmtMoney(v: number): string {
  return `$${v.toLocaleString("en-US")}`;
}

function newsLinks(items: NewsItem[] | { date: string; headline: string; url: string }[]): string[] {
  return items.slice(0, 3).map((n) => {
    if ("title" in n) {
      return `${n.pubDate}: ${n.title} ([source](${n.link}))`;
    }
    return `${n.date}: ${n.headline} ([source](${n.url}))`;
  });
}

function renderHoldingBlock(d: HoldingDecision): string {
  const lines: string[] = [];
  const flagged = d.sanity && d.sanity.warnings.length > 0 ? " 🚨" : "";
  lines.push(`### ${d.ticker} — ${d.action}${flagged}（Confidence: ${d.confidence}）`);
  lines.push(`- **Qty:** ${d.quantity} / **Avg Cost:** $${fmtNum(d.avgCost)} ${d.currency} / **Account:** ${d.account}`);
  if (d.sanity && d.sanity.warnings.length > 0) {
    lines.push(`- **🚨 sanity-check:** ${d.sanity.warnings.join(" / ")}`);
  }
  const pnlSign = d.pnlPct >= 0 ? "+" : "";
  lines.push(`- **Position:** $${fmtNum(d.positionValue)} (${d.positionPct.toFixed(1)}% of portfolio) / **P&L:** ${pnlSign}${d.pnlPct.toFixed(1)}% / 現在価格 $${fmtNum(d.currentPrice)}`);
  if (d.trimPct && d.trimShares !== null && d.trimAmount !== null) {
    lines.push(`- **🔻 売却推奨:** ${d.trimPct}% (~${d.trimShares} 株, ~$${fmtNum(d.trimAmount)} ${d.currency})`);
  }
  if (d.recentNews.length === 0) {
    lines.push(`- **直近ニュース:** 取得できず`);
  } else {
    lines.push(`- **直近ニュース（30日）:**`);
    newsLinks(d.recentNews).forEach((l) => lines.push(`  - ${l}`));
  }
  const techFlag = (d.technicals.return1w ?? 0) <= -10 ? " ⚠️ 1w 急落" : (d.technicals.return1m ?? 0) <= -15 ? " ⚠️ 1m 軟調" : "";
  lines.push(`- **テクニカル:** 1w=${fmtPct(d.technicals.return1w)} / 1m=${fmtPct(d.technicals.return1m)} / 3m=${fmtPct(d.technicals.return3m)} / 6m=${fmtPct(d.technicals.return6m)} / 12m=${fmtPct(d.technicals.return12m)} / drawdown=${fmtPct(d.technicals.drawdownPct)}${techFlag}`);
  lines.push(`- **ファンダ:** PER(trail/fwd)=${fmtNum(d.fundamentals.trailingPE)}/${fmtNum(d.fundamentals.forwardPE)}, ROE=${fmtPctRaw(d.fundamentals.returnOnEquity)}, FCF=${fmtNum(d.fundamentals.freeCashFlow, "money")}`);
  lines.push(`- **Thesis:** ${d.thesis}`);
  lines.push(`- **Sources:** ${d.sources.map((s, i) => `[${i + 1}](${s})`).join(" ")}`);
  return lines.join("\n");
}

function renderBuyBlock(b: BuyDecision): string {
  const lines: string[] = [];
  const trancheFlag = b.trancheRecommended ? " ⚠️ tranche entry 推奨" : "";
  lines.push(`### ${b.ticker} — ${b.action} ${fmtMoney(b.amount)} ${b.currency}（Confidence: ${b.confidence}）${trancheFlag}`);
  lines.push(`- **Source:** ${b.source}`);
  if (b.currentPrice != null) {
    lines.push(`- **現在価格:** $${fmtNum(b.currentPrice)} ${b.currency}`);
  }
  if (b.technicals) {
    const techFlag = (b.technicals.return1w ?? 0) <= -10 ? " ⚠️ 1w 急落" : (b.technicals.return1m ?? 0) <= -15 ? " ⚠️ 1m 軟調" : "";
    lines.push(`- **テクニカル:** 1w=${fmtPct(b.technicals.return1w)} / 1m=${fmtPct(b.technicals.return1m)} / 3m=${fmtPct(b.technicals.return3m)} / 6m=${fmtPct(b.technicals.return6m)} / 12m=${fmtPct(b.technicals.return12m)} / drawdown=${fmtPct(b.technicals.drawdownPct)}${techFlag}`);
  }
  if (b.trancheRecommended) {
    lines.push(`- **⚠️ Tranche entry:** 短期急落により分割エントリ推奨。今回 $${fmtNum(b.amount)} は通常配分の半分以下に縮小済み。残り cash は底打ち確認後または更なる押し目で。`);
  }
  if (b.recentNews.length === 0) {
    lines.push(`- **直近ニュース:** —`);
  } else {
    lines.push(`- **直近ニュース:**`);
    newsLinks(b.recentNews as NewsItem[]).forEach((l) => lines.push(`  - ${l}`));
  }
  lines.push(`- **Thesis:** ${b.thesis}`);
  lines.push(`- **Sources:** ${b.sources.map((s, i) => `[${i + 1}](${s})`).join(" ")}`);
  return lines.join("\n");
}

export function renderRebalanceMarkdown(report: RebalanceReport): string {
  const lines: string[] = [];
  lines.push(`# Portfolio Rebalance — ${report.date}`);
  lines.push("");
  lines.push(`> ⚠️ これは投資助言ではありません。最終的な投資判断はユーザー本人が公式 IR / 証券会社の分析で確認した上で行ってください。`);
  lines.push(`> Investor Profile: 30 歳 / 中長期 / aggressive growth`);
  lines.push("");

  const flagged = report.holdingDecisions.filter((d) => d.sanity && d.sanity.warnings.length > 0);
  const counts = {
    BUY: report.buyDecisions.filter((b) => b.action === "BUY").length,
    ADD: report.buyDecisions.filter((b) => b.action === "ADD").length,
    HOLD: report.holdingDecisions.filter((d) => d.action === "HOLD").length,
    TRIM: report.holdingDecisions.filter((d) => d.action === "TRIM").length,
    SELL: report.holdingDecisions.filter((d) => d.action === "SELL").length,
  };
  lines.push("## Summary");
  lines.push(`- 保有銘柄: ${report.holdingDecisions.length}（うち sanity-check 警告: ${flagged.length}）`);
  const cashStr = report.cash.map((c) => `${fmtMoney(c.amount)} ${c.currency}`).join(" / ");
  const cashDate = report.cash.length > 0 ? report.cash[0].updatedOn : "—";
  lines.push(`- Cash: ${cashStr}（cash.csv: ${cashDate} 更新${report.cashStale ? " ⚠️ stale" : ""}）`);
  lines.push(`- 推奨 actions: BUY ${counts.BUY} / ADD ${counts.ADD} / HOLD ${counts.HOLD} / TRIM ${counts.TRIM} / SELL ${counts.SELL}`);

  // Cash drag warning — aggressive growth profile では cash 比率が高すぎると機会損失
  const CAD_TO_USD = 0.73;
  const totalCashUSDEquiv = report.cash.reduce(
    (sum, c) => sum + (c.currency === "CAD" ? c.amount * CAD_TO_USD : c.amount),
    0,
  );
  const totalHoldingsUSDEquiv = report.holdingDecisions.reduce((sum, d) => {
    const usdEquiv = d.currency === "CAD" ? d.positionValue * CAD_TO_USD : d.positionValue;
    return sum + usdEquiv;
  }, 0);
  const totalPortfolioUSDEquiv = totalHoldingsUSDEquiv + totalCashUSDEquiv;
  if (totalPortfolioUSDEquiv > 0) {
    const cashPct = (totalCashUSDEquiv / totalPortfolioUSDEquiv) * 100;
    if (cashPct >= 15) {
      lines.push(`- **⚠️ Cash drag:** ${cashPct.toFixed(1)}% in cash. aggressive growth profile では 15% 超は機会損失。discovery skill で BUY 候補を出すか、ADD 推奨銘柄に振り向けることを検討。`);
    }
  }
  lines.push("");

  // TRIM/SELL の合計金額（cash 化される予定額）
  const totalTrimUSDEquiv = report.holdingDecisions
    .filter((d) => d.trimAmount)
    .reduce((sum, d) => {
      const usdEquiv = d.currency === "CAD" ? (d.trimAmount ?? 0) * CAD_TO_USD : (d.trimAmount ?? 0);
      return sum + usdEquiv;
    }, 0);
  if (totalTrimUSDEquiv > 0) {
    lines.push(`> 💵 **TRIM/SELL 合計**: ~$${fmtNum(totalTrimUSDEquiv)} USD-equiv が cash 化される予定`);
    lines.push("");
  }

  if (flagged.length > 0) {
    lines.push(`> 🚨 **sanity-check 警告銘柄**: ${flagged.map((d) => d.ticker).join(", ")}。直近の値動き異常を確認してください。`);
    lines.push("");
  }

  lines.push("## Portfolio Health");
  for (const s of report.portfolioHealth.sectorBreakdown.slice(0, 5)) {
    lines.push(`- セクター: ${s.sector} ${s.pct.toFixed(1)}%`);
  }
  lines.push(`- Currency: ${report.portfolioHealth.currencyBreakdown.map((c) => `${c.currency} ${c.pct.toFixed(1)}%`).join(" / ")}`);
  lines.push(`- 口座分散: ${report.portfolioHealth.accountBreakdown.map((a) => `${a.account} ${a.pct.toFixed(1)}%`).join(" / ")}`);
  lines.push("");

  lines.push("## Holdings Review");
  lines.push("");
  for (const d of report.holdingDecisions) {
    lines.push(renderHoldingBlock(d));
    lines.push("");
  }

  if (report.buyDecisions.length > 0) {
    lines.push("## New Buy / Add");
    lines.push("");
    for (const b of report.buyDecisions) {
      lines.push(renderBuyBlock(b));
      lines.push("");
    }
  }

  lines.push("## Cash Allocation");
  const allocsByCcy = new Map<string, BuyDecision[]>();
  for (const b of report.buyDecisions) {
    if (!allocsByCcy.has(b.currency)) allocsByCcy.set(b.currency, []);
    allocsByCcy.get(b.currency)!.push(b);
  }
  for (const c of report.cash) {
    const allocs = allocsByCcy.get(c.currency) ?? [];
    const allocStr = allocs.length === 0
      ? "配分なし"
      : allocs.map((b) => `${b.action} ${b.ticker} ${fmtMoney(b.amount)}`).join(" / ");
    const remainder = report.cashRemainder.find((r) => r.currency === c.currency)?.amount ?? 0;
    lines.push(`- ${c.currency} ${fmtMoney(c.amount)} → ${allocStr}${remainder > 0 ? ` / 残 ${fmtMoney(remainder)}（次回機会用）` : ""}`);
  }
  lines.push("");

  return lines.join("\n");
}

export function writeRebalanceReport(report: RebalanceReport): string {
  if (!existsSync(REPORTS_DIR)) {
    mkdirSync(REPORTS_DIR, { recursive: true });
  }
  const filename = `${report.date}-rebalance.md`;
  const fullPath = join(REPORTS_DIR, filename);
  const md = renderRebalanceMarkdown(report);
  writeFileSync(fullPath, md, "utf-8");
  return fullPath;
}
