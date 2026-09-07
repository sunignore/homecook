// Local calendar-day helpers for the weekly meal plan.
//
// A plan entry is for a day on the wall calendar, not an instant (docs/data-model.md
// §2, `MealPlan.date`) — every date here is computed in local time. A UTC-derived
// calculation would put an evening entry on the wrong day for anyone west of UTC.

function parse(dateStr: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y!, m! - 1, d!);
}

export function toLocalDateString(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function todayLocalDateString(): string {
  return toLocalDateString(new Date());
}

export function addDays(dateStr: string, days: number): string {
  const date = parse(dateStr);
  date.setDate(date.getDate() + days);
  return toLocalDateString(date);
}

/** The Monday on or before `dateStr` — a stable anchor for a weekly window. */
export function startOfWeek(dateStr: string): string {
  const date = parse(dateStr);
  const day = date.getDay(); // 0 = Sunday
  const diff = day === 0 ? -6 : 1 - day;
  date.setDate(date.getDate() + diff);
  return toLocalDateString(date);
}

export function weekDates(weekStart: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
}

export function formatDayLabel(dateStr: string): string {
  return parse(dateStr).toLocaleDateString('ko-KR', {
    month: 'long',
    day: 'numeric',
    weekday: 'short',
  });
}
