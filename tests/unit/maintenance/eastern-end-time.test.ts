import { easternWallTimeToIso } from '@/lib/utils/eastern-date';

test('interprets the chosen maintenance end in Eastern time across DST', () => {
  expect(easternWallTimeToIso('2026-10-14T15:30')).toBe('2026-10-14T19:30:00.000Z');
  expect(easternWallTimeToIso('2026-12-14T15:30')).toBe('2026-12-14T20:30:00.000Z');
});

test('rejects the nonexistent Eastern hour at spring clock change', () => {
  expect(() => easternWallTimeToIso('2026-03-08T02:30')).toThrow('does not exist');
});
