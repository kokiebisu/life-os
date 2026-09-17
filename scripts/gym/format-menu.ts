#!/usr/bin/env bun
/**
 * ジムメニュー Notion ページ本文生成
 *
 * 種目データからスタイリング済みの Notion-flavored Markdown を生成する。
 * callout + 色付きテーブルで見やすいレイアウトにする。
 *
 * 使い方（CLIモード）:
 *   echo '{"session":{"date":"4/18（金）","time":"12:30〜14:00"},"exercises":[...]}' | bun run scripts/gym/format-menu.ts
 *
 * 使い方（ライブラリモード）:
 *   import { formatMenu, formatNotionContent, type Exercise } from "./scripts/gym/format-menu";
 */

// --- FB 選択肢 ---

const VALID_FEEDBACK = ["余裕", "まあまあ", "きつい", ""] as const;
export type Feedback = (typeof VALID_FEEDBACK)[number];

/**
 * 自由入力テキストを正規化された FB 値に変換する
 */
export function normalizeFeedback(raw: string): Feedback {
  const s = raw.trim();
  if (!s) return "";

  if (VALID_FEEDBACK.includes(s as Feedback)) return s as Feedback;

  if (/余裕|楽|軽い|軽かった|簡単|イージー|easy/i.test(s)) return "余裕";
  if (/きつ|辛|つら|無理|ムリ|hard|heavy|重い|重かった|限界/i.test(s)) return "きつい";
  if (/まあまあ|普通|ふつう|そこそこ|ちょうど|ok|medium/i.test(s)) return "まあまあ";

  return "まあまあ";
}

// --- 種目データ型 ---

export interface StrengthExercise {
  type: "strength";
  name: string;
  weight: string;
  sets: number;
  reps: number;
  feedback?: string;
}

export interface CardioExercise {
  type: "cardio";
  name: string;
  duration: string;
  incline?: string;
  speed?: string;
  feedback?: string;
}

export type Exercise = StrengthExercise | CardioExercise;

export interface SessionInfo {
  date: string;   // e.g. "4/18（金）"
  time: string;   // e.g. "12:30〜14:00"
}

// --- Notion-flavored Markdown テーブル生成 ---

function strengthTableRows(exercises: StrengthExercise[]): string {
  return exercises.map((e) => {
    const fb = e.feedback ? normalizeFeedback(e.feedback) : "";
    return `\t<tr>\n\t\t<td>${fb}</td>\n\t\t<td>${e.name}</td>\n\t\t<td>${e.weight}</td>\n\t\t<td>${e.sets}</td>\n\t\t<td>${e.reps}</td>\n\t</tr>`;
  }).join("\n");
}

function cardioTableRows(exercises: CardioExercise[]): string {
  return exercises.map((e) => {
    const fb = e.feedback ? normalizeFeedback(e.feedback) : "";
    return `\t<tr>\n\t\t<td>${fb}</td>\n\t\t<td>${e.name}</td>\n\t\t<td>${e.duration}</td>\n\t\t<td>${e.incline ?? ""}</td>\n\t\t<td>${e.speed ?? ""}</td>\n\t</tr>`;
  }).join("\n");
}

/**
 * Notion ページ本文用のスタイリング済み Markdown を生成
 */
