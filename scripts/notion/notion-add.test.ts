import { describe, test, expect } from "bun:test";
import { normalizeByKeywordList } from "./notion-add";

describe("normalizeByKeywordList", () => {
  test("「コーディング」「実装」「life-os」 → 開発", () => {
    expect(normalizeByKeywordList("コーディング")).toBe("開発");
    expect(normalizeByKeywordList("実装の続き")).toBe("開発");
    expect(normalizeByKeywordList("life-os の改修")).toBe("開発");
    expect(normalizeByKeywordList("プログラミング")).toBe("開発");
  });

  test("「筋トレ」「トレーニング」「ワークアウト」 → ジム", () => {
    expect(normalizeByKeywordList("ジム")).toBe("ジム");
    expect(normalizeByKeywordList("筋トレ")).toBe("ジム");
    expect(normalizeByKeywordList("朝のトレーニング")).toBe("ジム");
    expect(normalizeByKeywordList("ワークアウト")).toBe("ジム");
  });

  test("「ジョギング」「走る」 → ランニング", () => {
    expect(normalizeByKeywordList("ジョギング")).toBe("ランニング");
    expect(normalizeByKeywordList("夕方走る")).toBe("ランニング");
  });

  test("「礼拝」「QT」「祈り」 → デボーション", () => {
    expect(normalizeByKeywordList("デボーション")).toBe("デボーション");
    expect(normalizeByKeywordList("朝の礼拝")).toBe("デボーション");
    expect(normalizeByKeywordList("QT")).toBe("デボーション");
    expect(normalizeByKeywordList("祈りの時間")).toBe("デボーション");
  });

  test("「勉強」「学習」「study」 → 勉強（読書）", () => {
    expect(normalizeByKeywordList("勉強")).toBe("勉強（読書）");
    expect(normalizeByKeywordList("学習")).toBe("勉強（読書）");
    expect(normalizeByKeywordList("study session")).toBe("勉強（読書）");
  });

  test("「練習」 → ギター練習", () => {
    expect(normalizeByKeywordList("ギター")).toBe("ギター練習");
    expect(normalizeByKeywordList("朝の練習")).toBe("ギター練習");
  });

  test("「買い物」「スーパー」 → 買い出し", () => {
    expect(normalizeByKeywordList("買い物")).toBe("買い出し");
    expect(normalizeByKeywordList("スーパーへ")).toBe("買い出し");
    expect(normalizeByKeywordList("買い出し")).toBe("買い出し");
  });

  test("「ウォーキング」 → 散歩", () => {
    expect(normalizeByKeywordList("ウォーキング")).toBe("散歩");
    expect(normalizeByKeywordList("散歩")).toBe("散歩");
  });

  test("マッチしないタイトルはそのまま返す", () => {
    expect(normalizeByKeywordList("面接")).toBe("面接");
    expect(normalizeByKeywordList("ミーティング")).toBe("ミーティング");
  });

  test("リスト先頭のエントリが優先される（順番依存）", () => {
    // 「開発」と「練習」両方含む → 開発（リスト先頭）が優先
    expect(normalizeByKeywordList("ギターアプリの開発")).toBe("開発");
  });
});
