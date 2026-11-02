import { formatEasternCalendarDate, getCurrentEasternIsoDate } from '@/lib/utils/eastern-date';
import type { ReportingWindow } from '@/lib/utils/reporting-period';

export function targetReportEmailSubject(monthKey: string) {
  const month = new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })
    .format(new Date(`${monthKey}-01T12:00:00Z`));
  return `SALES-US Target Report ${month}`;
}

export function targetReportEmailSchedule(period: ReportingWindow, now = new Date()) {
  const today = getCurrentEasternIsoDate(now);
  const isFinal = today === period.leadsToIso;
  const isFriday = new Intl.DateTimeFormat('en-US', { weekday: 'long', timeZone: 'America/New_York' }).format(now) === 'Friday';
  return { isFinal, shouldSend: isFinal || (isFriday && today >= period.leadsFromIso && today < period.leadsToIso) };
}

export function targetReportEmailDates(period: ReportingWindow) {
  return `Reporting period: ${formatEasternCalendarDate(period.leadsFromIso)} – ${formatEasternCalendarDate(period.leadsToIso)} (Eastern time). Final target report: ${formatEasternCalendarDate(period.leadsToIso)}.`;
}
