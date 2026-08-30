function addDays(dateStr: string, n: number): string {
  const d = new Date(dateStr + "T12:00:00+09:00");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// auto 実行時の買い出し日時 default:
//   - 最初の調理日 - 1日 18:00-19:00（前日夕方）
//   - 前日が今日以前なら fallback で「最初の調理日 10:00-11:00」
export function decideGroceryDateTime(
  firstCookingDate: string,
  today: string,
): { date: string; start: string; end: string } {
  const dayBefore = addDays(firstCookingDate, -1);
  if (dayBefore >= today) {
    return { date: dayBefore, start: "18:00", end: "19:00" };
  }
  return { date: firstCookingDate, start: "10:00", end: "11:00" };
}

export function formatGroceryTitle(date: string): string {
  const d = new Date(date + "T12:00:00+09:00");
  const m = d.getUTCMonth() + 1;
  const day = d.getUTCDate();
  return `買い出し ${m}/${day}`;
}
