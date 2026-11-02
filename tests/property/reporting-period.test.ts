import fc from 'fast-check';
import { resolveReportingPeriod, reportingMonthForDate, calendarMonthWindow, easternDayBounds, assertReportingWindow } from '@/lib/utils/reporting-period';

const windows = [
  { monthKey: '2026-09', leadsFromIso: '2026-09-01', leadsToIso: '2026-10-01' },
  { monthKey: '2026-10', leadsFromIso: '2026-10-02', leadsToIso: '2026-11-02' },
  { monthKey: '2026-11', leadsFromIso: '2026-11-03', leadsToIso: '2026-11-30' },
];
test('November 2 belongs to October through Eastern midnight; November 3 begins November', () => {
  expect(resolveReportingPeriod(windows, new Date('2026-11-03T04:59:59.999Z'))).toMatchObject({ monthKey: '2026-10', leadsFromIso: '2026-10-02', leadsToIso: '2026-11-02', today: '2026-11-02' });
  expect(resolveReportingPeriod(windows, new Date('2026-11-03T05:00:00Z')).monthKey).toBe('2026-11');
  expect(reportingMonthForDate('2026-11-02', windows)).toBe('2026-10');
  expect(reportingMonthForDate('2026-11-03', windows)).toBe('2026-11');
});
test('every date inside an inclusive custom window has its configured month regardless of calendar month', () => {
  fc.assert(fc.property(fc.integer({ min: 0, max: 31 }), offset => {
    const day = new Date(Date.UTC(2026, 9, 2 + offset)).toISOString().slice(0, 10);
    expect(reportingMonthForDate(day, windows)).toBe('2026-10');
  }));
});
test('custom windows override calendar fallback and year-crossing windows work', () => {
  expect(resolveReportingPeriod([], new Date('2026-11-02T12:00:00Z'))).toMatchObject({ monthKey: '2026-11', leadsFromIso: '2026-11-01', leadsToIso: '2026-11-30', isCustom: false });
  expect(reportingMonthForDate('2027-01-02', [{ monthKey: '2026-12', leadsFromIso: '2026-12-02', leadsToIso: '2027-01-02' }])).toBe('2026-12');
  expect(calendarMonthWindow('2028-02').leadsToIso).toBe('2028-02-29');
  expect(reportingMonthForDate('', windows)).toBe('');
});
test('EST and EDT boundaries use actual offsets and include the entire 23/25-hour day', () => {
  expect(easternDayBounds('2026-07-01', '2026-07-01')).toEqual({ from: '2026-07-01T04:00:00.000Z', to: '2026-07-02T03:59:59.999Z' });
  expect(easternDayBounds('2026-12-01', '2026-12-01')).toEqual({ from: '2026-12-01T05:00:00.000Z', to: '2026-12-02T04:59:59.999Z' });
  for (const [day, hours] of [['2026-03-08', 23], ['2026-11-01', 25]] as const) {
    const bounds = easternDayBounds(day, day);
    expect(Date.parse(bounds.to) - Date.parse(bounds.from) + 1).toBe(hours * 60 * 60 * 1000);
  }
});
test('invalid dates, reversed ranges and overlapping configured months are rejected', () => {
  expect(() => assertReportingWindow({ monthKey: '2026-13', leadsFromIso: '2026-11-01', leadsToIso: '2026-11-30' }, [])).toThrow();
  expect(() => assertReportingWindow({ monthKey: '2026-02', leadsFromIso: '2026-02-30', leadsToIso: '2026-03-01' }, [])).toThrow();
  expect(() => assertReportingWindow({ monthKey: '2026-11', leadsFromIso: '2026-11-03', leadsToIso: '2026-11-02' }, [])).toThrow();
  expect(() => assertReportingWindow({ monthKey: '2026-11', leadsFromIso: '2026-11-02', leadsToIso: '2026-11-30' }, windows)).toThrow('overlaps');
  expect(() => assertReportingWindow(windows[2], windows)).not.toThrow();
});
