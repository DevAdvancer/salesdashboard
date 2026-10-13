import { getCurrentEasternIsoDate } from '@/lib/utils/eastern-date';

export function getLinkedinRequestDateFilterValue(dateSent: string) {
  const parsed = new Date(dateSent);
  if (Number.isNaN(parsed.getTime())) return "";

  return parsed.toISOString().slice(0, 10);
}

// dateSent is a calendar date stored at 00:00 UTC, not an instant to display in Eastern time.
export function formatLinkedinRequestSentDate(dateSent: string): string {
  const day = getLinkedinRequestDateFilterValue(dateSent);
  if (!day) return '—';
  const [year, month, date] = day.split('-');
  return `${Number(month)}/${Number(date)}/${year}`;
}

export function daysSinceLinkedinRequestDate(dateSent: string, now: Date = new Date()): number {
  const day = getLinkedinRequestDateFilterValue(dateSent);
  if (!day) return 0;
  const today = getCurrentEasternIsoDate(now);
  return Math.max(0, Math.floor((Date.parse(`${today}T00:00:00.000Z`) -
    Date.parse(`${day}T00:00:00.000Z`)) / 86_400_000));
}

export function daysSinceLinkedinRequestEvent(occurredAt: string, now: Date = new Date()): number {
  const event = new Date(occurredAt);
  if (Number.isNaN(event.getTime())) return 0;
  return daysSinceLinkedinRequestDate(getCurrentEasternIsoDate(event), now);
}
