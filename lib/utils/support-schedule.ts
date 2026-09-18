const EASTERN_TIME_ZONE = "America/New_York";

const easternDateTimeFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: EASTERN_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function formatEasternDateTime(date: Date): string {
  const parts = Object.fromEntries(
    easternDateTimeFormatter.formatToParts(date).map(({ type, value }) => [type, value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

// The picker has minute precision. The current, partially elapsed minute is
// already in the past, so the earliest selectable time is the next minute.
export function getMinimumSupportDateTime(now: Date = new Date()): string {
  const nextMinute = new Date((Math.floor(now.getTime() / 60_000) + 1) * 60_000);
  return formatEasternDateTime(nextMinute);
}

export function isValidSupportDateTime(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) return false;

  const [, year, month, day, hour, minute] = match.map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day, hour, minute));
  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day &&
    parsed.getUTCHours() === hour &&
    parsed.getUTCMinutes() === minute
  );
}

export function isFutureSupportDateTime(value: string, now: Date = new Date()): boolean {
  return isValidSupportDateTime(value) && value >= getMinimumSupportDateTime(now);
}

export function getMinimumAssessmentDeadline(received: string, now: Date = new Date()): string {
  const minimum = getMinimumSupportDateTime(now);
  if (!isValidSupportDateTime(received) || received < minimum) return minimum;

  // Use UTC arithmetic only to increment a wall-clock value. The form stores
  // Eastern calendar fields, not an instant with a UTC offset.
  const nextMinute = new Date(Date.parse(`${received}Z`) + 60_000).toISOString().slice(0, 16);
  return nextMinute > minimum ? nextMinute : minimum;
}
