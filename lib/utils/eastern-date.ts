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

export function formatEasternDateTime(value: string | Date | null | undefined): string {
  if (!value) return "N/A";
  
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);

  return new Intl.DateTimeFormat("en-US", {
    timeZone: EASTERN_TIME_ZONE,
    month: "short",
    day: "2-digit",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(date);
}

/** Interpret a datetime-local value as an Eastern wall-clock time. */
export function easternWallTimeToIso(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) throw new Error("Choose a valid Eastern date and time.");
  const [year, month, day, hour, minute] = match.slice(1).map(Number);
  const localKey = `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}`;
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: EASTERN_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  });
  const matching = [4, 5].map(offset => new Date(Date.UTC(year, month - 1, day, hour + offset, minute)))
    .filter(candidate => {
      const parts = Object.fromEntries(formatter.formatToParts(candidate)
        .filter(part => part.type !== "literal").map(part => [part.type, part.value]));
      return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}` === localKey;
    });
  if (!matching.length) throw new Error("That Eastern time does not exist. Choose another time.");
  return matching[0].toISOString();
}
