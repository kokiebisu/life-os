import { callLLM } from "../../lib/llm";

export interface PrevSession {
  date: string;
  bodyParts: ("push" | "pull" | "legs" | "cardio")[];
}

export interface SuggestedExercise {
  name: string;
  prevWeight: string | null;
  suggestedWeight: string | null;
  reps: number | null;
  sets: number | null;
  fb: string;
}

export interface MenuContext {
  date: string;       // YYYY-MM-DD
  startTime: string;  // HH:MM
  endTime: string;    // HH:MM
  prevSession: PrevSession | null;
  lastThreeAux: string[];
  suggestedWeights: SuggestedExercise[];
  condition: "low" | "normal" | "high";
  machines: string;
}

export interface MenuExercise {
  type: "strength" | "cardio";
  name: string;
  weight?: string;
  sets?: number;
  reps?: number;
  duration?: string;
}

export interface MenuResult {
  exercises: MenuExercise[];
  rationale: string;
}

function consecutiveRule(prev: PrevSession | null): string {
  if (!prev) return "前日のセッション: なし（制約なし）";
  const parts = prev.bodyParts.join(", ");
  const lines = [`前日のセッション: ${prev.date}（${parts}）`];
  if (prev.bodyParts.includes("push")) {
    lines.push("→ 連日ルール: 押す系（ダンベルプレス等）禁止。引く系 or cardio only。");
  }
  if (prev.bodyParts.includes("pull")) {
    lines.push("→ 連日ルール: 引く系（フィックスドプルダウン等）禁止。押す系 or cardio only。");
  }
  if (prev.bodyParts.includes("legs")) {
    lines.push("→ 連日ルール: 脚（スクワットマシン等）連日避ける。");
  }
  return lines.join("\n");
}

export function buildPrompt(ctx: MenuContext): string {
  const suggestedTable = ctx.suggestedWeights.length
    ? ctx.suggestedWeights
        .map(
          (s) =>
            `  - ${s.name}: 前回 ${s.prevWeight ?? "?"}kg × ${s.reps ?? "?"}回 × ${s.sets ?? "?"}セット, FB=${s.fb || "(空)"}, 推奨次回 ${s.suggestedWeight ?? "?"}kg`,
        )
        .join("\n")
    : "  (前回ログなし)";

  const auxList = ctx.lastThreeAux.length
    ? ctx.lastThreeAux.map((a) => `  - ${a}`).join("\n")
    : "  (なし)";

  return `あなたはストレングスコーチ「鈴木拓哉」です。以下の条件に従って、今日のジムメニューを 3〜5 種目で組んでください。

## セッション情報
- 日付: ${ctx.date}
- 時間: ${ctx.startTime}〜${ctx.endTime}
- コンディション: ${ctx.condition}（low → 軽め / normal → 通常 / high → 攻める）

## ${consecutiveRule(ctx.prevSession)}

## 直近 3 セッションで使った補助種目（除外する）
${auxList}

## 推奨重量（前回 FB に基づく）
${suggestedTable}

## 利用可能マシン
${ctx.machines}

## 種目プリファレンス（厳守）
- 胸: ダンベルプレスを使う（ベンチプレス禁止）
- 脚: スクワットマシンを使う（フリーウェイトスクワット禁止）
- デッドリフト禁止
- BIG3 にこだわらない、マシン優先

## メニュー密度
連日制約があっても 3〜5 種目組む。「制約があるから少なめ」は禁止。

## 出力形式
以下の JSON のみ（他のテキスト不要）:
\`\`\`json
{
  "exercises": [
    { "type": "strength", "name": "種目名", "weight": "数値", "sets": 3, "reps": 8 },
    { "type": "cardio", "name": "種目名", "duration": "15分" }
  ],
  "rationale": "なぜこのメニューにしたか（1〜2文）"
}
\`\`\`
`;
}

export function parseMenuResponse(raw: string): MenuResult {
  let cleaned = raw.trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\n?/, "");
    cleaned = cleaned.replace(/\n?```\s*$/, "");
    cleaned = cleaned.trim();
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error(`Invalid JSON response: ${cleaned.slice(0, 100)}`);
  }

  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("Response is not a JSON object");
  }
  const obj = parsed as Record<string, unknown>;

  if (!Array.isArray(obj.exercises)) {
    throw new Error("Missing or invalid field: exercises (must be array)");
  }

  for (const ex of obj.exercises) {
    if (typeof ex !== "object" || ex === null) {
      throw new Error("Each exercise must be an object");
    }
    const e = ex as Record<string, unknown>;
    if (e.type !== "strength" && e.type !== "cardio") {
      throw new Error(`Invalid exercise type: ${String(e.type)}`);
    }
    if (typeof e.name !== "string" || !e.name) {
      throw new Error("Each exercise needs a non-empty name");
    }
  }

  return {
    exercises: obj.exercises as MenuExercise[],
    rationale: typeof obj.rationale === "string" ? obj.rationale : "",
  };
}

export async function generateMenu(ctx: MenuContext): Promise<MenuResult> {
  const prompt = buildPrompt(ctx);
  const raw = await callLLM(
    [{ role: "user", content: prompt }],
    { model: "claude-opus-4-7", maxTokens: 2048 },
  );
  return parseMenuResponse(raw);
}
