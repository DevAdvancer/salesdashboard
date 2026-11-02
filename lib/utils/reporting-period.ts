import { getCurrentEasternIsoDate, easternWallTimeToIso } from '@/lib/utils/eastern-date';

export type ReportingWindow = { monthKey: string; leadsFromIso: string; leadsToIso: string };
export type ReportingPeriod = ReportingWindow & { isCustom: boolean; today: string };
export function calendarMonthWindow(monthKey: string): ReportingWindow {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(monthKey)) throw new Error('Choose a valid reporting month.');
  const [year, month] = monthKey.split('-').map(Number);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return { monthKey, leadsFromIso: `${monthKey}-01`, leadsToIso: `${monthKey}-${lastDay}` };
}
export function reportingMonthForDate(date: string, windows: readonly ReportingWindow[]) {
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) return '';
  const day = /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : getCurrentEasternIsoDate(parsed);
  const match = windows.filter(window => window.leadsFromIso <= day && window.leadsToIso >= day)
    .sort((a, b) => a.leadsFromIso.localeCompare(b.leadsFromIso) || a.monthKey.localeCompare(b.monthKey))[0];
  return match?.monthKey || day.slice(0, 7);
}
export function resolveReportingPeriod(windows: readonly ReportingWindow[], now = new Date()): ReportingPeriod {
  const today = getCurrentEasternIsoDate(now);
  const monthKey = reportingMonthForDate(today, windows);
  const custom = windows.find(window => window.monthKey === monthKey);
  const window = custom || calendarMonthWindow(monthKey);
  return { monthKey, leadsFromIso: window.leadsFromIso, leadsToIso: window.leadsToIso, isCustom: !!custom, today };
}
export function reportingPeriodThroughToday(period: ReportingWindow, today = getCurrentEasternIsoDate()) {
  return { from: period.leadsFromIso, to: period.leadsToIso < today ? period.leadsToIso : today };
}
export function easternDayBounds(from: string, to: string) {
  return { from: easternWallTimeToIso(`${from}T00:00`), to: easternWallTimeToIso(`${to}T23:59`).replace(':00.000Z', ':59.999Z') };
}
export function assertReportingWindow(window: ReportingWindow, others: readonly ReportingWindow[]) {
  calendarMonthWindow(window.monthKey);
  for (const day of [window.leadsFromIso, window.leadsToIso]) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || Number.isNaN(Date.parse(day)) || new Date(`${day}T12:00:00Z`).toISOString().slice(0, 10) !== day) throw new Error('Choose valid start and end dates.');
  }
  if (window.leadsFromIso > window.leadsToIso) throw new Error('Start date must be on or before end date.');
  const overlap = others.find(other => other.monthKey !== window.monthKey && other.leadsFromIso <= window.leadsToIso && other.leadsToIso >= window.leadsFromIso);
  if (overlap) throw new Error(`This window overlaps the configured ${overlap.monthKey} window. Each date must belong to one reporting month.`);
}