export function formatNotionContent(session: SessionInfo, exercises: Exercise[]): string {
  const strength = exercises.filter((e): e is StrengthExercise => e.type === "strength");
  const cardio = exercises.filter((e): e is CardioExercise => e.type === "cardio");

  const summaryParts: string[] = [];
  if (strength.length > 0) summaryParts.push(`筋トレ ${strength.length}種目`);
  if (cardio.length > 0) summaryParts.push(`有酸素 ${cardio.length}種目`);

  const parts: string[] = [];

  // Callout サマリー
  parts.push(`<callout icon="📊" color="blue_bg">\n\t**${session.date} ${session.time}** — ${summaryParts.join(" + ")}\n</callout>`);
  parts.push("---");

  // 筋トレテーブル
  if (strength.length > 0) {
    parts.push(`## 💪 筋トレ {color="blue"}`);
    parts.push(`<table fit-page-width="true" header-row="true">
\t<colgroup>
\t\t<col>
\t\t<col>
\t\t<col>
\t\t<col>
\t\t<col>
\t</colgroup>
\t<tr color="blue_bg">
\t\t<td>FB</td>
\t\t<td>種目</td>
\t\t<td>重量（kg）</td>
\t\t<td>セット</td>
\t\t<td>回数</td>
\t</tr>
${strengthTableRows(strength)}
</table>`);
  }

  // 有酸素テーブル
  if (cardio.length > 0) {
    parts.push(`## 🏃 有酸素 {color="green"}`);
    parts.push(`<table fit-page-width="true" header-row="true">
\t<colgroup>
\t\t<col>
\t\t<col>
\t\t<col>
\t\t<col>
\t\t<col>
\t</colgroup>
\t<tr color="green_bg">
\t\t<td>FB</td>
\t\t<td>種目</td>
\t\t<td>時間</td>
\t\t<td>傾斜</td>
\t\t<td>スピード</td>
\t</tr>
${cardioTableRows(cardio)}
</table>`);
  }

  return parts.join("\n\n");
}

/**
 * Notion REST API 用のブロック配列を生成（gym-auto から直接 PATCH /blocks/{id}/children する用途）
 *
 * `formatNotionContent` は Notion MCP の `replace_content` で解釈される独自 markdown を返すが、
 * REST API はこの形式を理解しないので、blockオブジェクトを直接構築する必要がある。
 * /gym plan が MCP 経由で生成する本文と同じ見た目になるよう揃える。
 */
export function buildNotionBlocks(session: SessionInfo, exercises: Exercise[]): any[] {
  const strength = exercises.filter((e): e is StrengthExercise => e.type === "strength");
  const cardio = exercises.filter((e): e is CardioExercise => e.type === "cardio");

  const summaryParts: string[] = [];
  if (strength.length > 0) summaryParts.push(`筋トレ ${strength.length}種目`);
  if (cardio.length > 0) summaryParts.push(`有酸素 ${cardio.length}種目`);

  const plain = (content: string) => [{ type: "text", text: { content } }];
  const bold = (content: string) => [
    {
      type: "text",
      text: { content },
      annotations: { bold: true },
    },
  ];

  const blocks: any[] = [];

  blocks.push({
    object: "block",
    type: "callout",
    callout: {
      rich_text: [
        ...bold(`${session.date} ${session.time}`),
        ...plain(` — ${summaryParts.join(" + ")}`),
      ],
      icon: { type: "emoji", emoji: "📊" },
      color: "blue_background",
    },
  });

  blocks.push({ object: "block", type: "divider", divider: {} });

  if (strength.length > 0) {
    blocks.push({
      object: "block",
      type: "heading_2",
      heading_2: { rich_text: plain("💪 筋トレ"), color: "blue" },
    });
    const headerCells = ["FB", "種目", "重量（kg）", "セット", "回数"];
    const dataRows = strength.map((e) => [
      e.feedback ? normalizeFeedback(e.feedback) : "",
      e.name,
      e.weight,
      String(e.sets),
      String(e.reps),
    ]);
    blocks.push({
      object: "block",
      type: "table",
      table: {
        table_width: 5,
        has_column_header: true,
        has_row_header: false,
        children: [headerCells, ...dataRows].map((cells) => ({
          object: "block",
          type: "table_row",
          table_row: { cells: cells.map((c) => plain(c)) },
        })),
      },
    });
  }

  if (cardio.length > 0) {
    blocks.push({
      object: "block",
      type: "heading_2",
      heading_2: { rich_text: plain("🏃 有酸素"), color: "green" },
    });
    const headerCells = ["FB", "種目", "時間", "傾斜", "スピード"];
    const dataRows = cardio.map((e) => [
      e.feedback ? normalizeFeedback(e.feedback) : "",
      e.name,
      e.duration,
      e.incline ?? "",
      e.speed ?? "",
    ]);
    blocks.push({
      object: "block",
      type: "table",
      table: {
        table_width: 5,
        has_column_header: true,
        has_row_header: false,
        children: [headerCells, ...dataRows].map((cells) => ({
          object: "block",
          type: "table_row",
          table_row: { cells: cells.map((c) => plain(c)) },
        })),
      },
    });
  }

  return blocks;
}

