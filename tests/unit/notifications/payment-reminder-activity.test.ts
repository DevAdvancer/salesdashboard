import { latestPaymentActivityAt } from '@/lib/utils/payment-reminder-activity';

const now = new Date('2026-10-26T12:00:00Z');
const payment = { $id: 'payment', leadId: 'lead', createdAt: '2026-06-23T18:56:54.654+00:00',
  updatedAt: '2026-06-23T18:58:44.400+00:00', updates: '[]' };

it('counts a zero amount follow-up and compares timestamps with offsets chronologically', () => {
  expect(latestPaymentActivityAt(payment, [{ leadId: 'lead', amount: 0,
    createdAt: '2026-10-21T10:01:45.587-04:00' }], now)).toBe('2026-10-21T14:01:45.587Z');
});

it('counts edits and legacy native timestamps, rather than the accounting date', () => {
  expect(latestPaymentActivityAt(payment, [{ leadId: 'lead', createdAt: '2026-07-01T12:00:00Z',
    updatedAt: null, $updatedAt: '2026-10-25T14:00:00Z', date: '2026-07-01' }], now))
    .toBe('2026-10-25T14:00:00.000Z');
});

it('does not count reminder writes, other leads, prior-cycle follow-ups, invalid dates, or future timestamps', () => {
  const reopened = { ...payment, createdAt: '2026-10-22T12:00:00Z', updatedAt: null,
    $updatedAt: '2026-10-26T11:00:00Z', lastReminderAt: '2026-10-26T11:00:00Z' };
  expect(latestPaymentActivityAt(reopened, [
    { leadId: 'other', createdAt: '2026-10-25T12:00:00Z' },
    { leadId: 'lead', createdAt: '2026-10-21T12:00:00Z', updatedAt: '2026-10-25T12:00:00Z' },
    { leadId: 'lead', createdAt: 'invalid', updatedAt: '2026-10-25T12:00:00Z' },
    { leadId: 'lead', createdAt: '2027-01-01T00:00:00Z' },
  ], now)).toBe('2026-10-22T12:00:00.000Z');
});

it.each(['updates', 'updatesJson'])('includes payment status notes from %s even when the row timestamp is older', key => {
  const record = { ...payment, updates: undefined, [key]: JSON.stringify([
    { amount: 0, createdAt: '2026-10-24T12:00:00Z' }, { createdAt: 'broken' },
  ]) };
  expect(latestPaymentActivityAt(record, [], now)).toBe('2026-10-24T12:00:00.000Z');
});

it('ignores malformed history and returns null if there is no valid activity timestamp', () => {
  expect(latestPaymentActivityAt({ createdAt: 'broken', updates: '{}' }, [], now)).toBeNull();
});
