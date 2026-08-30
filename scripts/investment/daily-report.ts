#!/usr/bin/env bun
/**
 * Investment daily report — オーケストレーター
 *
 * 使い方:
 *   bun run scripts/investment/daily-report.ts            # 本番（Notion 登録）
 *   bun run scripts/investment/daily-report.ts --dry-run  # Notion 登録せず stdout
 *   bun run scripts/investment/daily-report.ts --date 2026-05-12
 */

import { fetchNews } from "./fetch-news";
import { selectTheme } from "./select-theme";
import { pickCandidates } from "./pick-candidates";
import { fetchFundamentals } from "./fetch-fundamentals";
import { evaluateValue } from "./evaluate-value";
import { sanityCheck } from "./sanity-check";
import { registerNotion, todayJSTDate } from "./register-notion";
import type { Analysis, ValuePick } from "./types";

function parseArgs(): { dryRun: boolean; date: string } {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const dateIdx = args.indexOf("--date");
  const date = dateIdx >= 0 ? args[dateIdx + 1] : todayJSTDate();
  return { dryRun, date };
}

function renderMarkdown(analysis: Analysis): string {
  const lines: string[] = [];
  lines.push(`# 投資ヒント: ${analysis.theme.title}`);
  lines.push(`> ${analysis.date}  ·  カテゴリ: ${analysis.theme.category}`);
  lines.push("");
  lines.push("> ⚠️ 教育目的の連想練習。投資助言ではありません。");
  lines.push("");

  const flagged = analysis.picks.filter((p) => p.sanity && p.sanity.warnings.length > 0);
  if (flagged.length > 0) {
    lines.push(`> 🚨 **直近の値動きに異常がある銘柄が ${flagged.length} 件あります**: ${flagged.map((p) => p.ticker).join(", ")}。各銘柄の警告ブロックを必ず確認してください。`);
    lines.push("");
  }

  lines.push("## ニュース要約");
  lines.push(analysis.newsSummary);
  lines.push("");
  lines.push("## テーマ");
  lines.push(`**${analysis.theme.title}**`);
  lines.push("");
  lines.push(analysis.theme.reasoning);
  lines.push("");
  lines.push("## 注目銘柄");
  for (const pick of analysis.picks) {
    const flagged = pick.sanity && pick.sanity.warnings.length > 0;
    const titleSuffix = flagged ? " 🚨" : "";
    lines.push(`### ${pick.ticker} — ${pick.name}${titleSuffix}`);
    if (flagged && pick.sanity) {
      lines.push("");
      lines.push(`> 🚨 **直近の値動きに警告**`);
      lines.push(`> - 5日: ${pick.sanity.pct5d.toFixed(1)}%  ·  30日: ${pick.sanity.pct30d.toFixed(1)}%  ·  180日高値からの drawdown: ${pick.sanity.drawdownPct.toFixed(1)}%`);
      for (const w of pick.sanity.warnings) lines.push(`> - ${w}`);
      lines.push(`> Claude の thesis はこのドローダウン直前のスナップショットに基づくため、最新の earnings / ニュースで根拠が崩れている可能性があります。採用前に必ず原因を確認してください。`);
      lines.push("");
    }
    const f = pick.fundamentals;
    lines.push(`- セクター: ${f.sector ?? "—"} · 業種: ${f.industry ?? "—"}`);
    lines.push(`- PER(trail/fwd): ${fmt(f.trailingPE)} / ${fmt(f.forwardPE)}  ·  PBR: ${fmt(f.priceToBook)}  ·  ROE: ${pct(f.returnOnEquity)}`);
    lines.push(`- 配当利回り: ${pct(f.dividendYield)}  ·  D/E: ${fmt(f.debtToEquity)}  ·  FCF: ${money(f.freeCashFlow)}  ·  時価総額: ${money(f.marketCap)}`);
    lines.push("");
    lines.push(`**Thesis (1年):** ${pick.thesis}`);
    if (pick.catalysts.length > 0) {
      lines.push("**カタリスト:**");
      pick.catalysts.forEach((c) => lines.push(`- ${c}`));
    }
    if (pick.risks.length > 0) {
      lines.push("**リスク:**");
      pick.risks.forEach((r) => lines.push(`- ${r}`));
    }
    lines.push("");
  }
  if (analysis.overallRisks.length > 0) {
    lines.push("## テーマ全体のリスク");
    analysis.overallRisks.forEach((r) => lines.push(`- ${r}`));
    lines.push("");
  }
  if (analysis.theme.primarySourceLink) {
    lines.push("## ソース");
    lines.push(analysis.theme.primarySourceLink);
  }
  return lines.join("\n");
}

