/**
 * Shared utility for computing "today" and date boundaries in the
 * America/New_York (EST/EDT) timezone.
 *
 * All dashboard date defaults and "Today" buttons must use these
 * helpers so the shown date always matches EST, regardless of the
 * server's host timezone or the user's browser locale.
 */

const EST_TIMEZONE = "America/New_York";

/**
 * Returns today's date as a YYYY-MM-DD string in America/New_York.
 * Safe to call on both the server and the browser.
 *
 * @param now - override for the current time (defaults to `new Date()`)
 */
export function getTodayEst(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: EST_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/**
 * Returns the first day of the current month as a YYYY-MM-DD string
 * in America/New_York.
 *
 * @param now - override for the current time (defaults to `new Date()`)
 */
export function getMonthStartEst(now: Date = new Date()): string {
  // Get the year and month in EST.
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: EST_TIMEZONE,
    year: "numeric",
    month: "2-digit",
  }).formatToParts(now);

  const year = parts.find((p) => p.type === "year")?.value ?? "";
  const month = parts.find((p) => p.type === "month")?.value ?? "";
  return `${year}-${month}-01`;
}

/**
 * Returns the last day of the current month as a YYYY-MM-DD string
 * in America/New_York.
 *
 * @param now - override for the current time (defaults to `new Date()`)
 */
export function getMonthEndEst(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: EST_TIMEZONE,
    year: "numeric",
    month: "2-digit",
  }).formatToParts(now);

  const year = Number(parts.find((p) => p.type === "year")?.value ?? "0");
  const month = Number(parts.find((p) => p.type === "month")?.value ?? "1");
  // Last day of month: day 0 of the next month.
  const lastDay = new Date(Date.UTC(year, month, 0));
  const dd = String(lastDay.getUTCDate()).padStart(2, "0");
  const mm = String(month).padStart(2, "0");
  return `${year}-${mm}-${dd}`;
}
