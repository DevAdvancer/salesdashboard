/**
 * Structured work-experience helpers for Resume Profiles.
 *
 * The `indiaExperience`, `cptDetails`, `optDetails`, and `stemOptDetails`
 * columns are plain strings in Appwrite. To capture experience as discrete
 * per-employer fields (Employer / Job Title / Start / End) without a schema
 * change, we serialize an array of `EmployerEntry` to JSON and store it in the
 * same column.
 *
 * Backward compatibility: older records hold free-text in these columns. The
 * parse helpers detect that (JSON.parse fails or the value isn't the expected
 * shape) and surface it as `legacyText` so nothing is lost — the UI shows it in
 * a "previously entered" note and lets the user re-enter it as structured rows.
 */

export interface EmployerEntry {
  employer: string;
  jobTitle: string;
  startDate: string;
  endDate: string;
}

export interface ParsedExperience {
  entries: EmployerEntry[];
  /** Non-empty only when the stored value was free text, not structured JSON. */
  legacyText: string;
}

export function emptyEmployerEntry(): EmployerEntry {
  return { employer: '', jobTitle: '', startDate: '', endDate: '' };
}

function isEmployerEntry(value: unknown): value is EmployerEntry {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.employer === 'string' &&
    typeof v.jobTitle === 'string' &&
    typeof v.startDate === 'string' &&
    typeof v.endDate === 'string'
  );
}

export function isEmployerEntryEmpty(entry: EmployerEntry): boolean {
  return (
    !entry.employer.trim() &&
    !entry.jobTitle.trim() &&
    !entry.startDate.trim() &&
    !entry.endDate.trim()
  );
}

/**
 * Parse a stored column value into structured entries. Accepts a JSON array of
 * `EmployerEntry`, and gracefully falls back to `legacyText` for anything else.
 */
export function parseExperience(raw: string | null | undefined): ParsedExperience {
  if (!raw || !raw.trim()) {
    return { entries: [], legacyText: '' };
  }

  const trimmed = raw.trim();
  if (trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed) && parsed.every(isEmployerEntry)) {
        return { entries: parsed, legacyText: '' };
      }
    } catch {
      // fall through to legacy handling
    }
  }

  return { entries: [], legacyText: trimmed };
}

/**
 * Serialize entries back to a JSON string for storage. Empty rows are dropped;
 * an all-empty list serializes to null so the column stays clean.
 */
export function serializeExperience(entries: EmployerEntry[]): string | null {
  const cleaned = entries
    .map((e) => ({
      employer: e.employer.trim(),
      jobTitle: e.jobTitle.trim(),
      startDate: e.startDate.trim(),
      endDate: e.endDate.trim(),
    }))
    .filter((e) => !isEmployerEntryEmpty(e));

  return cleaned.length > 0 ? JSON.stringify(cleaned) : null;
}

/** Human-readable one-line summary of a single entry, for read-only views. */
export function formatEmployerEntry(entry: EmployerEntry): string {
  const range = [entry.startDate, entry.endDate].filter(Boolean).join(' – ');
  return [entry.employer, entry.jobTitle, range].filter(Boolean).join(' · ');
}