/**
 * プレーンMarkdownテーブルを生成（ローカルMD・コーチ報告用）
 */
export function formatMenu(exercises: Exercise[]): string {
  const strength = exercises.filter((e): e is StrengthExercise => e.type === "strength");
  const cardio = exercises.filter((e): e is CardioExercise => e.type === "cardio");

  const parts: string[] = [];

  if (strength.length > 0) {
    const lines = [
      "## 筋トレ", "",
      "| FB | 種目 | 重量（kg） | セット | 回数 |",
      "|-----|------|------|--------|------|",
    ];
    strength.forEach((e) => {
      const fb = e.feedback ? normalizeFeedback(e.feedback) : "";
      lines.push(`| ${fb} | ${e.name} | ${e.weight} | ${e.sets} | ${e.reps} |`);
    });
    parts.push(lines.join("\n"));
  }

  if (cardio.length > 0) {
    const lines = [
      "## 有酸素", "",
      "| FB | 種目 | 時間 | 傾斜 | スピード |",
      "|-----|------|------|------|----------|",
    ];
    cardio.forEach((e) => {
      const fb = e.feedback ? normalizeFeedback(e.feedback) : "";
      lines.push(`| ${fb} | ${e.name} | ${e.duration} | ${e.incline ?? ""} | ${e.speed ?? ""} |`);
    });
    parts.push(lines.join("\n"));
  }

  return parts.join("\n\n");
}

// --- パース（Notion fetch 結果から種目を抽出） ---

type ColIndex = {
  fb: number;
  name: number;
  weight?: number;
  sets?: number;
  reps?: number;
  duration?: number;
  incline?: number;
  speed?: number;
};

function buildColIndex(headerCells: string[], section: "strength" | "cardio"): ColIndex {
  const idx: ColIndex = { fb: -1, name: -1 };
  headerCells.forEach((h, i) => {
    const c = h.trim();
    if (c === "FB" || /フィードバック/.test(c)) idx.fb = i;
    else if (c === "種目") idx.name = i;
    else if (/重量/.test(c)) idx.weight = i;
    else if (c === "セット") idx.sets = i;
    else if (c === "回数") idx.reps = i;
    else if (c === "時間") idx.duration = i;
    else if (/傾斜|incline/i.test(c)) idx.incline = i;
    else if (/スピード|速度|speed/i.test(c)) idx.speed = i;
  });
  // 欠損時のフォールバック（旧フォーマット: # 列あり or FB 末尾）
  if (idx.fb < 0) idx.fb = section === "strength" ? 5 : 3;
  if (idx.name < 0) idx.name = 1;
  if (section === "strength") {
    if (idx.weight == null) idx.weight = 2;
    if (idx.sets == null) idx.sets = 3;
    if (idx.reps == null) idx.reps = 4;
  } else {
    if (idx.duration == null) idx.duration = 2;
  }
  return idx;
}

