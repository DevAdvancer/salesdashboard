export function parseIsoDate(iso: string): Date {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(year, month - 1, day);
}

export function toIsoDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function isWeekend(date: Date): boolean {
  const day = date.getDay();
  return day === 0 || day === 6;
}

export function normalizeHolidayDateKeys(
  values: Iterable<string> | undefined | null,
): Set<string> {
  const result = new Set<string>();
  if (!values) return result;

  for (const value of values) {
    if (typeof value !== "string") continue;
    const normalized = value.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
      result.add(normalized);
    }
  }

  return result;
}

export function isHolidayDateKey(
  isoDate: string,
  holidayDateKeys: Iterable<string> | undefined | null,
): boolean {
  return normalizeHolidayDateKeys(holidayDateKeys).has(isoDate);
}

export function isWorkingDateKey(
  isoDate: string,
  holidayDateKeys: Iterable<string> | undefined | null = [],
): boolean {
  const date = parseIsoDate(isoDate);
  if (isWeekend(date)) return false;
  return !normalizeHolidayDateKeys(holidayDateKeys).has(isoDate);
}

export function workingDaysInRange(
  fromIso: string,
  toIso: string,
  holidayDateKeys: Iterable<string> | undefined | null = [],
): number {
  const start = parseIsoDate(fromIso);
  const end = parseIsoDate(toIso);
  if (end.getTime() < start.getTime()) return 0;

  const holidays = normalizeHolidayDateKeys(holidayDateKeys);
  let count = 0;
  const cursor = new Date(start);
  while (cursor.getTime() <= end.getTime()) {
    const dayKey = toIsoDateKey(cursor);
    if (!isWeekend(cursor) && !holidays.has(dayKey)) {
      count += 1;
    }
    cursor.setDate(cursor.getDate() + 1);
  }
  return count;
}
