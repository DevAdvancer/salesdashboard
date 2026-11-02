/** @jest-environment node */
import { allowClientCardRead } from '@/lib/server/client-card-rate-limit';
test('limits repeated attempts without database counters and resets on the next window', () => {
  const start = 100000000;
  for (let i = 0; i < 30; i++) expect(allowClientCardRead('ip-one', `share-${i}`, start)).toBe(true);
  expect(allowClientCardRead('ip-one', 'another-share', start)).toBe(false);
  expect(allowClientCardRead('ip-one', 'another-share', start + 60001)).toBe(true);
});
test('rotating IPs and grant IDs still encounters a bounded per-instance request budget', () => {
  const start = 200000000;
  for (let i = 0; i < 120; i++) expect(allowClientCardRead(`ip-${i}`, `share-${i}`, start)).toBe(true);
  expect(allowClientCardRead('new-ip', 'new-share', start)).toBe(false);
});