function fmt(v: number | null): string {
  if (v === null) return "—";
  return Number.isInteger(v) ? v.toString() : v.toFixed(2);
}
function pct(v: number | null): string {
  return v === null ? "—" : `${(v * 100).toFixed(1)}%`;
}
function money(v: number | null): string {
  if (v === null) return "—";
  if (Math.abs(v) >= 1e12) return `${(v / 1e12).toFixed(2)}T`;
  if (Math.abs(v) >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
  if (Math.abs(v) >= 1e6) return `${(v / 1e6).toFixed(2)}M`;
  return v.toFixed(0);
}

async function main() {
  const { dryRun, date } = parseArgs();

  console.error(`📰 ニュース取得中...`);
  const news = await fetchNews();
  console.error(`  → ${news.length} 件取得`);
  if (news.length === 0) {
    console.error("ニュースが 1 件も取れませんでした。RSS フィードを確認してください。");
    process.exit(1);
  }

  console.error(`🧠 テーマ選定中...`);
  const theme = await selectTheme(news);
  console.error(`  → ${theme.title}`);

  console.error(`🎯 候補銘柄ピックアップ中...`);
  const candidates = await pickCandidates(theme);
  console.error(`  → ${candidates.length} 銘柄`);

  console.error(`📊 yahoo-finance2 で財務指標取得中...`);
  const fundamentals = await fetchFundamentals(candidates);
  const okCount = fundamentals.filter((f) => !f.fetchError).length;
  console.error(`  → ${okCount}/${fundamentals.length} 成功`);

  console.error(`💎 バリュー評価中...`);
  const { picks, overallRisks } = await evaluateValue(theme, candidates, fundamentals);
  console.error(`  → ${picks.length} 銘柄に絞り込み: ${picks.map((p: ValuePick) => p.ticker).join(", ")}`);

  console.error(`🚨 サニティチェック中（直近の値動き異常を検出）...`);
  const sanityFlags = await sanityCheck(picks.map((p) => p.ticker));
  let warningCount = 0;
  for (const p of picks) {
    const flag = sanityFlags.get(p.ticker.toUpperCase());
    if (flag) {
      p.sanity = flag;
      if (flag.warnings.length > 0) {
        warningCount++;
        console.error(`  🚨 ${p.ticker}: ${flag.warnings.length} 件の警告`);
      }
    }
  }
  console.error(`  → ${warningCount}/${picks.length} 銘柄に警告あり`);

  const newsSummary = topNewsSummary(news);
  const analysis: Analysis = { date, theme, newsSummary, picks, overallRisks };

  if (dryRun) {
    console.log(renderMarkdown(analysis));
    console.error(`\n✓ dry-run 完了`);
    return;
  }

  console.error(`📝 Notion に登録中...`);
  const pageId = await registerNotion(analysis);
  console.error(`✓ 完了: ${pageId}`);
}

function topNewsSummary(news: { title: string; source: string }[]): string {
  const top = news.slice(0, 5);
  return [`本日取得した RSS ${news.length} 件のうち、直近の主要見出し（参考、必ずしも本テーマ関連とは限らない）:`]
    .concat(top.map((n) => `- [${n.source}] ${n.title}`))
    .join("\n");
}

main().catch((err) => {
  console.error("daily-report failed:", err);
  process.exit(1);
});
