/**
 * Convert a YYYY-MM-DD date string to a full ISO timestamp at the
 * start of that day in UTC (00:00:00.000Z).
 *
 * Used to convert dashboard date-range inputs to a format that
 * `Query.greaterThanEqual` can compare against a full ISO timestamp
 * column (e.g. `$createdAt`, `dateSent`). Comparing a YYYY-MM-DD
 * string against an ISO timestamp lexicographically gives the wrong
 * result: the timestamp is always longer (e.g.
 * "2026-06-22T10:00:00.000Z") and sorts AFTER the date-only form
 * ("2026-06-22"). Without expanding the date, a `lessThanEqual`
 * filter on the YYYY-MM-DD form would silently exclude every lead for
 * that day.
 *
 * Full ISO datetimes (containing "T") are passed through unchanged.
 */
export function expandIsoDateToStart(value: string): string {
  if (!value) return value;
  if (value.includes("T")) return value;
  const [y, m, d] = value.split("-").map(Number);
  if (!y || !m || !d) return value;
  return new Date(Date.UTC(y, m - 1, d, 0, 0, 0, 0)).toISOString();
}

/**
 * Convert a YYYY-MM-DD date string to a full ISO timestamp at the
 * inclusive end of that day in UTC (23:59:59.999Z). Used for
 * `Query.lessThanEqual` so the entire selected day is included.
 *
 * Full ISO datetimes are passed through unchanged.
 */
export function expandIsoDateToEnd(value: string): string {
  if (!value) return value;
  if (value.includes("T")) return value;
  const [y, m, d] = value.split("-").map(Number);
  if (!y || !m || !d) return value;
  return new Date(Date.UTC(y, m - 1, d, 23, 59, 59, 999)).toISOString();
}
