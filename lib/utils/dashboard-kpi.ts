import type { Lead, User } from "@/lib/types";

export interface DateRange {
  from?: string;
  to?: string;
}

export interface KpiRow {
  userId: string;
  userName: string;
  userRole: string;
  leadCount: number;
  target: number;
  mode: "daily" | "monthly";
}

/**
 * Counts how many leads a user created within a date range.
 * A lead "belongs" to its `ownerId`.
 */
function countLeadsForUser(leads: Lead[], userId: string): number {
  return leads.filter((lead) => lead.ownerId === userId).length;
}

/**
 * Determines if the range represents a single day.
 */
export function isSingleDay(range: DateRange): boolean {
  return Boolean(range.from && range.to && range.from === range.to);
}

/**
 * Returns the number of days in the month that contains `isoDate`.
 */
function daysInMonth(isoDate: string): number {
  const date = parseIsoDate(isoDate);
  return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
}

/**
 * Parses an ISO date string (YYYY-MM-DD) at local midnight.
 */
function parseIsoDate(iso: string): Date {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(year, month - 1, day);
}

/**
 * Returns true if the given local date falls on a weekend (Saturday or
 * Sunday). The KPI only counts Monday-Friday as "working days" so the
 * monthly target doesn't ask agents to add leads on their days off.
 */
function isWeekend(date: Date): boolean {
  const day = date.getDay();
  return day === 0 || day === 6;
}

/**
 * Counts the number of working days (Monday through Friday) in the
 * inclusive range [fromIso, toIso]. Both bounds are YYYY-MM-DD strings
 * parsed at local midnight. If `toIso` is before `fromIso`, returns 0.
 */
export function workingDaysInRange(fromIso: string, toIso: string): number {
  const start = parseIsoDate(fromIso);
  const end = parseIsoDate(toIso);
  if (end.getTime() < start.getTime()) return 0;

  let count = 0;
  const cursor = new Date(start);
  while (cursor.getTime() <= end.getTime()) {
    if (!isWeekend(cursor)) count += 1;
    cursor.setDate(cursor.getDate() + 1);
  }
  return count;
}

/**
 * Builds per-member lead-target progress rows for the KPI dashboard section.
 *
 * - `leads` should be the date-filtered list (via `listLeads` with `dateFrom`/`dateTo`).
 * - `users` are the in-scope members (all users for admin, team for TL, self for agent).
 * - `range` determines daily vs monthly mode and the target.
 *
 * When `isSingleDay(range)` is true: mode = "daily", target = 1.
 * When the range spans multiple days: mode = "monthly", target = the
 * number of working days (Mon-Fri) within the inclusive range. This
 * gives a 22-day target for a 31-day month with 9 weekend days, and
 * scales down for narrower custom ranges (e.g. one week = 5).
 */
export function buildLeadTargetProgress(params: {
  leads: Lead[];
  users: User[];
  range: DateRange;
}): KpiRow[] {
  const { leads, users, range } = params;
  const singleDay = isSingleDay(range);

  const fromIso = range.from;
  const toIso = range.to ?? range.from;
  let target: number;
  let mode: "daily" | "monthly";

  if (singleDay) {
    target = 1;
    mode = "daily";
  } else if (fromIso && toIso) {
    target = Math.max(1, workingDaysInRange(fromIso, toIso));
    mode = "monthly";
  } else {
    // Fallback: range missing one bound — keep the previous behavior
    // (days-in-month) so the UI never shows 0.
    const effectiveDate = toIso ?? new Date().toISOString().slice(0, 10);
    target = daysInMonth(effectiveDate);
    mode = "monthly";
  }

  return users
    .map((user) => ({
      userId: user.$id,
      userName: user.name,
      userRole: user.role,
      leadCount: countLeadsForUser(leads, user.$id),
      target,
      mode,
    }))
    .sort((a, b) => {
      const aMet = a.leadCount >= a.target;
      const bMet = b.leadCount >= b.target;
      if (aMet !== bMet) return aMet ? 1 : -1;
      // Underperformers first, largest gap first
      const aGap = a.target - a.leadCount;
      const bGap = b.target - b.leadCount;
      if (aGap !== bGap) return bGap - aGap;
      return a.userName.localeCompare(b.userName);
    });
}
