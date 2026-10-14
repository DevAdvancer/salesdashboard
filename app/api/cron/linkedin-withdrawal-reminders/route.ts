import { NextResponse, type NextRequest } from 'next/server';
import { Query } from 'node-appwrite';
import { COLLECTIONS, DATABASE_ID } from '@/lib/constants/appwrite';
import { createAdminClient } from '@/lib/server/appwrite';
import { listAllDocuments } from '@/lib/server/appwrite-pagination';
import { applyLinkedinWithdrawals, listActiveLinkedinRequests,
  planLinkedinWithdrawals, sendLinkedinWithdrawalReport } from '@/lib/server/linkedin-auto-withdraw';
import { getRequestCount, withRequestMeter } from '@/lib/server/appwrite-request-meter';
import {
  loadNotificationCountsSince,
  notificationDedupKey,
} from '@/lib/server/notification-dedup';
import { createNotificationsForRecipients } from '@/lib/server/notifications';
import type { User } from '@/lib/types';
import {
  buildLinkedinWithdrawalReminder,
  getLinkedinReminderPolicy,
  shouldSendLinkedinWithdrawalReminder,
  LINKEDIN_ACCEPTED_WITHDRAWAL_REMINDER_TYPE,
  LINKEDIN_WITHDRAWAL_REMINDER_TYPE,
} from '@/lib/utils/linkedin-withdrawal-reminders';

// Every reminder this cron can emit, so one sweep covers both policies.
const LINKEDIN_REMINDER_TYPES = [
  LINKEDIN_WITHDRAWAL_REMINDER_TYPE,
  LINKEDIN_ACCEPTED_WITHDRAWAL_REMINDER_TYPE,
];

function getAuthorizationToken(request: NextRequest) {
  const header = request.headers.get('authorization');
  if (!header) return null;
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || null;
}

function isAuthorized(request: NextRequest): { authorized: boolean; debug?: any } {
  const expected = process.env.CRON_SECRET;
  const authHeader = request.headers.get('authorization');
  const providedToken = getAuthorizationToken(request);
  const providedHeader = request.headers.get('x-cron-secret');
  const provided = providedToken ?? providedHeader;
  
  if (!expected) {
    return { authorized: false, debug: { reason: 'No CRON_SECRET in env' } };
  }
  
  const authorized = Boolean(provided) && provided === expected;
  if (!authorized) {
    return { 
      authorized: false, 
      debug: { 
        reason: 'Mismatch', 
        hasAuthHeader: !!authHeader,
        providedLength: provided?.length,
        expectedLength: expected?.length
      } 
    };
  }
  
  return { authorized: true };
}

function getTodayStartIso(now: Date) {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0),
  ).toISOString();
}

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = isAuthorized(request);
  if (!auth.authorized) {
    return NextResponse.json({ error: 'Unauthorized', debug: auth.debug }, { status: 401 });
  }

  // The scope has to be opened here. getRequestCount() reads the active
  // AsyncLocalStorage store, so without this wrapper the appwriteRequests field
  // in the response below reports 0 on every run.
  const { result } = await withRequestMeter(() => runWithdrawalReminderSweep());
  return result;
}