export function parseMenu(text: string): Exercise[] {
  const exercises: Exercise[] = [];
  const lines = text.split("\n");

  let currentSection: "strength" | "cardio" | null = null;
  let inTable = false;
  let isHeaderRow = true;
  let headerCells: string[] = [];
  let colIdx: ColIndex | null = null;
  let cellBuffer: string[] = [];
  let inCell = false;

  for (const line of lines) {
    const trimmed = line.trim();

    // セクション検出（Markdown見出し or Notion XML の見出し）
    if (/筋トレ/.test(trimmed) && !/有酸素/.test(trimmed)) {
      currentSection = "strength";
      inTable = false;
      isHeaderRow = true;
      colIdx = null;
      continue;
    }
    if (/有酸素/.test(trimmed)) {
      currentSection = "cardio";
      inTable = false;
      isHeaderRow = true;
      colIdx = null;
      continue;
    }

    if (!currentSection) continue;

    // Notion XML テーブル形式のパース
    if (trimmed.startsWith("<table")) { inTable = true; continue; }
    if (trimmed === "</table>") { inTable = false; continue; }

    if (inTable) {
      if (trimmed === "<tr>" || trimmed.startsWith("<tr ")) {
        cellBuffer = [];
        inCell = false;
        continue;
      }
      if (trimmed === "</tr>") {
        if (isHeaderRow) {
          headerCells = cellBuffer.slice();
          colIdx = buildColIndex(headerCells, currentSection);
          isHeaderRow = false;
          continue;
        }
        if (currentSection === "strength" && colIdx && cellBuffer.length >= 5) {
          exercises.push({
            type: "strength",
            name: cellBuffer[colIdx.name] ?? "",
            weight: cellBuffer[colIdx.weight!] ?? "",
            sets: Number(cellBuffer[colIdx.sets!]) || 0,
            reps: Number(cellBuffer[colIdx.reps!]) || 0,
            feedback: cellBuffer[colIdx.fb] ?? "",
          });
        } else if (currentSection === "cardio" && colIdx && cellBuffer.length >= 3) {
          exercises.push({
            type: "cardio",
            name: cellBuffer[colIdx.name] ?? "",
            duration: cellBuffer[colIdx.duration!] ?? "",
            incline: colIdx.incline != null ? (cellBuffer[colIdx.incline] ?? "") : "",
            speed: colIdx.speed != null ? (cellBuffer[colIdx.speed] ?? "") : "",
            feedback: cellBuffer[colIdx.fb] ?? "",
          });
        }
        continue;
      }
      if (trimmed.startsWith("<td")) {
        // Inline <td>content</td>
        const match = trimmed.match(/<td[^>]*>(.*?)<\/td>/);
        if (match) {
          cellBuffer.push(match[1]);
        } else {
          inCell = true;
        }
        continue;
      }
      if (trimmed === "</td>") { inCell = false; continue; }
      if (inCell) { cellBuffer.push(trimmed); continue; }
    }

    // プレーン Markdown テーブル形式のパース（フォールバック）
    if (trimmed.startsWith("|")) {
      if (trimmed.match(/^\|[\s\-|]+\|$/)) continue;
      const cells = trimmed.split("|").filter(c => c.trim() !== "").map(c => c.trim());

      if (trimmed.includes("種目")) {
        headerCells = cells;
        colIdx = buildColIndex(headerCells, currentSection);
        continue;
      }

      if (currentSection === "strength" && colIdx && cells.length >= 5) {
        exercises.push({
          type: "strength",
          name: cells[colIdx.name] ?? "",
          weight: cells[colIdx.weight!] ?? "",
          sets: Number(cells[colIdx.sets!]) || 0,
          reps: Number(cells[colIdx.reps!]) || 0,
          feedback: cells[colIdx.fb] ?? "",
        });
      } else if (currentSection === "cardio" && colIdx && cells.length >= 3) {
        exercises.push({
          type: "cardio",
          name: cells[colIdx.name] ?? "",
          duration: cells[colIdx.duration!] ?? "",
          incline: colIdx.incline != null ? (cells[colIdx.incline] ?? "") : "",
          speed: colIdx.speed != null ? (cells[colIdx.speed] ?? "") : "",
          feedback: cells[colIdx.fb] ?? "",
        });
      }
    }
  }

  return exercises;
}

// --- CLI mode ---
if (import.meta.main) {
  const input = await Bun.stdin.text();
  try {
    const data = JSON.parse(input);
    if (data.session && data.exercises) {
      // Notion content mode
      console.log(formatNotionContent(data.session, data.exercises));
    } else if (Array.isArray(data)) {
      // Plain markdown mode (backward compat)
      console.log(formatMenu(data));
    } else {
      throw new Error("Invalid input");
    }
  } catch {
    console.error("Usage:");
    console.error('  Notion: echo \'{"session":{"date":"4/18（金）","time":"12:30〜14:00"},"exercises":[...]}\' | bun run scripts/gym/format-menu.ts');
    console.error('  Plain:  echo \'[{"type":"strength","name":"ダンベルプレス","weight":"36kg","sets":3,"reps":8}]\' | bun run scripts/gym/format-menu.ts');
    process.exit(1);
  }
}
