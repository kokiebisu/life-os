#!/usr/bin/env bun
/**
 * 前回のジムログから次回メニューの推奨重量を計算する
 *
 * 入力: ローカル最新ログ（または指定日）
 * 出力: 種目ごとの「前回重量 / FB / 推奨次回重量 / 根拠」テーブル
 *
 * ルール:
 *   - 余裕系 → +5kg（または +1セット）
 *   - まあまあ系 → 維持
 *   - きつい系 → -5kg
 *   - 空 → 余裕扱い → +5kg
 *   - FB に重量が含まれる場合（"20kgでギリギリ"・"12.5kgに下げた"）→ 実際の重量を抽出して基準にする
 *
 * 使い方:
 *   bun run scripts/gym/suggest-next-menu.ts                 # 最新ログ
 *   bun run scripts/gym/suggest-next-menu.ts --date 2026-04-24
 *   bun run scripts/gym/suggest-next-menu.ts --json          # JSON 出力
 */

import { readdirSync, existsSync, readFileSync } from "fs";
import { join } from "path";
import { parseArgs } from "../lib/notion";

const ROOT = join(import.meta.dir, "../..");
const LOGS_DIR = join(ROOT, "aspects/gym/logs");

type FbCategory = "余裕" | "まあまあ" | "きつい" | "";

interface ParsedExercise {
  name: string;
  weight: string | null; // 数値文字列 (e.g. "20") or null (有酸素)
  unit: "kg" | "min" | null;
  reps: string | null;
  sets: string | null;
  duration: string | null; // 有酸素用
  fb: string;
}

interface Suggestion {
  name: string;
  type: "strength" | "cardio";
  prevWeight: string | null;
  prevReps: string | null;
  prevSets: string | null;
  prevDuration: string | null;
  fbRaw: string;
  fbCategory: FbCategory;
  baselineWeight: string | null; // FB から抽出した実際の重量（あれば）
  suggestedWeight: string | null;
  suggestedReps: string | null;
  suggestedSets: string | null;
  suggestedDuration: string | null;
  reason: string;
}

function getLatestLogPath(): string | null {
  if (!existsSync(LOGS_DIR)) return null;
  const files = readdirSync(LOGS_DIR)
    .filter((f) => /^\d{4}-\d{2}-\d{2}\.md$/.test(f))
    .sort();
  if (files.length === 0) return null;
  return join(LOGS_DIR, files[files.length - 1]);
}

/**
 * ローカル md ログをパースする
 * 期待フォーマット:
 *   ## 種目名
 *   - 重量: 20kg × 10回 × 3セット
 *   - FB: ギリギリ
 *
 *   ## ウォーキング
 *   - 内容: 15分
 *   - FB: 余裕
 */
function parseLogMd(content: string): ParsedExercise[] {
  const lines = content.split("\n");
  const exercises: ParsedExercise[] = [];
  let current: ParsedExercise | null = null;
  let inFbBlock = false;
  let fbBuffer: string[] = [];

  const flushFb = () => {
    if (current && fbBuffer.length > 0) {
      current.fb = fbBuffer.join("\n").trim();
    }
    fbBuffer = [];
    inFbBlock = false;
  };

  const flushExercise = () => {
    flushFb();
    if (current) exercises.push(current);
    current = null;
  };

  for (const line of lines) {
    if (line.startsWith("## ")) {
      flushExercise();
      current = {
        name: line.slice(3).trim(),
        weight: null,
        unit: null,
        reps: null,
        sets: null,
        duration: null,
        fb: "",
      };
      continue;
    }
    if (!current) continue;

    // 筋トレ: "- 重量: 20kg × 10回 × 3セット"
    const weightMatch = line.match(/^-\s*重量:\s*(.+)$/);
    if (weightMatch) {
      flushFb();
      const detail = weightMatch[1].trim();
      const w = detail.match(/(\d+\.?\d*)\s*kg/);
      const r = detail.match(/(\d+)\s*回/);
      const s = detail.match(/(\d+)\s*セット/);
      if (w) { current.weight = w[1]; current.unit = "kg"; }
      if (r) current.reps = r[1];
      if (s) current.sets = s[1];
      continue;
    }

    // 有酸素: "- 内容: 15分"
    const cardioMatch = line.match(/^-\s*内容:\s*(.+)$/);
    if (cardioMatch) {
      flushFb();
      const detail = cardioMatch[1].trim();
      const d = detail.match(/(\d+\s*分|\d+\s*min)/);
      if (d) { current.duration = d[1]; current.unit = "min"; }
      continue;
    }

    // FB ブロック開始
    const fbInline = line.match(/^-\s*FB:\s*(.*)$/);
    if (fbInline) {
      flushFb();
      const inline = fbInline[1].trim();
      if (inline) {
        current.fb = inline;
        inFbBlock = false;
      } else {
        // 次の行から複数行 FB
        inFbBlock = true;
        fbBuffer = [];
      }
      continue;
    }

    // 複数行 FB の継続行 (インデント付き)
    if (inFbBlock) {
      const indented = line.match(/^\s+(.+)$/);
      if (indented) {
        fbBuffer.push(indented[1].trim());
        continue;
      }
      if (line.trim() === "") continue; // 空行は許容
      // インデントなし = ブロック終了
      flushFb();
    }
  }
  flushExercise();
  return exercises;
}

