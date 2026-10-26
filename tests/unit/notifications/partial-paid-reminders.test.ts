import type { NextRequest } from 'next/server';
import { GET } from '@/app/api/cron/partial-paid-reminders/route';
import { createAdminClient } from '@/lib/server/appwrite';
import { createNotificationsForRecipients } from '@/lib/server/notifications';
import { COLLECTIONS } from '@/lib/constants/appwrite';

jest.mock('next/server', () => ({ NextResponse: { json: (body: unknown) => ({ json: async () => body }) } }));
jest.mock('node-appwrite', () => ({ Query: {
  equal: (k: string, v: unknown) => ({ k, v }), lessThanEqual: jest.fn(), limit: jest.fn(),
  select: jest.fn(), orderAsc: jest.fn(), greaterThanEqual: jest.fn(), cursorAfter: jest.fn(),
} }));
jest.mock('@/lib/server/appwrite', () => ({ createAdminClient: jest.fn() }));
jest.mock('@/lib/server/notifications', () => ({ createNotificationsForRecipients: jest.fn() }));
jest.mock('@/lib/server/holiday-calendar', () => ({ listHolidayDateKeys: jest.fn().mockResolvedValue([]) }));

const request = { headers: { get: (key: string) => key === 'authorization' ? 'Bearer test-secret' : null } } as unknown as NextRequest;
const payment = { $id: 'payment', leadId: 'lead', status: 'partially_paid', paymentPlan: '{}',
  createdAt: '2026-06-01T12:00:00Z', updatedAt: '2026-06-01T12:00:00Z' };
const databases = { listDocuments: jest.fn(), updateDocument: jest.fn() };
const originalSecret = process.env.CRON_SECRET;
const originalDays = process.env.PARTIAL_PAID_STALE_DAYS;

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers().setSystemTime(new Date('2026-10-26T12:00:00Z'));
  process.env.CRON_SECRET = 'test-secret';
  process.env.PARTIAL_PAID_STALE_DAYS = '2';
  (createAdminClient as jest.Mock).mockResolvedValue({ databases });
});
afterEach(() => {
  jest.useRealTimers();
  if (originalSecret === undefined) delete process.env.CRON_SECRET; else process.env.CRON_SECRET = originalSecret;
  if (originalDays === undefined) delete process.env.PARTIAL_PAID_STALE_DAYS; else process.env.PARTIAL_PAID_STALE_DAYS = originalDays;
});

function source(followups: unknown[], isClosed = false) {
  databases.listDocuments.mockImplementation(async (_db, collection, queries) => ({ documents:
    collection === COLLECTIONS.CLIENT_PAYMENTS ? [payment]
      : collection === COLLECTIONS.PREVIOUS_FOLLOWUPS_PAYMENTS ? followups
      : collection === COLLECTIONS.LEADS ? [{ $id: 'lead', ownerId: 'agent', isClosed, data: '{}' }]
      : collection === COLLECTIONS.USERS ? (queries.some((q: any) => q?.k === 'role')
        ? [{ $id: 'admin' }] : [{ $id: 'agent', teamLeadId: 'tl' }]) : [],
  }));
}

it('does not send the two-day alert after a recent $0 follow-up note', async () => {
  source([{ $id: 'note', leadId: 'lead', amount: 0, createdAt: '2026-10-25T12:00:00Z' }]);
  expect(await (await GET(request)).json()).toMatchObject({ remindersSent: 0 });
  expect(createNotificationsForRecipients).not.toHaveBeenCalled();
});

it('resumes after the follow-up becomes stale and reports days since that follow-up', async () => {
  source([{ $id: 'note', leadId: 'lead', amount: 0, createdAt: '2026-10-21T12:00:00Z' }]);
  expect(await (await GET(request)).json()).toMatchObject({ remindersSent: 1 });
  expect(createNotificationsForRecipients).toHaveBeenCalledWith(databases, ['agent', 'tl', 'admin'],
    expect.objectContaining({ body: expect.stringContaining('no update in 5 days') }));
});

it('keeps closed leads in the existing closed-payment reminder policy', async () => {
  source([], true);
  expect(await (await GET(request)).json()).toMatchObject({ remindersSent: 0, skippedClosed: 1 });
});

it('sends nothing when source follow-up activity cannot be read', async () => {
  source([]);
  const implementation = databases.listDocuments.getMockImplementation()!;
  databases.listDocuments.mockImplementation((...args) => args[1] === COLLECTIONS.PREVIOUS_FOLLOWUPS_PAYMENTS
    ? Promise.reject(new Error('source offline')) : implementation(...args));
  await expect(GET(request)).rejects.toThrow('source offline');
  expect(createNotificationsForRecipients).not.toHaveBeenCalled();
});
