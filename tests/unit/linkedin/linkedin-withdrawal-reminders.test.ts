import {
  buildLinkedinWithdrawalReminder,
  shouldAutoWithdrawLinkedinRequest,
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
        remindersSentToday: 0,
      })
    ).toBe(true);
  });

  it('does not send before 15 days, after withdrawal, or after 5 reminders in the same day', () => {
    expect(
      shouldSendLinkedinWithdrawalReminder({
        request: request({ dateSent: '2026-05-02T00:00:00.000Z' }),
        now,
        remindersSentToday: 0,
      })
    ).toBe(false);

    expect(
      shouldSendLinkedinWithdrawalReminder({
        request: request({ status: 'withdrawn', withdrawnAt: '2026-05-15T12:00:00.000Z' }),
        now,
        remindersSentToday: 0,
      })
    ).toBe(false);

    expect(
      shouldSendLinkedinWithdrawalReminder({
        request: request({}),
        now,
        remindersSentToday: 5,
      })
    ).toBe(false);
  });

  it('uses the accepted reminder copy after 7 days when no lead exists', () => {
    expect(
      buildLinkedinWithdrawalReminder(
        request({
          status: 'accepted',
          acceptedAt: '2026-05-08T00:00:00.000Z',
          leadId: null,
        }),
      ),
    ).toEqual({
      type: 'linkedin_accepted_withdrawal_due',
      title: 'Create lead or withdraw Linkedin connection',
      body: 'Acme connection was accepted 7+ days ago. Create a lead now or withdraw it from Linkedin and CRM.',
      targetId: 'request-1',
      targetType: 'LINKEDIN_REQUEST',
    });
  });

  it('auto withdraws sent requests after 20 days and accepted requests without leads after 11 days', () => {
    expect(
      shouldAutoWithdrawLinkedinRequest({
        request: request({ dateSent: '2026-04-26T00:00:00.000Z' }),
        now,
      }),
    ).toBe(true);

    // 11 days age should auto withdraw
    expect(
      shouldAutoWithdrawLinkedinRequest({
        request: request({
          status: 'accepted',
          acceptedAt: '2026-05-05T00:00:00.000Z',
          leadId: null,
        }),
        now,
      }),
    ).toBe(true);

    // 10 days age should NOT auto withdraw
    expect(
      shouldAutoWithdrawLinkedinRequest({
        request: request({
          status: 'accepted',
          acceptedAt: '2026-05-06T00:00:00.000Z',
          leadId: null,
        }),
        now,
      }),
    ).toBe(false);

    expect(
      shouldAutoWithdrawLinkedinRequest({
        request: request({
          status: 'accepted',
          acceptedAt: '2026-05-04T00:00:00.000Z',
          leadId: 'lead-1',
        }),
        now,
      }),
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
