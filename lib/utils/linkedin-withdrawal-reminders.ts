import type { LinkedinRequest } from '@/lib/types';

export const LINKEDIN_WITHDRAWAL_REMINDER_TYPE = 'linkedin_withdrawal_due';
export const LINKEDIN_ACCEPTED_WITHDRAWAL_REMINDER_TYPE =
  'linkedin_accepted_withdrawal_due';
export const LINKEDIN_SENT_MANUAL_WITHDRAW_DAYS = 15;
export const LINKEDIN_SENT_AUTO_WITHDRAW_DAYS = 20;
export const LINKEDIN_ACCEPTED_LEAD_GRACE_DAYS = 7;
export const LINKEDIN_ACCEPTED_AUTO_WITHDRAW_DAYS = 12;
export const LINKEDIN_REMINDER_MAX_PER_DAY = 5;

const DAY_MS = 24 * 60 * 60 * 1000;

function parseTime(value: string | null | undefined) {
  if (!value) return null;
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? null : time;
}

function getAgeDays(anchorIso: string | null, now: Date) {
  const anchor = parseTime(anchorIso);
  if (anchor === null) return null;
  return Math.floor((now.getTime() - anchor) / DAY_MS);
}

export function getLinkedinReminderPolicy(request: LinkedinRequest) {
  if ((request.isActive ?? true) === false) return null;
  if (request.withdrawnAt) return null;

  if (request.status === 'sent') {
    return {
      type: LINKEDIN_WITHDRAWAL_REMINDER_TYPE,
      title: 'Withdraw Linkedin connection',
      body: `${request.company} connection has been pending for 15+ days. Please withdraw it from Linkedin and mark it withdrawn in CRM.`,
      anchorIso: request.dateSent,
      remindAfterDays: LINKEDIN_SENT_MANUAL_WITHDRAW_DAYS,
      autoWithdrawAfterDays: LINKEDIN_SENT_AUTO_WITHDRAW_DAYS,
    };
  }

  if (request.status === 'accepted' && !request.leadId) {
    return {
      type: LINKEDIN_ACCEPTED_WITHDRAWAL_REMINDER_TYPE,
      title: 'Create lead or withdraw Linkedin connection',
      body: `${request.company} connection was accepted 7+ days ago. Create a lead now or withdraw it from Linkedin and CRM.`,
      anchorIso: request.acceptedAt,
      remindAfterDays: LINKEDIN_ACCEPTED_LEAD_GRACE_DAYS,
      autoWithdrawAfterDays: LINKEDIN_ACCEPTED_AUTO_WITHDRAW_DAYS,
    };
  }

  return null;
}

export function shouldSendLinkedinWithdrawalReminder({
  request,
  now,
  remindersSentToday,
}: {
  request: LinkedinRequest;
  now: Date;
  remindersSentToday: number;
}) {
  const policy = getLinkedinReminderPolicy(request);
  if (!policy) {
    return false;
  }

  const ageDays = getAgeDays(policy.anchorIso, now);
  if (ageDays === null) return false;
  if (ageDays < policy.remindAfterDays) return false;
  if (ageDays >= policy.autoWithdrawAfterDays) return false;
  if (remindersSentToday >= LINKEDIN_REMINDER_MAX_PER_DAY) return false;

  return true;
}

export function shouldAutoWithdrawLinkedinRequest({
  request,
  now,
}: {
  request: LinkedinRequest;
  now: Date;
}) {
  const policy = getLinkedinReminderPolicy(request);
  if (!policy) return false;

  const ageDays = getAgeDays(policy.anchorIso, now);
  if (ageDays === null) return false;
  return ageDays >= policy.autoWithdrawAfterDays;
}

export function buildLinkedinWithdrawalReminder(request: LinkedinRequest) {
  const policy = getLinkedinReminderPolicy(request);
  if (!policy) {
    throw new Error('No reminder policy for this Linkedin request');
  }

  return {
    type: policy.type,
    title: policy.title,
    body: policy.body,
    targetId: request.$id,
    targetType: 'LINKEDIN_REQUEST',
  };
}
