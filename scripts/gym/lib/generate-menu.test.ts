import { describe, test, expect } from "bun:test";
import { buildPrompt, parseMenuResponse, type MenuContext } from "./generate-menu";

const baseCtx: MenuContext = {
  date: "2026-04-29",
  startTime: "07:00",
  endTime: "08:30",
  prevSession: { date: "2026-04-28", bodyParts: ["push", "legs"] },
  lastThreeAux: ["Seated Leg Curl", "Lat Pull Down"],
  suggestedWeights: [
    { name: "ダンベルプレス", prevWeight: "20", suggestedWeight: "22.5", reps: 8, sets: 3, fb: "余裕" },
  ],
  condition: "normal",
  machines: "ダンベルプレス / フィックスドプルダウン / スクワットマシン / ウォーキング",
};

describe("buildPrompt", () => {
  test("includes date, time, condition", () => {
    const p = buildPrompt(baseCtx);
    expect(p).toContain("2026-04-29");
    expect(p).toContain("07:00");
    expect(p).toContain("08:30");
    expect(p).toContain("normal");
  });

  test("includes consecutive-day rule when prevSession has push", () => {
    const p = buildPrompt(baseCtx);
    expect(p).toContain("押す系");
    expect(p).toContain("引く系");
  });

  test("includes aux exclusion list", () => {
    const p = buildPrompt(baseCtx);
    expect(p).toContain("Seated Leg Curl");
    expect(p).toContain("Lat Pull Down");
  });

  test("includes preferences (no bench, no deadlift, squat machine)", () => {
    const p = buildPrompt(baseCtx);
    expect(p).toContain("ダンベルプレス");
    expect(p).toContain("デッドリフト");
    expect(p).toContain("スクワットマシン");
  });

  test("handles null prevSession (no consecutive constraint)", () => {
    const p = buildPrompt({ ...baseCtx, prevSession: null });
    expect(p).toContain("前日のセッション: なし");
  });
});

describe("parseMenuResponse", () => {
  test("parses valid JSON response", () => {
    const raw = JSON.stringify({
      exercises: [
        { type: "strength", name: "フィックスドプルダウン", weight: "50", sets: 3, reps: 8 },
        { type: "cardio", name: "ウォーキング", duration: "15分" },
      ],
      rationale: "引く日。背中重視。",
    });
    const m = parseMenuResponse(raw);
    expect(m.exercises).toHaveLength(2);
    expect(m.exercises[0]).toMatchObject({ type: "strength", name: "フィックスドプルダウン" });
    expect(m.rationale).toBe("引く日。背中重視。");
  });

  test("strips ```json fence", () => {
    const raw = "```json\n" + JSON.stringify({ exercises: [], rationale: "" }) + "\n```";
    const m = parseMenuResponse(raw);
    expect(m.exercises).toHaveLength(0);
  });

  test("strips bare ``` fence", () => {
    const raw = "```\n" + JSON.stringify({ exercises: [], rationale: "" }) + "\n```";
    const m = parseMenuResponse(raw);
    expect(m.exercises).toHaveLength(0);
  });

  test("throws on invalid JSON", () => {
    expect(() => parseMenuResponse("not json")).toThrow();
  });

  test("throws when exercises is missing", () => {
    expect(() => parseMenuResponse(JSON.stringify({ rationale: "x" }))).toThrow(/exercises/);
  });

  test("throws when exercises is not an array", () => {
    expect(() =>
      parseMenuResponse(JSON.stringify({ exercises: "x", rationale: "" })),
    ).toThrow(/exercises/);
  });

  test("throws when an exercise has invalid type", () => {
    const raw = JSON.stringify({
      exercises: [{ type: "yoga", name: "x" }],
      rationale: "",
    });
    expect(() => parseMenuResponse(raw)).toThrow(/type/);
  });
});
