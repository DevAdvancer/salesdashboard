import { filterResolvedPaymentReminders } from '@/lib/server/payment-reminder-notifications';
import { COLLECTIONS } from '@/lib/constants/appwrite';
import type { NotificationRecord } from '@/lib/types';

jest.mock('node-appwrite', () => ({ Query: {
  equal: (k: string, v: unknown) => ({ k, v }), limit: jest.fn(), orderAsc: jest.fn(), select: jest.fn(),
} }));
const now = new Date('2026-10-26T12:00:00Z');
const payment = { $id: 'payment', leadId: 'lead', status: 'partially_paid',
  createdAt: '2026-06-23T18:56:54.654Z', updatedAt: '2026-06-23T18:58:44.400Z' };
const notice = (id: string, createdAt: string, type = 'CLIENT_PAYMENT_STALE') => ({
  $id: id, recipientId: 'viewer', targetId: 'lead', type, createdAt, readAt: null,
}) as NotificationRecord;

function sources(payments: unknown[], followups: unknown[]) {
  const fresh = { listDocuments: jest.fn(async (_db, collection) => ({ documents:
    collection === COLLECTIONS.CLIENT_PAYMENTS ? payments : followups,
  })) };
  return { listDocuments: jest.fn(), uncachedReads: fresh };
}

it('hides both answered and false alerts shown after the screenshot follow-up without writes', async () => {
  const db = sources([payment], [{ $id: 'note', leadId: 'lead', amount: 0,
    createdAt: '2026-10-21T14:01:45.587+00:00' }]);
  const unrelated = notice('other', '2026-10-26T05:00:00Z', 'LEAD_ASSIGNMENT');
  const result = await filterResolvedPaymentReminders(db as never, [
    notice('answered', '2026-10-21T05:00:30Z'), notice('false', '2026-10-26T05:00:27Z'), unrelated,
  ], now);
  expect(result).toEqual([unrelated]);
  expect(db.listDocuments).not.toHaveBeenCalled();
  expect(db.uncachedReads.listDocuments).toHaveBeenCalledWith(expect.any(String), COLLECTIONS.CLIENT_PAYMENTS,
    expect.arrayContaining([{ k: 'leadId', v: ['lead'] }]));
});

it('keeps a valid overdue alert and treats two-day and thirty-day reminders separately', async () => {
  const db = sources([payment], [{ leadId: 'lead', createdAt: '2026-10-21T12:00:00Z' }]);
  const valid = notice('partial', '2026-10-26T05:00:00Z', 'CLIENT_PAYMENT_PARTIAL_PAID_STALE');
  const invalid = notice('closed', '2026-10-26T05:00:00Z');
  expect(await filterResolvedPaymentReminders(db as never, [valid, invalid], now)).toEqual([valid]);
});

it.each(['fully_paid', 'non_upfront', 'refunded'])('hides payment reminders after status becomes %s', async status => {
  const db = sources([{ ...payment, status }], []);
  expect(await filterResolvedPaymentReminders(db as never, [notice('old', '2026-10-26T05:00:00Z')], now)).toEqual([]);
});

it('does not query payment data when the recipient has no payment reminders', async () => {
  const db = sources([], []);
  const notifications = [notice('other', '2026-10-26T05:00:00Z', 'CALENDAR')];
  expect(await filterResolvedPaymentReminders(db as never, notifications, now)).toEqual(notifications);
  expect(db.uncachedReads.listDocuments).not.toHaveBeenCalled();
});
