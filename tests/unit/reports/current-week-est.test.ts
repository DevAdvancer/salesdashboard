import { getCurrentWeekEst } from '@/lib/utils/est-date';

test.each([
  ['2026-10-21T18:00:00Z', '2026-10-19', '2026-10-25'],
  ['2026-10-26T03:59:59Z', '2026-10-19', '2026-10-25'],
  ['2026-10-26T04:00:00Z', '2026-10-26', '2026-11-01'],
  ['2026-11-02T04:59:59Z', '2026-10-26', '2026-11-01'],
  ['2026-11-02T05:00:00Z', '2026-11-02', '2026-11-08'],
])('current week follows Eastern dates including DST at %s', (now, from, to) => {
  expect(getCurrentWeekEst(new Date(now))).toEqual({ from, to });
});