/**
 * 重量変更があった場合、最後の「Xkg」言及以降の文だけで FB を判定する。
 * 例: "無理だった。20kgでギリギリ" → "20kgでギリギリ" に注目 → まあまあ
 *     "12.5kgに下げた。1セット目は8回..." → "12.5kgに下げた..." に注目 → きつい
 */
function effectiveFbText(raw: string): string {
  const matches = [...raw.matchAll(/(\d+\.?\d*)\s*kg/g)];
  if (matches.length === 0) return raw;
  const lastIdx = matches[matches.length - 1].index ?? 0;
  return raw.slice(lastIdx);
}

function normalizeFb(raw: string): FbCategory {
  const s = effectiveFbText(raw).trim();
  if (!s) return "";
  // 順序重要: 「ギリ一回できず」「ギリギリ」を「きつい」「まあまあ」より先に判定
  if (/ギリ一回|ギリ\s*1\s*回|無理だった|無理。|無理$|限界|もうダメ|つぶれ|潰れ|レップ未達/i.test(s)) return "きつい";
  if (/ギリギリ|ぎりぎり|ぎり|ちょうど|ちょうどよ/i.test(s)) return "まあまあ";
  if (/余裕|楽|軽い|軽かった|簡単|イージー|easy/i.test(s)) return "余裕";
  if (/きつ|辛|つら|無理|ムリ|hard|heavy|重い|重かった/i.test(s)) return "きつい";
  if (/まあまあ|普通|ふつう|そこそこ|ok|medium/i.test(s)) return "まあまあ";
  // 重量変更の言及があるが他のキーワードがない場合
  if (/下げた|落とした|減らした/i.test(s)) return "きつい";
  if (/上げた|増やした/i.test(s)) return "余裕";
  return ""; // 未判定 → 呼び出し側でデフォルト処理
}

/**
 * FB テキストから「実際にやった重量」を抽出する
 * 例:
 *   "20kgでギリギリ" → 20
 *   "12.5kgに下げた" → 12.5
 *   "今日は20kgやった" → 20
 *   "21.25って何だよ。2.5刻みだから...今日は20kgやった" → 20
 */
function extractActualWeight(fb: string): string | null {
  // 「やった」「下げた」「落とした」「減らした」「上げた」「増やした」付近の数値を優先
  const actionMatch = fb.match(/(\d+\.?\d*)\s*kg\s*(?:に|で|を|やった|やる|下げた|落とした|減らした|上げた|増やした)/);
  if (actionMatch) return actionMatch[1];
  // フォールバック: 最後に出てくる数値+kg
  const all = [...fb.matchAll(/(\d+\.?\d*)\s*kg/g)];
  if (all.length > 0) return all[all.length - 1][1];
  return null;
}

function adjustWeight(weight: string, deltaKg: number): string {
  const w = parseFloat(weight);
  if (isNaN(w)) return weight;
  const next = w + deltaKg;
  // 0以下にならないよう保護
  if (next <= 0) return weight;
  // 小数点以下を整理
  return next % 1 === 0 ? next.toString() : next.toFixed(2).replace(/\.?0+$/, "");
}

