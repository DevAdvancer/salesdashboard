import {
  buildLinkedinWithdrawalReminder,
  shouldSendLinkedinWithdrawalReminder,
} from '@/lib/utils/linkedin-withdrawal-reminders';
import type { LinkedinRequest } from '@/lib/types';

function request(overrides: Partial<LinkedinRequest>): LinkedinRequest {
  return {
    $id: 'request-1',
    accountId: 'account-1',
    agentId: 'agent-1',
    teamLeadId: 'team-lead-1',
    company: 'Acme',
    idName: 'Primary',
    accountType: 'main',
    targetUrl: 'https://linkedin.com/in/acme-person',
    dateSent: '2026-05-01T00:00:00.000Z',
    status: 'sent',
    acceptedAt: null,
    withdrawnAt: null,
    isActive: true,
    ...overrides,
  } as LinkedinRequest;
}

describe('linkedin withdrawal reminders', () => {
  const now = new Date('2026-05-16T12:00:00.000Z');

  it('sends reminder for active sent request after 15 days when no recent reminder exists', () => {
    expect(
      shouldSendLinkedinWithdrawalReminder({
        request: request({ dateSent: '2026-05-01T09:00:00.000Z' }),
        now,
        lastReminderCreatedAt: null,
      })
    ).toBe(true);
  });

  it('does not send before 15 days, after withdrawal, or within one hour of the last reminder', () => {
    expect(
      shouldSendLinkedinWithdrawalReminder({
        request: request({ dateSent: '2026-05-02T00:00:00.000Z' }),
        now,
        lastReminderCreatedAt: null,
      })
    ).toBe(false);

    expect(
      shouldSendLinkedinWithdrawalReminder({
        request: request({ status: 'withdrawn', withdrawnAt: '2026-05-15T12:00:00.000Z' }),
        now,
        lastReminderCreatedAt: null,
      })
    ).toBe(false);

    expect(
      shouldSendLinkedinWithdrawalReminder({
        request: request({}),
        now,
        lastReminderCreatedAt: '2026-05-16T11:30:00.000Z',
      })
    ).toBe(false);
  });

  it('builds a clear agent notification payload', () => {
    expect(buildLinkedinWithdrawalReminder(request({ company: 'Silverspace' }))).toEqual({
      type: 'linkedin_withdrawal_due',
      title: 'Withdraw Linkedin connection',
      body: 'Silverspace connection has been pending for 15+ days. Please withdraw it from Linkedin and mark it withdrawn in CRM.',
      targetId: 'request-1',
      targetType: 'LINKEDIN_REQUEST',
    });
  });
});
