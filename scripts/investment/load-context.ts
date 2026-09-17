#!/usr/bin/env bun
/**
 * Load rebalance context — portfolio.csv + cash.csv + candidates/*.json を読む。
 *
 * すべて gitignored の個人ファイル。存在しなければエラー。
 */

import { readFileSync, existsSync, readdirSync } from "fs";
import { join } from "path";
import type { PortfolioRow, CashRow, DiscoveryCandidate } from "./types";

const PORTFOLIO_PATH = "aspects/investment/portfolio.csv";
const CASH_PATH = "aspects/investment/cash.csv";
const CANDIDATES_DIR = "aspects/investment/candidates";
const CANDIDATES_TTL_DAYS = 14;
const CASH_STALE_DAYS = 30;

export interface LoadedContext {
  portfolio: PortfolioRow[];
  cash: CashRow[];
  cashStale: boolean;
  candidates: DiscoveryCandidate[];
}

function parseCsv(text: string): string[][] {
  const lines = text.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);
  return lines.map((line) => {
    return line.split(",").map((c) => c.trim());
  });
}

export function loadPortfolio(path = PORTFOLIO_PATH): PortfolioRow[] {
  if (!existsSync(path)) {
    throw new Error(
      `portfolio.csv not found at ${path}. See spec: docs/superpowers/specs/2026-05-21-investment-portfolio-csv-design.md`,
    );
  }
  const rows = parseCsv(readFileSync(path, "utf-8"));
  if (rows.length < 2) return [];
  const header = rows[0];
  const expected = ["ticker", "quantity", "avg_cost", "currency", "account", "acquired_on", "note"];
  for (const col of expected) {
    if (!header.includes(col)) {
      throw new Error(`portfolio.csv missing column "${col}". Got: ${header.join(",")}`);
    }
  }
  return rows.slice(1).map((r) => {
    const obj = Object.fromEntries(header.map((h, i) => [h, r[i] ?? ""]));
    return {
      ticker: obj.ticker,
      quantity: parseFloat(obj.quantity),
      avgCost: parseFloat(obj.avg_cost),
      currency: obj.currency as PortfolioRow["currency"],
      account: obj.account as PortfolioRow["account"],
      acquiredOn: obj.acquired_on,
      note: obj.note ?? "",
    };
  });
}

export function loadCash(path = CASH_PATH): { cash: CashRow[]; stale: boolean } {
  if (!existsSync(path)) {
    const sample = `currency,amount,updated_on\nUSD,5000,${new Date().toISOString().slice(0, 10)}\nCAD,2000,${new Date().toISOString().slice(0, 10)}`;
    throw new Error(
      `cash.csv not found at ${path}.\n\nSample format:\n${sample}\n\nCreate this file with your current Wealthsimple Cash balances.`,
    );
  }
  const rows = parseCsv(readFileSync(path, "utf-8"));
  if (rows.length < 2) return { cash: [], stale: false };
  const header = rows[0];
  for (const col of ["currency", "amount", "updated_on"]) {
    if (!header.includes(col)) {
      throw new Error(`cash.csv missing column "${col}". Got: ${header.join(",")}`);
    }
  }
  const cash: CashRow[] = rows.slice(1).map((r) => {
    const obj = Object.fromEntries(header.map((h, i) => [h, r[i] ?? ""]));
    return {
      currency: obj.currency as CashRow["currency"],
      amount: parseFloat(obj.amount),
      updatedOn: obj.updated_on,
    };
  });
  const now = Date.now();
  const stale = cash.some((c) => {
    const d = Date.parse(c.updatedOn);
    if (Number.isNaN(d)) return true;
    return (now - d) / (24 * 3600 * 1000) > CASH_STALE_DAYS;
  });
  return { cash, stale };
}

export function loadCandidates(dir = CANDIDATES_DIR): DiscoveryCandidate[] {
  if (!existsSync(dir)) return [];
  const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
  const now = Date.now();
  const out: DiscoveryCandidate[] = [];
  for (const file of files) {
    const fullPath = join(dir, file);
    try {
      const data = JSON.parse(readFileSync(fullPath, "utf-8")) as {
        generated_at: string;
        strategy: string;
        candidates: Array<{
          ticker: string;
          thesis: string;
          confidence: "High" | "Med" | "Low";
          recent_news?: { date: string; headline: string; url: string }[];
          sources: string[];
        }>;
      };
      const generated = Date.parse(data.generated_at);
      if (Number.isNaN(generated)) {
        console.warn(`[load-candidates] ${file}: invalid generated_at, skipping`);
        continue;
      }
      const ageDays = (now - generated) / (24 * 3600 * 1000);
      if (ageDays > CANDIDATES_TTL_DAYS) {
        console.warn(`[load-candidates] ${file}: too old (${ageDays.toFixed(0)}d > ${CANDIDATES_TTL_DAYS}d), skipping`);
        continue;
      }
      for (const c of data.candidates) {
        out.push({
          ticker: c.ticker,
          thesis: c.thesis,
          confidence: c.confidence,
          recentNews: c.recent_news ?? [],
          sources: c.sources ?? [],
          strategy: data.strategy,
          generatedAt: data.generated_at,
          bucket: (c as any).bucket ?? undefined,
          entryNote: (c as any).entry_note ?? undefined,
        });
      }
    } catch (err) {
      console.warn(`[load-candidates] ${file}: parse failed: ${err instanceof Error ? err.message : err}`);
    }
  }
  return out;
}

export function loadContext(opts: { portfolioPath?: string; cashPath?: string; candidatesPath?: string } = {}): LoadedContext {
  const portfolio = loadPortfolio(opts.portfolioPath);
  const { cash, stale } = loadCash(opts.cashPath);
  let candidates: DiscoveryCandidate[];
  if (opts.candidatesPath) {
    candidates = opts.candidatesPath.endsWith(".json")
      ? loadSingleCandidateFile(opts.candidatesPath)
      : loadCandidates(opts.candidatesPath);
  } else {
    candidates = loadCandidates();
  }
  return { portfolio, cash, cashStale: stale, candidates };
}

function loadSingleCandidateFile(path: string): DiscoveryCandidate[] {
  if (!existsSync(path)) {
    console.warn(`[load-candidates] explicit file not found: ${path}`);
    return [];
  }
  try {
    const data = JSON.parse(readFileSync(path, "utf-8")) as {
      generated_at: string;
      strategy: string;
      candidates: Array<{
        ticker: string;
        thesis: string;
        confidence: "High" | "Med" | "Low";
        recent_news?: { date: string; headline: string; url: string }[];
        sources: string[];
      }>;
    };
    return data.candidates.map((c) => ({
      ticker: c.ticker,
      thesis: c.thesis,
      confidence: c.confidence,
      recentNews: c.recent_news ?? [],
      sources: c.sources ?? [],
      strategy: data.strategy,
      generatedAt: data.generated_at,
    }));
  } catch (err) {
    console.warn(`[load-candidates] ${path}: parse failed: ${err instanceof Error ? err.message : err}`);
    return [];
  }
}

if (import.meta.main) {
  try {
    const ctx = loadContext();
    console.log(JSON.stringify(ctx, null, 2));
    if (ctx.cashStale) {
      console.error(`⚠️  cash.csv は ${CASH_STALE_DAYS} 日以上更新されていません`);
    }
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }
}
