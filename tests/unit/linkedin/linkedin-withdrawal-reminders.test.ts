import {
  buildLinkedinWithdrawalReminder,
  getLinkedinAutoWithdrawalDaysLeft,
  getLinkedinManualWithdrawalTiming,
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
  it('preserves an old sent request once it is linked to an existing lead',()=>{
    const linked=request({status:'sent',leadId:'existing-lead',dateSent:'2026-01-01T00:00:00.000Z'});
    expect(shouldAutoWithdrawLinkedinRequest({request:linked,now})).toBe(false);
    expect(shouldSendLinkedinWithdrawalReminder({request:linked,now,remindersSentToday:0})).toBe(false);
  });

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

  it('includes the 25-day conversion deadline in the accepted reminder', () => {
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
      body: 'Acme connection was accepted 20+ days ago. Create a lead within 25 days of acceptance to keep it active.',
      targetId: 'request-1',
      targetType: 'LINKEDIN_REQUEST',
    });
  });

  it('makes a pending invitation eligible on the fifteenth Eastern calendar day', () => {
    const pending = request({ dateSent: '2026-05-01T00:00:00.000Z' });
    expect(shouldAutoWithdrawLinkedinRequest({ request: pending, now: new Date('2026-05-16T03:59:59.999Z') })).toBe(false);
    expect(shouldAutoWithdrawLinkedinRequest({ request: pending, now: new Date('2026-05-16T04:00:00.000Z') })).toBe(true);
  });

  it('makes an accepted connection eligible after 25 elapsed days from acceptance when it has no lead', () => {
    const accepted = request({ status: 'accepted', dateSent: '2026-04-03T00:00:00.000Z', acceptedAt: '2026-04-21T12:00:00.000Z' });
    const almostDue = new Date('2026-05-16T11:59:59.999Z');
    expect(getLinkedinAutoWithdrawalDaysLeft(accepted, almostDue)).toBe(1);
    expect(shouldAutoWithdrawLinkedinRequest({ request: accepted, now: almostDue })).toBe(false);
    expect(getLinkedinAutoWithdrawalDaysLeft(accepted, now)).toBe(0);
    expect(shouldAutoWithdrawLinkedinRequest({ request: accepted, now })).toBe(true);
    expect(shouldAutoWithdrawLinkedinRequest({ request: { ...accepted, leadId: 'lead-1' }, now })).toBe(false);
  });

  it('opens manual withdrawal at 20 elapsed days after acceptance and leaves five days before automatic eligibility', () => {
    const accepted = request({ status: 'accepted', acceptedAt: '2026-04-26T12:00:00.000Z' });
    const before = new Date('2026-05-16T11:59:59.999Z');
    expect(getLinkedinManualWithdrawalTiming(accepted, before)).toEqual({ minimumDays: 20, daysLeft: 1 });
    expect(getLinkedinManualWithdrawalTiming(accepted, now)).toEqual({ minimumDays: 20, daysLeft: 0 });
    expect(getLinkedinAutoWithdrawalDaysLeft(accepted, now)).toBe(5);
    expect(getLinkedinManualWithdrawalTiming({ ...accepted, leadId: 'lead-1' }, now)).toBeNull();
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
