/**
 * yahoo-finance2 で各候補ティッカーの財務指標を並列取得する。
 */

import YahooFinance from "yahoo-finance2";
import type { Candidate, Fundamentals } from "./types";

const yahooFinance = new YahooFinance({ suppressNotices: ["yahooSurvey"] });

function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (v && typeof v === "object" && "raw" in (v as Record<string, unknown>)) {
    const raw = (v as { raw: unknown }).raw;
    if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  }
  return null;
}

function str(v: unknown): string | null {
  if (typeof v === "string" && v.length > 0) return v;
  return null;
}

export async function fetchFundamentals(candidates: Candidate[]): Promise<Fundamentals[]> {
  const results = await Promise.all(
    candidates.map(async (c): Promise<Fundamentals> => {
      try {
        const data = await yahooFinance.quoteSummary(c.ticker, {
          modules: ["price", "summaryDetail", "financialData", "defaultKeyStatistics", "assetProfile"],
        });

        const price = data.price ?? {};
        const summary = data.summaryDetail ?? {};
        const financial = data.financialData ?? {};
        const stats = data.defaultKeyStatistics ?? {};
        const profile = data.assetProfile ?? {};

        return {
          ticker: c.ticker,
          name: str((price as any).longName) ?? str((price as any).shortName) ?? c.name,
          currency: str((price as any).currency) ?? "USD",
          price: num((price as any).regularMarketPrice),
          marketCap: num((price as any).marketCap) ?? num((summary as any).marketCap),
          trailingPE: num((summary as any).trailingPE),
          forwardPE: num((summary as any).forwardPE) ?? num((stats as any).forwardPE),
          priceToBook: num((stats as any).priceToBook) ?? num((financial as any).priceToBook),
          returnOnEquity: num((financial as any).returnOnEquity),
          dividendYield: num((summary as any).dividendYield),
          debtToEquity: num((financial as any).debtToEquity),
          freeCashFlow: num((financial as any).freeCashflow),
          fiftyTwoWeekLow: num((summary as any).fiftyTwoWeekLow),
          fiftyTwoWeekHigh: num((summary as any).fiftyTwoWeekHigh),
          sector: str((profile as any).sector),
          industry: str((profile as any).industry),
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[fundamentals] ${c.ticker} failed: ${msg}`);
        return {
          ticker: c.ticker,
          name: c.name,
          currency: "USD",
          price: null,
          marketCap: null,
          trailingPE: null,
          forwardPE: null,
          priceToBook: null,
          returnOnEquity: null,
          dividendYield: null,
          debtToEquity: null,
          freeCashFlow: null,
          fiftyTwoWeekLow: null,
          fiftyTwoWeekHigh: null,
          sector: null,
          industry: null,
          fetchError: msg,
        };
      }
    }),
  );

  return results;
}

if (import.meta.main) {
  const sample: Candidate[] = [
    { ticker: "AAPL", name: "Apple", rationale: "" },
    { ticker: "7203.T", name: "Toyota", rationale: "" },
    { ticker: "COIN", name: "Coinbase", rationale: "" },
  ];
  const data = await fetchFundamentals(sample);
  console.log(JSON.stringify(data, null, 2));
}
