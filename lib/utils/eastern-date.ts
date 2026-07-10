const EASTERN_TIME_ZONE = "America/New_York";

function getEasternParts(date: Date): {
  year: string;
  month: string;
  day: string;
} {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: EASTERN_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });

  const parts = formatter.formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value ?? "1970";
  const month = parts.find((part) => part.type === "month")?.value ?? "01";
  const day = parts.find((part) => part.type === "day")?.value ?? "01";

  return { year, month, day };
}

export function getCurrentEasternIsoDate(now: Date = new Date()): string {
  const { year, month, day } = getEasternParts(now);
  return `${year}-${month}-${day}`;
}

export function getCurrentEasternMonthKey(now: Date = new Date()): string {
  return getCurrentEasternIsoDate(now).slice(0, 7);
}

export function formatEasternCalendarDate(value: string | null | undefined): string {
  if (typeof value !== "string" || !value.trim()) {
    return "—";
  }

  const trimmed = value.trim();
  const isoDateOnlyMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  const date = isoDateOnlyMatch
    ? new Date(`${trimmed}T12:00:00.000Z`)
    : new Date(trimmed);

  if (Number.isNaN(date.getTime())) {
    return trimmed;
  }

  return new Intl.DateTimeFormat("en-US", {
    timeZone: EASTERN_TIME_ZONE,
    month: "short",
    day: "2-digit",
    year: "numeric",
  }).format(date);
}
