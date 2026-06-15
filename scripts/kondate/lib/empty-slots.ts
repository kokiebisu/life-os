export type MealType = "朝" | "昼" | "晩";

export interface Slot {
  date: string;
  mealType: MealType;
  start: string;
  end: string;
}

export interface ExistingEntry {
  date: string;
  startTime: string; // HH:MM
}

interface MealDef {
  mealType: MealType;
  start: string;
  end: string;
  windowStart: number; // minutes since midnight (inclusive)
  windowEnd: number;   // minutes since midnight (exclusive)
}

const MEAL_DEFS: MealDef[] = [
  { mealType: "朝", start: "08:00", end: "09:00", windowStart: timeToMinutes("05:00"), windowEnd: timeToMinutes("11:00") },
  { mealType: "昼", start: "12:00", end: "13:00", windowStart: timeToMinutes("11:00"), windowEnd: timeToMinutes("16:00") },
  { mealType: "晩", start: "19:00", end: "20:00", windowStart: timeToMinutes("16:00"), windowEnd: timeToMinutes("23:59") + 1 },
];

function timeToMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

function addDays(dateStr: string, n: number): string {
  const d = new Date(dateStr + "T12:00:00+09:00");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function computeEmptySlots(
  startDate: string,
  days: number,
  existing: ExistingEntry[]
): Slot[] {
  // Build a lookup: date -> list of startTime minutes
  const occupiedMap = new Map<string, number[]>();
  for (const entry of existing) {
    const mins = timeToMinutes(entry.startTime);
    if (!occupiedMap.has(entry.date)) {
      occupiedMap.set(entry.date, []);
    }
    occupiedMap.get(entry.date)!.push(mins);
  }

  const result: Slot[] = [];

  for (let i = 0; i < days; i++) {
    const date = addDays(startDate, i);
    const occupied = occupiedMap.get(date) ?? [];

    for (const meal of MEAL_DEFS) {
      const isOccupied = occupied.some(
        (mins) => mins >= meal.windowStart && mins < meal.windowEnd
      );
      if (!isOccupied) {
        result.push({
          date,
          mealType: meal.mealType,
          start: meal.start,
          end: meal.end,
        });
      }
    }
  }

  return result;
}
