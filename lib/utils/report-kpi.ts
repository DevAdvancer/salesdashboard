export interface WorkingDayRange {
  from: string;
  to: string;
}

export interface WorkingDayKpi {
  daily: { date: string; done: boolean }[];
  daysMet: number;
  daysMissed: number;
  totalDays: number;
}

function parseLocalDate(value: string): Date | null {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month, day] = value.split("-").map(Number);
    return new Date(year, month - 1, day);
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
}

function isWeekend(date: Date): boolean {
  const day = date.getDay();
  return day === 0 || day === 6;
}

export function toDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function eachWorkingDateInRange(from: string, to: string): string[] {
  const start = parseLocalDate(from);
  const end = parseLocalDate(to);
  if (!start || !end || start.getTime() > end.getTime()) return [];

  const dates: string[] = [];
  const cursor = new Date(start);
  while (cursor.getTime() <= end.getTime()) {
    if (!isWeekend(cursor)) {
      dates.push(toDateKey(cursor));
    }
    cursor.setDate(cursor.getDate() + 1);
  }
  return dates;
}

export function buildWorkingDayKpi(
  range: WorkingDayRange,
  userLeadDays: Set<string>,
): WorkingDayKpi {
  const dates = eachWorkingDateInRange(range.from, range.to);
  if (dates.length === 0) {
    return { daily: [], daysMet: 0, daysMissed: 0, totalDays: 0 };
  }

  let daysMet = 0;
  const daily = dates.map((date) => {
    const done = userLeadDays.has(date);
    if (done) daysMet += 1;
    return { date, done };
  });

  return {
    daily,
    daysMet,
    daysMissed: daily.length - daysMet,
    totalDays: daily.length,
  };
}
