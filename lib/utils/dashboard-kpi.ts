import type { Lead, User } from "@/lib/types";
import {
  parseIsoDate,
  workingDaysInRange as countWorkingDaysInRange,
} from "@/lib/utils/holiday-calendar";

export interface DateRange {
  from?: string;
  to?: string;
}

export interface KpiRow {
  userId: string;
  userName: string;
  userRole: string;
  leadCount: number;
  assignedLeadCount?: number;
  notInterestedCount?: number;
  target: number;
  mode: "daily" | "monthly";
}

/**
 * Normalizes a source string for matching: lowercases, trims whitespace,
 * strips everything that isn't a letter or digit.
 */
function normalizeSource(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

const REFERRAL_SOURCE_NORMALIZED = "referral";

function isReferralSource(source: unknown): boolean {
  return normalizeSource(source) === REFERRAL_SOURCE_NORMALIZED;
}

/**
 * Counts how many leads a user created within a date range.
 * A lead "belongs" to its `ownerId` or its original `creatorId` inside JSON data.
 *
 * All leads count regardless of status (including "not interested").
 * Leads with source === "referral" are excluded from KPI counting.
 */
function countLeadsForUser(leads: Lead[], userId: string): number {
  return leads.filter((lead) => {
    // Check if the lead was created by this user
    let creatorId = lead.ownerId;
    try {
      const leadData = JSON.parse(lead.data);
      if (leadData && leadData.creatorId) {
        creatorId = leadData.creatorId;
      }
    } catch {}

    if (creatorId !== userId) return false;

    // Exclude referral sources from KPI
    try {
      const leadData = JSON.parse(lead.data);
      if (leadData && isReferralSource(leadData.source)) {
        return false;
      }
    } catch {}

    return true;
  }).length;
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
 * Counts the number of working days (Monday through Friday) in the
 * inclusive range [fromIso, toIso]. Both bounds are YYYY-MM-DD strings
 * parsed at local midnight. If `toIso` is before `fromIso`, returns 0.
 */
export function workingDaysInRange(
  fromIso: string,
  toIso: string,
  holidayDateKeys?: Iterable<string>,
): number {
  return countWorkingDaysInRange(fromIso, toIso, holidayDateKeys);
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
      assignedLeadCount: leads.filter((lead) => lead.assignedToId === user.$id).length,
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
