import type { NextRequest } from 'next/server';
import { GET } from '@/app/api/cron/payment-reminders/route';
import { createAdminClient } from '@/lib/server/appwrite';
import { createNotificationsForRecipients } from '@/lib/server/notifications';
import { COLLECTIONS, DATABASE_ID } from '@/lib/constants/appwrite';
import type { PaymentStatus } from '@/lib/types';

jest.mock('next/server', () => ({
  NextResponse: { json: (body: unknown) => ({ json: async () => body }) },
}));
jest.mock('node-appwrite', () => ({
  Query: { equal: jest.fn(), lessThanEqual: jest.fn(), limit: jest.fn() },
}));
jest.mock('@/lib/server/appwrite', () => ({ createAdminClient: jest.fn() }));
jest.mock('@/lib/server/notifications', () => ({ createNotificationsForRecipients: jest.fn() }));
jest.mock('@/lib/server/holiday-calendar', () => ({ listHolidayDateKeys: jest.fn().mockResolvedValue([]) }));

describe('payment reminder eligibility', () => {
  const originalSecret = process.env.CRON_SECRET;
  const originalStaleDays = process.env.PAYMENT_REMINDER_STALE_DAYS;
  const payment = {
    $id: 'payment-1', leadId: 'lead-1',
    createdAt: '2026-08-01T12:00:00.000Z',
    updatedAt: '2026-08-01T12:00:00.000Z',
    paymentPlan: '{}',
  };
  const databases = {
    listDocuments: jest.fn(),
    getDocument: jest.fn(),
    updateDocument: jest.fn(),
  };
  const request = {
    headers: { get: (name: string) => name === 'authorization' ? 'Bearer test-secret' : null },
  } as unknown as NextRequest;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers().setSystemTime(new Date('2026-10-22T12:00:00.000Z'));
    process.env.CRON_SECRET = 'test-secret';
    process.env.PAYMENT_REMINDER_STALE_DAYS = '30';
    (createAdminClient as jest.Mock).mockResolvedValue({ databases });
    databases.getDocument.mockImplementation(async (_database, collection) =>
      collection === COLLECTIONS.LEADS
        ? { $id: 'lead-1', isClosed: true, assignedToId: 'agent-1', data: '{"firstName":"Test"}' }
        : { $id: 'agent-1', teamLeadId: 'team-lead-1' },
    );
    databases.updateDocument.mockResolvedValue({});
  });

  afterEach(() => {
    jest.useRealTimers();
    if (originalSecret === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = originalSecret;
    if (originalStaleDays === undefined) delete process.env.PAYMENT_REMINDER_STALE_DAYS;
    else process.env.PAYMENT_REMINDER_STALE_DAYS = originalStaleDays;
  });

  function setPaymentStatus(status: PaymentStatus | undefined) {
    databases.listDocuments.mockImplementation(async (_database, collection) => ({
      documents: collection === COLLECTIONS.CLIENT_PAYMENTS
        ? [{ ...payment, status }]
        : [{ $id: 'admin-1' }],
    }));
  }

  it.each<PaymentStatus>(['non_upfront', 'fully_paid', 'refunded'])(
    'does not send reminders or mark a reminder as sent for %s payments',
    async (status) => {
      setPaymentStatus(status);

      const response = await GET(request);

      expect(await response.json()).toMatchObject({ ok: true, remindersSent: 0 });
      expect(createNotificationsForRecipients).not.toHaveBeenCalled();
      expect(databases.getDocument).not.toHaveBeenCalled();
      expect(databases.updateDocument).not.toHaveBeenCalled();
    },
  );

  it.each<PaymentStatus | undefined>(['not_paid', 'partially_paid', undefined])(
    'still sends overdue reminders for %s payments',
    async (status) => {
      setPaymentStatus(status);

      const response = await GET(request);

      expect(await response.json()).toMatchObject({ ok: true, remindersSent: 1 });
      expect(createNotificationsForRecipients).toHaveBeenCalledWith(
        databases,
        ['agent-1', 'team-lead-1', 'admin-1'],
        expect.objectContaining({ type: 'CLIENT_PAYMENT_STALE', targetId: 'lead-1' }),
      );
      expect(databases.updateDocument).toHaveBeenCalledWith(
        DATABASE_ID, COLLECTIONS.CLIENT_PAYMENTS, payment.$id,
        { lastReminderAt: '2026-10-22T12:00:00.000Z' },
      );
    },
  );
});
