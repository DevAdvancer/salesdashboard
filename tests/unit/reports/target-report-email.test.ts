import { targetReportEmailDates, targetReportEmailSchedule, targetReportEmailSubject } from '@/lib/utils/target-report-email';

const period = { monthKey: '2026-10', leadsFromIso: '2026-09-28', leadsToIso: '2026-11-02' };

test('sends the final report on the custom end date, even outside the reporting month and on a Monday', () => {
  expect(targetReportEmailSchedule(period, new Date('2026-11-02T22:00:00Z'))).toEqual({ isFinal: true, shouldSend: true });
  expect(targetReportEmailDates(period)).toContain('Final target report: Nov 02, 2026');
  expect(targetReportEmailSubject(period.monthKey)).toBe('SALES-US Target Report October 2026');
});

test('keeps Friday updates, skips other days and dates after the deadline', () => {
  expect(targetReportEmailSchedule(period, new Date('2026-10-30T22:00:00Z'))).toEqual({ isFinal: false, shouldSend: true });
  expect(targetReportEmailSchedule(period, new Date('2026-11-01T22:00:00Z')).shouldSend).toBe(false);
  expect(targetReportEmailSchedule(period, new Date('2026-11-06T22:00:00Z')).shouldSend).toBe(false);
});

test('uses the Eastern date across UTC midnight and marks a Friday deadline as one final report', () => {
  const friday = { ...period, leadsToIso: '2026-10-30' };
  expect(targetReportEmailSchedule(friday, new Date('2026-10-31T00:30:00Z'))).toEqual({ isFinal: true, shouldSend: true });
});
