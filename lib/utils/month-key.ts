/**
 * Format a "YYYY-MM" month key as a human-readable label like
 * "January 2026". Always rendered in UTC so the label matches the
 * raw `YYYY-MM` string the data layer uses — formatting in browser
 * local time would shift the month name for users in negative-UTC
 * timezones (e.g. "2026-02-01T00:00:00Z" becomes "January 31, 2026"
 * in EST and the label drifts off by one).
 *
 * Falls back to the raw key when it isn't a valid YYYY-MM string.
 */
export function formatMonthKey(monthKey: string): string {
  const match = /^(\d{4})-(\d{2})$/.exec(monthKey);
  if (!match) return monthKey;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) {
    return monthKey;
  }
  return new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    timeZone: "UTC",
  });
}