function buildSuggestion(ex: ParsedExercise): Suggestion {
  const isCardio = ex.unit === "min";
  const fbCategory = normalizeFb(ex.fb);
  const baseline = ex.fb ? extractActualWeight(ex.fb) : null;
  const baselineDiffersFromLogged = baseline && ex.weight && baseline !== ex.weight;

  let suggestedWeight: string | null = ex.weight;
  let suggestedReps = ex.reps;
  let suggestedSets = ex.sets;
  let suggestedDuration = ex.duration;
  let reason = "";

  // 起点重量の決定
  const baseWeight = baseline ?? ex.weight;

  if (isCardio) {
    // 有酸素は維持が基本（FB「余裕」でも時間を増やすかはコーチ判断）
    suggestedDuration = ex.duration;
    if (fbCategory === "余裕") reason = "余裕。次回 +5分検討（コーチ判断）";
    else if (fbCategory === "きつい") reason = "きつい。維持または -5分検討";
    else reason = "維持";
    return {
      name: ex.name,
      type: "cardio",
      prevWeight: null,
      prevReps: null,
      prevSets: null,
      prevDuration: ex.duration,
      fbRaw: ex.fb,
      fbCategory,
      baselineWeight: null,
      suggestedWeight: null,
      suggestedReps: null,
      suggestedSets: null,
      suggestedDuration,
      reason,
    };
  }

  // 筋トレ
  switch (fbCategory) {
    case "余裕":
      suggestedWeight = baseWeight ? adjustWeight(baseWeight, +5) : null;
      reason = baselineDiffersFromLogged
        ? `余裕。実重量 ${baseline}kg を基準に +5kg`
        : "余裕 → +5kg";
      break;
    case "まあまあ":
      suggestedWeight = baseWeight;
      reason = baselineDiffersFromLogged
        ? `まあまあ。実重量 ${baseline}kg を基準に維持`
        : "まあまあ → 維持";
      break;
    case "きつい":
      suggestedWeight = baseWeight ? adjustWeight(baseWeight, -5) : null;
      reason = baselineDiffersFromLogged
        ? `きつい。実重量 ${baseline}kg を基準に -5kg`
        : "きつい → -5kg";
      break;
    case "":
      // 空 = 余裕扱い（gym ルール）
      suggestedWeight = baseWeight ? adjustWeight(baseWeight, +5) : null;
      reason = baselineDiffersFromLogged
        ? `FB 空 = 余裕扱い。実重量 ${baseline}kg を基準に +5kg`
        : "FB 空 = 余裕扱い → +5kg";
      break;
  }

  return {
    name: ex.name,
    type: "strength",
    prevWeight: ex.weight,
    prevReps: ex.reps,
    prevSets: ex.sets,
    prevDuration: null,
    fbRaw: ex.fb,
    fbCategory,
    baselineWeight: baseline && baseline !== ex.weight ? baseline : null,
    suggestedWeight,
    suggestedReps,
    suggestedSets,
    suggestedDuration: null,
    reason,
  };
}

function renderTable(suggestions: Suggestion[], dateLabel: string): string {
  const strength = suggestions.filter((s) => s.type === "strength");
  const cardio = suggestions.filter((s) => s.type === "cardio");
  const out: string[] = [];

  out.push(`# 次回メニュー推奨（前回: ${dateLabel}）`);
  out.push("");

  if (strength.length > 0) {
    out.push("## 💪 筋トレ");
    out.push("");
    out.push("| 種目 | 前回 | FB | 判定 | 推奨次回 | 根拠 |");
    out.push("|------|------|-----|------|---------|------|");
    for (const s of strength) {
      const prev = `${s.prevWeight ?? "-"}kg × ${s.prevReps ?? "?"}回 × ${s.prevSets ?? "?"}セット`;
      const fb = s.fbRaw ? s.fbRaw.replace(/\|/g, "\\|").replace(/\n/g, " / ") : "(空)";
      const cat = s.fbCategory || "(空→余裕扱い)";
      const next = `${s.suggestedWeight ?? "-"}kg × ${s.suggestedReps ?? "?"}回 × ${s.suggestedSets ?? "?"}セット`;
      out.push(`| ${s.name} | ${prev} | ${fb} | ${cat} | ${next} | ${s.reason} |`);
    }
    out.push("");
  }

  if (cardio.length > 0) {
    out.push("## 🏃 有酸素");
    out.push("");
    out.push("| 種目 | 前回 | FB | 判定 | 推奨次回 | 根拠 |");
    out.push("|------|------|-----|------|---------|------|");
    for (const s of cardio) {
      const fb = s.fbRaw ? s.fbRaw.replace(/\|/g, "\\|").replace(/\n/g, " / ") : "(空)";
      const cat = s.fbCategory || "(空)";
      out.push(`| ${s.name} | ${s.prevDuration ?? "-"} | ${fb} | ${cat} | ${s.suggestedDuration ?? "-"} | ${s.reason} |`);
    }
    out.push("");
  }

  return out.join("\n");
}

async function main() {
  const { flags, opts } = parseArgs();
  const dateArg = opts["date"];
  const jsonOut = flags.has("json");

  let logPath: string;
  if (dateArg) {
    logPath = join(LOGS_DIR, `${dateArg}.md`);
    if (!existsSync(logPath)) {
      console.error(`Error: ログファイルが見つかりません: ${logPath}`);
      process.exit(1);
    }
  } else {
    const latest = getLatestLogPath();
    if (!latest) {
      console.error("Error: ローカルログが1件もありません。先に sync-notion-to-md.ts を実行してください。");
      process.exit(1);
    }
    logPath = latest;
  }

  const dateLabel = logPath.match(/(\d{4}-\d{2}-\d{2})\.md$/)?.[1] ?? "(unknown)";
  const content = readFileSync(logPath, "utf-8");
  const exercises = parseLogMd(content);

  if (exercises.length === 0) {
    console.error(`Warning: ログに種目データがありません: ${logPath}`);
    process.exit(1);
  }

  const suggestions = exercises.map(buildSuggestion);

  if (jsonOut) {
    console.log(JSON.stringify({ date: dateLabel, suggestions }, null, 2));
  } else {
    console.log(renderTable(suggestions, dateLabel));
  }
}

main().catch((err) => {
  console.error("Error:", err.message ?? err);
  process.exit(1);
});
