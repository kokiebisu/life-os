/**
 * 07:00–12:30 JST の中で、90 分の空きスロットを探す。
 * 候補開始時刻: 07:00, 07:30, 08:00, ..., 11:00（30 分刻み）
 * 終了時刻 = 開始 + 90 分。busy 区間と[start,end)で重なったらスキップ。
 * 全候補が衝突する場合 null を返す。
 */

export interface Busy {
  start: string; // "HH:MM" JST
  end: string;   // "HH:MM" JST
}

export interface Slot {
  start: string;
  end: string;
}

const SESSION_MIN = 90;
const STEP_MIN = 30;
const FIRST_START_MIN = 7 * 60;   // 07:00
const LAST_START_MIN = 11 * 60;   // 11:00

function toMin(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

function toHHMM(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function overlaps(aStart: number, aEnd: number, b: Busy): boolean {
  const bs = toMin(b.start);
  const be = toMin(b.end);
  return aStart < be && bs < aEnd;
}

export function pickEmptySlot(busy: Busy[]): Slot | null {
  for (let s = FIRST_START_MIN; s <= LAST_START_MIN; s += STEP_MIN) {
    const e = s + SESSION_MIN;
    const conflict = busy.some((b) => overlaps(s, e, b));
    if (!conflict) return { start: toHHMM(s), end: toHHMM(e) };
  }
  return null;
}
