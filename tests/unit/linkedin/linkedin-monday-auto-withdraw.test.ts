/** @jest-environment node */
jest.mock('@/lib/server/appwrite', () => ({ createAdminClient: jest.fn() }));
jest.mock('@/lib/server/linkedin-auto-withdraw', () => ({
  runLinkedinWithdrawalSweep: jest.fn(), sendLinkedinWithdrawalReport: jest.fn(),
}));
jest.mock('@/lib/server/notifications', () => ({ createNotificationsForRecipients: jest.fn() }));
jest.mock('@/lib/utils/logger', () => ({ logger: { error: jest.fn() } }));

import { NextRequest } from 'next/server';
import { GET } from '@/app/api/cron/linkedin-withdrawal-reminders/route';
import { createAdminClient } from '@/lib/server/appwrite';
import { runLinkedinWithdrawalSweep, sendLinkedinWithdrawalReport } from '@/lib/server/linkedin-auto-withdraw';
import { createNotificationsForRecipients } from '@/lib/server/notifications';
import { bumpRequestCount } from '@/lib/server/appwrite-request-meter';
import config from '@/vercel.json';

const originalSecret = process.env.CRON_SECRET;
const databases = {};
const withdrawn = [{ request: { $id: 'old-request' }, agentName: 'Agent', reason: 'expired request' }];
const cronRequest = (headers: Record<string, string> = { authorization: 'Bearer cron-test-secret' }) =>
  new NextRequest('https://crm.example.com/api/cron/linkedin-withdrawal-reminders', { headers });

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers().setSystemTime(new Date('2026-10-19T14:00:00Z'));
  process.env.CRON_SECRET = 'cron-test-secret';
  (createAdminClient as jest.Mock).mockResolvedValue({ databases });
  (runLinkedinWithdrawalSweep as jest.Mock).mockImplementation(async () => {
    bumpRequestCount();
    return { evaluated: 5, planned: withdrawn, withdrawn, errors: [] };
  });
  (sendLinkedinWithdrawalReport as jest.Mock).mockResolvedValue({ emailSent: true, recipientCount: 4 });
});
afterEach(() => {
  jest.useRealTimers();
  if (originalSecret === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = originalSecret;
});

it('requires the cron secret before reading or mutating any CRM data', async () => {
  for (const headers of [{}, { authorization: 'Bearer wrong-secret' }]) {
    expect((await GET(cronRequest(headers))).status).toBe(401);
  }
  delete process.env.CRON_SECRET;
  expect((await GET(cronRequest())).status).toBe(401);
  expect(createAdminClient).not.toHaveBeenCalled();
});

it('automatically withdraws and sends only the Settings report, without agent reminders or summaries', async () => {
  const response = await GET(cronRequest());
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    ok: true, evaluated: 5, autoWithdrawn: 1, remindersSent: 0, remindersSkipped: true,
    reportEmailSent: true, reportRecipientCount: 4, appwriteRequests: 1,
    todayStartIso: '2026-10-19T04:00:00.000Z',
  });
  expect(runLinkedinWithdrawalSweep).toHaveBeenCalledWith(databases, new Date('2026-10-19T14:00:00Z'));
  expect(sendLinkedinWithdrawalReport).toHaveBeenCalledWith(databases, withdrawn,
    new Date('2026-10-19T14:00:00Z'), { sendEmpty: true, failedCount: 0 });
  expect(createNotificationsForRecipients).not.toHaveBeenCalled();
});

it('emails a scheduled report even when there is nothing eligible to withdraw', async () => {
  (runLinkedinWithdrawalSweep as jest.Mock).mockResolvedValue({ evaluated: 3, planned: [], withdrawn: [], errors: [] });
  const response = await GET(cronRequest({ 'x-cron-secret': 'cron-test-secret' }));
  expect(response.status).toBe(200);
  expect(sendLinkedinWithdrawalReport).toHaveBeenCalledWith(databases, [], expect.any(Date), { sendEmpty: true, failedCount: 0 });
});

it('includes partial failures in the emailed report and surfaces the failed job status', async () => {
  (runLinkedinWithdrawalSweep as jest.Mock).mockResolvedValue({ evaluated: 5, planned: withdrawn,
    withdrawn, errors: [{ requestId: 'failed', message: 'SDK details' }] });
  const response = await GET(cronRequest());
  expect(response.status).toBe(500);
  expect(await response.json()).toMatchObject({ ok: false, autoWithdrawn: 1, withdrawalErrors: 1, reportEmailSent: true });
  expect(sendLinkedinWithdrawalReport).toHaveBeenCalledWith(databases, withdrawn, expect.any(Date), { sendEmpty: true, failedCount: 1 });
});

it.each([
  { emailSent: false, recipientCount: 4 },
  { emailSent: false, recipientCount: 0 },
])('does not report success if email delivery fails or Settings has no recipients: %o', async report => {
  (sendLinkedinWithdrawalReport as jest.Mock).mockResolvedValue(report);
  const response = await GET(cronRequest());
  expect(response.status).toBe(500);
  expect(await response.json()).toMatchObject({ ok: false, autoWithdrawn: 1, reportEmailSent: false, reportError: expect.any(String) });
  expect(createNotificationsForRecipients).not.toHaveBeenCalled();
});

it('redacts a mail transport exception while preserving the actual withdrawal count', async () => {
  (sendLinkedinWithdrawalReport as jest.Mock).mockRejectedValue(new Error('private SMTP details'));
  const response = await GET(cronRequest());
  const body = await response.json();
  expect(response.status).toBe(500);
  expect(body.autoWithdrawn).toBe(1);
  expect(JSON.stringify(body)).not.toContain('private SMTP details');
});

it('keeps the Monday schedule and its existing URL', () => {
  expect(config.crons.filter(cron => cron.path === '/api/cron/linkedin-withdrawal-reminders'))
    .toEqual([{ path: '/api/cron/linkedin-withdrawal-reminders', schedule: '0 14 * * 1' }]);
});