async function runWithdrawalReminderSweep() {
  const now = new Date();
  const todayStartIso = getTodayStartIso(now);
  const { databases } = await createAdminClient();
  
  const todayKey = todayStartIso.slice(0, 10);
  const holidays = await import("@/lib/server/holiday-calendar").then(m => m.listHolidayDateKeys({ databases, from: todayKey, to: todayKey }));
  const isWorking = await import("@/lib/utils/holiday-calendar").then(m => m.isWorkingDateKey(todayKey, holidays));

  const allUsers = await listAllDocuments<User>({ databases, databaseId: DATABASE_ID,
    collectionId: COLLECTIONS.USERS, queries: [Query.select(['$id', 'name', 'isActive'])] });
  const activeUserIds = new Set(
    allUsers
      .filter((u) => u.isActive !== false)
      .map((u) => u.$id)
  );

  const reminderCounts = await loadNotificationCountsSince({
    databases,
    types: LINKEDIN_REMINDER_TYPES,
    sinceIso: todayStartIso,
  });

  const activeRequests = await listActiveLinkedinRequests(databases);
  const planned = planLinkedinWithdrawals(activeRequests, allUsers, now);
  const withdrawal = await applyLinkedinWithdrawals(databases, planned, now);
  const plannedIds = new Set(planned.map(entry => entry.request.$id));
  if (!isWorking) {
    const report = await sendLinkedinWithdrawalReport(databases, withdrawal.withdrawn, now)
      .catch(() => ({ emailSent: false, recipientCount: 0 }));
    return NextResponse.json({ ok: true, remindersSkipped: true, reason: "Not a working day",
      autoWithdrawn: withdrawal.withdrawn.length, withdrawalErrors: withdrawal.errors.length,
      reportEmailSent: report.emailSent, reportRecipientCount: report.recipientCount });
  }

  let evaluated = 0;
  let remindersSent = 0;
  const autoWithdrawn = withdrawal.withdrawn.length;
  
  // Track auto-withdrawals by user to send a single summary notification
  const autoWithdrawalsByUser = new Map<string, { count: number, agentId: string, teamLeadId?: string | null }>();

  for (const entry of withdrawal.withdrawn) {
    const requestDoc = entry.request;
    const agentId = requestDoc.agentId;
    if (!autoWithdrawalsByUser.has(agentId)) {
      autoWithdrawalsByUser.set(agentId, { count: 0, agentId, teamLeadId: requestDoc.teamLeadId });
    }
    autoWithdrawalsByUser.get(agentId)!.count += 1;
  }

  for (const requestDoc of activeRequests) {
    if (plannedIds.has(requestDoc.$id)) continue;
    if (requestDoc.status === 'accepted' && requestDoc.leadId) {
      continue;
    }

    evaluated += 1;
    const policy = getLinkedinReminderPolicy(requestDoc);
    if (!policy) {
      continue;
    }

    if (
      !shouldSendLinkedinWithdrawalReminder({
        request: requestDoc,
        now,
        remindersSentToday: 0,
      })
    ) {
      continue;
    }

    const dedupKey = notificationDedupKey(
      requestDoc.agentId,
      policy.type,
      requestDoc.$id,
    );
    const remindersSentToday = reminderCounts.get(dedupKey) ?? 0;

    if (
      !shouldSendLinkedinWithdrawalReminder({
        request: requestDoc,
        now,
        remindersSentToday,
      })
    ) {
      continue;
    }

    const recipients = [
      requestDoc.agentId,
      requestDoc.teamLeadId,
    ].filter(id => id && activeUserIds.has(id));

    if (recipients.length > 0) {
      await createNotificationsForRecipients(databases, recipients, {
        ...buildLinkedinWithdrawalReminder(requestDoc),
      });
    }
    
    reminderCounts.set(dedupKey, remindersSentToday + 1);
    remindersSent += 1;
  }

  // Send batch notifications for auto-withdrawals
  for (const [_, data] of autoWithdrawalsByUser) {
    const recipients = [data.agentId, data.teamLeadId].filter(id => id && activeUserIds.has(id));
    if (recipients.length > 0) {
      await createNotificationsForRecipients(
        databases,
        recipients,
        {
          type: 'linkedin_auto_withdrawn',
          title: 'Linkedin Auto-Withdrawn',
          body: `${data.count} Linkedin request(s) were auto-withdrawn due to expiration or account inactivation.`,
          targetId: null,
          targetType: null,
        }
      );
    }
  }

  const report = await sendLinkedinWithdrawalReport(databases, withdrawal.withdrawn, now)
    .catch(() => ({ emailSent: false, recipientCount: 0 }));

  return NextResponse.json({
    ok: true,
    todayStartIso,
    evaluated,
    remindersSent,
    autoWithdrawn,
    withdrawalErrors: withdrawal.errors.length,
    reportEmailSent: report.emailSent,
    reportRecipientCount: report.recipientCount,
    appwriteRequests: getRequestCount(),
  });
}
