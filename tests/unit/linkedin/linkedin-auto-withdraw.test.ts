import { applyLinkedinWithdrawals, planLinkedinWithdrawals,
  sendLinkedinWithdrawalReport } from '@/lib/server/linkedin-auto-withdraw';
import type { LinkedinRequest, User } from '@/lib/types';
import { getReportEmails } from '@/lib/server/report-email-settings';
import { sendNotificationEmail } from '@/lib/server/email-service';

jest.mock('@/lib/server/email-service', () => ({ sendNotificationEmail: jest.fn() }));
jest.mock('@/lib/server/report-email-settings', () => ({ getReportEmails: jest.fn() }));
jest.mock('node-appwrite', () => ({ Query: {
  equal: jest.fn((key, value) => `equal:${key}:${JSON.stringify(value)}`),
  select: jest.fn((fields) => `select:${fields.join(',')}`),
} }));

const now = new Date('2026-10-14T16:00:00.000Z');
const request = (id: string, overrides: Partial<LinkedinRequest> = {}) => ({
  $id: id, agentId: 'agent-inactive', company: 'Vizva INC',
  targetUrl: `https://www.linkedin.com/in/${id}`, status: 'sent', isActive: true,
  dateSent: '2026-10-13T00:00:00.000Z', acceptedAt: null, withdrawnAt: null,
  leadId: null, ...overrides,
}) as LinkedinRequest;

it('withdraws every active request of an inactive agent, including accepted requests with leads', () => {
  const users = [{ $id: 'agent-inactive', name: 'Inactive Agent', isActive: false },
    { $id: 'agent-active', name: 'Active Agent', isActive: true }] as User[];
  const planned = planLinkedinWithdrawals([
    request('sent'),
    request('accepted-with-lead', { status: 'accepted', leadId: 'lead-1' }),
    request('old-active', { agentId: 'agent-active', dateSent: '2026-09-01T00:00:00.000Z' }),
    request('recent-active', { agentId: 'agent-active' }),
    request('already-withdrawn', { status: 'withdrawn', isActive: false }),
  ], users, now);
  expect(planned.map(({ request: item, reason }) => [item.$id, reason])).toEqual([
    ['sent', 'inactive agent'], ['accepted-with-lead', 'inactive agent'],
    ['old-active', 'expired request'],
  ]);
});

it('rechecks current state before writing a withdrawal', async () => {
  const first = request('first');
  const second = request('second');
  const databases = { getDocument: jest.fn(async (_db, _collection, id) =>
    id === 'first' ? first : { ...second, isActive: false }),
    updateDocument: jest.fn().mockResolvedValue({}),
  };
  const planned = [{ request: first, agentName: 'Agent', reason: 'inactive agent' as const },
    { request: second, agentName: 'Agent', reason: 'inactive agent' as const }];
  const result = await applyLinkedinWithdrawals(databases as never, planned, now);
  expect(result.withdrawn.map(entry => entry.request.$id)).toEqual(['first']);
  expect(databases.updateDocument).toHaveBeenCalledWith(expect.any(String), expect.any(String),
    'first', { status: 'withdrawn', isActive: false, withdrawnAt: now.toISOString() });
  expect(databases.updateDocument).toHaveBeenCalledTimes(1);
});

it('emails only actual withdrawals to Settings recipients and escapes profile data', async () => {
  (getReportEmails as jest.Mock).mockResolvedValue(['reports@example.com']);
  (sendNotificationEmail as jest.Mock).mockResolvedValue({ messageId: 'sent' });
  const databases = {};
  expect(await sendLinkedinWithdrawalReport(databases as never, [], now))
    .toEqual({ emailSent: false, recipientCount: 0 });
  expect(getReportEmails).not.toHaveBeenCalled();
  const withdrawn = [{ request: request('person', { company: '<Vizva>' }),
    agentName: 'Agent', reason: 'inactive agent' as const }];
  expect(await sendLinkedinWithdrawalReport(databases as never, withdrawn, now))
    .toEqual({ emailSent: true, recipientCount: 1 });
  expect(sendNotificationEmail).toHaveBeenCalledWith(expect.objectContaining({
    to: 'reports@example.com', subject: expect.stringContaining('LinkedIn Withdrawal Report'),
    html: expect.stringContaining('&lt;Vizva&gt;'), allowAllRecipients: true,
    attachments: [expect.objectContaining({ filename: expect.stringMatching(/\.csv$/),
      content: expect.stringContaining('https://www.linkedin.com/in/person') })],
  }));
});

it('sends the Monday zero-withdrawal CSV to every address returned by Settings', async () => {
  (getReportEmails as jest.Mock).mockResolvedValue(['one@example.com', 'two@example.com']);
  (sendNotificationEmail as jest.Mock).mockResolvedValue({ messageId: 'sent' });
  expect(await sendLinkedinWithdrawalReport({} as never, [], now, { sendEmpty: true }))
    .toEqual({ emailSent: true, recipientCount: 2 });
  expect(sendNotificationEmail).toHaveBeenLastCalledWith(expect.objectContaining({
    to: 'one@example.com,two@example.com', allowAllRecipients: true,
    html: expect.stringContaining('0 request(s) withdrawn.'),
    attachments: [expect.objectContaining({ content: 'Agent,Company,Profile,Reason,Request ID' })],
  }));
});

it('includes the failure count without claiming failed requests were withdrawn', async () => {
  (getReportEmails as jest.Mock).mockResolvedValue(['reports@example.com']);
  (sendNotificationEmail as jest.Mock).mockResolvedValue({ messageId: 'sent' });
  await sendLinkedinWithdrawalReport({} as never, [], now, { sendEmpty: true, failedCount: 2 });
  expect(sendNotificationEmail).toHaveBeenLastCalledWith(expect.objectContaining({
    html: expect.stringContaining('2 request(s) could not be withdrawn.'),
    attachments: [expect.objectContaining({ content: 'Agent,Company,Profile,Reason,Request ID' })],
  }));
});
