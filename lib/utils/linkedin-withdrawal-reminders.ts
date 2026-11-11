import type { LinkedinRequest } from '@/lib/types';
import { daysSinceLinkedinRequestDate } from '@/lib/utils/linkedin-request-dates';

export const LINKEDIN_WITHDRAWAL_REMINDER_TYPE = 'linkedin_withdrawal_due';
export const LINKEDIN_ACCEPTED_WITHDRAWAL_REMINDER_TYPE =
  'linkedin_accepted_withdrawal_due';
export const LINKEDIN_SENT_MANUAL_WITHDRAW_DAYS = 15;
export const LINKEDIN_SENT_AUTO_WITHDRAW_DAYS = LINKEDIN_SENT_MANUAL_WITHDRAW_DAYS;
export const LINKEDIN_ACCEPTED_LEAD_GRACE_DAYS = 20;
export const LINKEDIN_ACCEPTED_AUTO_WITHDRAW_DAYS = 25;
export const LINKEDIN_REMINDER_MAX_PER_DAY = 5;

const DAY_MS = 24 * 60 * 60 * 1000;

function getAgeDays(anchorIso: string | null, isSentDate: boolean, now: Date) {
  if (!anchorIso) return null;
  const anchor = Date.parse(anchorIso);
  if (!Number.isFinite(anchor)) return null;
  return isSentDate ? daysSinceLinkedinRequestDate(anchorIso, now) : Math.floor((now.getTime() - anchor) / DAY_MS);
}

export function getLinkedinManualWithdrawalTiming(request: LinkedinRequest, now = new Date()) {
  if (request.isActive === false || request.withdrawnAt) return null;
  const minimumDays = request.status === 'sent' ? LINKEDIN_SENT_MANUAL_WITHDRAW_DAYS :
    request.status === 'accepted' && !request.leadId ? LINKEDIN_ACCEPTED_LEAD_GRACE_DAYS : null;
  if (minimumDays === null) return null;
  const acceptedAt = request.status === 'accepted' ? request.acceptedAt : null;
  const ageDays = getAgeDays(acceptedAt || request.dateSent, !acceptedAt, now);
  return ageDays === null ? null : { minimumDays, daysLeft: Math.max(0, minimumDays - ageDays) };
}

export function getLinkedinReminderPolicy(request: LinkedinRequest) {
  if ((request.isActive ?? true) === false) return null;
  if (request.withdrawnAt) return null;
  // Existing leads keep their request link; lead status governs reuse of the profile.
  if (request.leadId) return null;

  if (request.status === 'sent') {
    return {
      type: LINKEDIN_WITHDRAWAL_REMINDER_TYPE,
      title: 'Withdraw Linkedin connection',
      body: `${request.company} connection has been pending for ${LINKEDIN_SENT_MANUAL_WITHDRAW_DAYS}+ days. Please withdraw it from Linkedin and mark it withdrawn in CRM.`,
      anchorIso: request.dateSent,
      remindAfterDays: LINKEDIN_SENT_MANUAL_WITHDRAW_DAYS,
      autoWithdrawAfterDays: LINKEDIN_SENT_AUTO_WITHDRAW_DAYS,
    };
  }

  if (request.status === 'accepted' && !request.leadId) {
    return {
      type: LINKEDIN_ACCEPTED_WITHDRAWAL_REMINDER_TYPE,
      title: 'Create lead or withdraw Linkedin connection',
      body: `${request.company} connection was accepted ${LINKEDIN_ACCEPTED_LEAD_GRACE_DAYS}+ days ago. Create a lead within ${LINKEDIN_ACCEPTED_AUTO_WITHDRAW_DAYS} days of acceptance to keep it active.`,
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

  const ageDays = getAgeDays(policy.anchorIso, request.status === 'sent', now);
  if (ageDays === null) return false;
  // Fire the reminder exactly on the day it becomes due, so it only happens once.
  if (ageDays !== policy.remindAfterDays) return false;
  if (remindersSentToday >= LINKEDIN_REMINDER_MAX_PER_DAY) return false;

  return true;
}

export function getLinkedinAutoWithdrawalDaysLeft(request: LinkedinRequest, now = new Date()) {
  const policy = getLinkedinReminderPolicy(request);
  if (!policy) return null;

  const ageDays = getAgeDays(policy.anchorIso, request.status === 'sent', now);
  return ageDays === null ? null : Math.max(0, policy.autoWithdrawAfterDays - ageDays);
}

export function shouldAutoWithdrawLinkedinRequest({ request, now }: { request: LinkedinRequest; now: Date }) {
  return getLinkedinAutoWithdrawalDaysLeft(request, now) === 0;
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
