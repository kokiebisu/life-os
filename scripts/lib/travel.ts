/**
 * 移動時間見積もりライブラリ
 *
 * Google Maps Routes API（transit モード）で電車+徒歩の所要時間を取得。
 * API キーがなければ claude -p にフォールバック。
 */

import { loadEnv } from "./notion";
import { callLLM } from "./llm";
import { join } from "path";
import { createCache, cacheKey } from "./cache";

const travelCache = createCache("routes", {
  baseDir: join(import.meta.dir, "travel-cache"),
  defaultTtlMs: 0, // no expiry
});

interface TravelEstimate {
  minutes: number;
  summary: string;
}

/**
 * Google Maps Routes API で移動時間を見積もる
 */
async function estimateViaGoogleMaps(
  apiKey: string,
  origin: string,
  destination: string,
  departureTime?: string,
): Promise<TravelEstimate> {
  const body: Record<string, unknown> = {
    origin: { address: origin },
    destination: { address: destination },
    travelMode: "TRANSIT",
    computeAlternativeRoutes: false,
    languageCode: "ja",
  };

  if (departureTime) {
    body.departureTime = departureTime;
  }

  const res = await fetch(
    "https://routes.googleapis.com/directions/v2:computeRoutes",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": "routes.duration,routes.legs.steps.transitDetails",
      },
      body: JSON.stringify(body),
    },
  );

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Google Maps Routes API error: ${res.status} ${errText}`);
  }

  const data = (await res.json()) as {
    routes?: Array<{
      duration?: string;
      legs?: Array<{
        steps?: Array<{
          transitDetails?: {
            transitLine?: { name?: string; vehicle?: { type?: string } };
          };
        }>;
      }>;
    }>;
  };

  const route = data.routes?.[0];
  if (!route?.duration) {
    throw new Error("No route found");
  }

  // duration is like "1800s"
  const durationSec = parseInt(route.duration.replace("s", ""), 10);
  const minutes = Math.ceil(durationSec / 60);

  // Extract transit line names for summary
  const lines: string[] = [];
  for (const leg of route.legs || []) {
    for (const step of leg.steps || []) {
      const name = step.transitDetails?.transitLine?.name;
      if (name && !lines.includes(name)) {
        lines.push(name);
      }
    }
  }

  const summary =
    lines.length > 0
      ? `電車（${lines.join("→")}）+徒歩`
      : "電車+徒歩";

  return { minutes, summary };
}

/**
 * claude -p にフォールバックして移動時間を見積もる
 */
async function estimateViaClaude(
  origin: string,
  destination: string,
): Promise<TravelEstimate> {
  const prompt = `${origin}から${destination}まで電車と徒歩で何分かかりますか？数字だけ答えてください。例: 35`;

  const stdout = await callLLM(
    [{ role: "user", content: prompt }],
    { model: "claude-haiku-4-5-20251001" },
  );

  const match = stdout.trim().match(/(\d+)/);
  if (!match) {
    throw new Error(`Could not parse travel time from: ${stdout.trim()}`);
  }

  const minutes = parseInt(match[1], 10);
  return { minutes, summary: "電車+徒歩" };
}

/**
 * 移動時間を見積もる。
 *
 * GOOGLE_MAPS_API_KEY が .env.local にあれば Routes API を使用。
 * なければ claude -p にフォールバック。
 *
 * @param origin 出発地（例: "桜木町"）— デフォルトなし、呼び出し側が指定
 * @param destination 目的地（例: "藤沢善行"）
 * @param departureTime 出発時刻 ISO8601（例: "2026-02-17T17:30:00+09:00"）
 */
export async function estimateTravelTime(
  origin: string,
  destination: string,
  departureTime?: string,
): Promise<TravelEstimate> {
  const key = cacheKey(origin, destination);
  const cached = travelCache.get<TravelEstimate>(key);
  if (cached !== undefined) return cached;

  const env = loadEnv();
  const apiKey = env["GOOGLE_MAPS_API_KEY"] || process.env.GOOGLE_MAPS_API_KEY;

  let result: TravelEstimate;
  if (apiKey) {
    try {
      result = await estimateViaGoogleMaps(apiKey, origin, destination, departureTime);
      travelCache.set(key, result);
      return result;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`Google Maps API failed, falling back to claude -p: ${msg}`);
    }
  }

  result = await estimateViaClaude(origin, destination);
  travelCache.set(key, result);
  return result;
}
