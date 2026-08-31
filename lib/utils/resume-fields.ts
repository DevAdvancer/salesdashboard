/**
 * Structured field helpers for Resume Profiles (Education and Timeline).
 */

export interface EducationEntry {
  type: string;
  otherType: string;
  institution: string;
  location: string;
  startDate: string;
  endDate: string;
  isPresent: boolean;
}

export interface TimelineEntry {
  client: string;
  jobRole: string;
  startDate: string;
  endDate: string;
  isPresent: boolean;
  location: string;
}

export interface ParsedEducation {
  entries: EducationEntry[];
  legacyText: string;
}

export interface ResumeProfileData {
  educationHistory?: string | null;
  cptEmployers?: string | null;
  optEmployers?: string | null;
  stemOptEmployers?: string | null;
  timelineEntries?: string | null;
}

export interface ParsedTimeline {
  entries: TimelineEntry[];
  /** Non-empty only when the stored value was free text, not structured JSON. */
  legacyText: string;
}

export function emptyEducationEntry(): EducationEntry {
  return {
    type: '',
    otherType: '',
    institution: '',
    location: '',
    startDate: '',
    endDate: '',
    isPresent: false,
  };
}

export function emptyTimelineEntry(): TimelineEntry {
  return {
    client: '',
    jobRole: '',
    startDate: '',
    endDate: '',
    isPresent: false,
    location: '',
  };
}

function isEducationEntry(value: unknown): value is EducationEntry {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.type === 'string' &&
    typeof v.otherType === 'string' &&
    typeof v.institution === 'string' &&
    typeof v.startDate === 'string' &&
    typeof v.endDate === 'string' &&
    typeof v.isPresent === 'boolean'
  );
}

function isTimelineEntry(value: unknown): value is TimelineEntry {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.client === 'string' &&
    typeof v.jobRole === 'string' &&
    typeof v.startDate === 'string' &&
    typeof v.endDate === 'string' &&
    typeof v.location === 'string'
  );
}

export function isEducationEntryEmpty(entry: EducationEntry): boolean {
  return (
    !entry.type.trim() &&
    !entry.otherType.trim() &&
    !entry.institution.trim() &&
    !entry.startDate.trim() &&
    !entry.endDate.trim()
  );
}

export function isTimelineEntryEmpty(entry: TimelineEntry): boolean {
  return (
    !entry.client.trim() &&
    !entry.jobRole.trim() &&
    !entry.startDate.trim() &&
    !entry.endDate.trim() &&
    !entry.location.trim()
  );
}

export function parseEducation(raw: string | null | undefined): ParsedEducation {
  if (!raw || !raw.trim()) {
    return { entries: [], legacyText: '' };
  }

  const trimmed = raw.trim();
  if (trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed) && parsed.every(isEducationEntry)) {
        // Backfill location for old entries that don't have it
        const entries = parsed.map((e: any) => ({
          ...emptyEducationEntry(),
          ...e,
          location: e.location ?? '',
        }));
        return { entries, legacyText: '' };
      }
    } catch {
      // Ignored
    }
  }

  return { entries: [], legacyText: trimmed };
}

export function parseTimeline(raw: string | null | undefined): ParsedTimeline {
  if (!raw || !raw.trim()) {
    return { entries: [], legacyText: '' };
  }

  const trimmed = raw.trim();
  if (trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed) && parsed.every(isTimelineEntry)) {
        // Backfill isPresent for old entries that don't have it
        const entries = parsed.map((e: any) => ({
          ...emptyTimelineEntry(),
          ...e,
          isPresent: e.isPresent ?? false,
        }));
        return { entries, legacyText: '' };
      }
    } catch {
      // fall through to legacy handling
    }
  }

  return { entries: [], legacyText: trimmed };
}

export function serializeEducation(entries: EducationEntry[]): string | null {
  const cleaned = entries
    .map((e) => ({
      type: e.type.trim(),
      otherType: e.otherType.trim(),
      institution: e.institution.trim(),
      location: (e.location || '').trim(),
      startDate: e.startDate.trim(),
      endDate: e.isPresent ? '' : e.endDate.trim(),
      isPresent: e.isPresent,
    }))
    .filter((e) => !isEducationEntryEmpty(e));

  return cleaned.length > 0 ? JSON.stringify(cleaned) : null;
}

export function serializeTimeline(entries: TimelineEntry[]): string | null {
  const cleaned = entries
    .map((e) => ({
      client: e.client.trim(),
      jobRole: e.jobRole.trim(),
      startDate: e.startDate.trim(),
      endDate: e.isPresent ? '' : e.endDate.trim(),
      isPresent: e.isPresent,
      location: e.location.trim(),
    }))
    .filter((e) => !isTimelineEntryEmpty(e));

  return cleaned.length > 0 ? JSON.stringify(cleaned) : null;
}
