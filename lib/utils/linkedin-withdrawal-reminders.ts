import type { LinkedinRequest } from '@/lib/types';

export const LINKEDIN_WITHDRAWAL_REMINDER_TYPE = 'linkedin_withdrawal_due';
export const LINKEDIN_WITHDRAWAL_REMINDER_DAYS = 15;
export const LINKEDIN_WITHDRAWAL_REMINDER_INTERVAL_MS = 60 * 60 * 1000;

const DAY_MS = 24 * 60 * 60 * 1000;

function parseTime(value: string | null | undefined) {
  if (!value) return null;
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? null : time;
}

export function shouldSendLinkedinWithdrawalReminder({
  request,
  now,
  lastReminderCreatedAt,
}: {
  request: LinkedinRequest;
  now: Date;
  lastReminderCreatedAt?: string | null;
}) {
  if ((request.isActive ?? true) === false) return false;
  if (request.status !== 'sent') return false;
  if (request.withdrawnAt) return false;

  const sentAt = parseTime(request.dateSent);
  if (sentAt === null) return false;

  const ageMs = now.getTime() - sentAt;
  if (ageMs < LINKEDIN_WITHDRAWAL_REMINDER_DAYS * DAY_MS) return false;

  const lastReminderAt = parseTime(lastReminderCreatedAt);
  if (
    lastReminderAt !== null &&
    now.getTime() - lastReminderAt < LINKEDIN_WITHDRAWAL_REMINDER_INTERVAL_MS
  ) {
    return false;
  }

  return true;
}

export function buildLinkedinWithdrawalReminder(request: LinkedinRequest) {
  return {
    type: LINKEDIN_WITHDRAWAL_REMINDER_TYPE,
    title: 'Withdraw Linkedin connection',
    body: `${request.company} connection has been pending for 15+ days. Please withdraw it from Linkedin and mark it withdrawn in CRM.`,
    targetId: request.$id,
    targetType: 'LINKEDIN_REQUEST',
  };
}
