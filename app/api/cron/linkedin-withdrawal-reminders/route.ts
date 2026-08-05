import { NextResponse, type NextRequest } from 'next/server';
import { ID, Query } from 'node-appwrite';
import { COLLECTIONS, DATABASE_ID } from '@/lib/constants/appwrite';
import { createAdminClient } from '@/lib/server/appwrite';
import { getRequestCount, withRequestMeter } from '@/lib/server/appwrite-request-meter';
import {
  loadNotificationCountsSince,
  notificationDedupKey,
} from '@/lib/server/notification-dedup';
import { createNotificationsForRecipients } from '@/lib/server/notifications';
import type { LinkedinRequest, User } from '@/lib/types';
import {
  buildLinkedinWithdrawalReminder,
  getLinkedinReminderPolicy,
  shouldAutoWithdrawLinkedinRequest,
  shouldSendLinkedinWithdrawalReminder,
  LINKEDIN_ACCEPTED_AUTO_WITHDRAW_DAYS,
  LINKEDIN_ACCEPTED_WITHDRAWAL_REMINDER_TYPE,
  LINKEDIN_SENT_AUTO_WITHDRAW_DAYS,
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

async function getAdminRecipientIds(
  databases: Awaited<ReturnType<typeof createAdminClient>>['databases'],
) {
  const response = await databases.listDocuments(DATABASE_ID, COLLECTIONS.USERS, [
    Query.equal('role', 'admin'),
    Query.limit(500),
  ]);

  return (response.documents as unknown as User[])
    .filter((user) => (user as unknown as { isActive?: unknown }).isActive !== false)
    .map((user) => user.$id);
}

async function createGeneralChatMessage(
  databases: Awaited<ReturnType<typeof createAdminClient>>['databases'],
  body: string,
) {
  await databases.createDocument(DATABASE_ID, COLLECTIONS.CHAT_MESSAGES, ID.unique(), {
    channel: 'general',
    body,
    createdById: 'system',
    createdByName: 'System',
    createdAt: new Date().toISOString(),
  });
}

async function autoWithdrawLinkedinRequest(
  databases: Awaited<ReturnType<typeof createAdminClient>>['databases'],
  request: LinkedinRequest,
  nowIso: string,
  adminRecipientIds: string[],
) {
  const isAcceptedWithoutLead =
    request.status === 'accepted' && !request.leadId;
  const reason = isAcceptedWithoutLead
    ? `No lead was created within ${LINKEDIN_ACCEPTED_AUTO_WITHDRAW_DAYS} days after connection acceptance.`
    : `Connection was not withdrawn within ${LINKEDIN_SENT_AUTO_WITHDRAW_DAYS} days after sending.`;

  await databases.updateDocument(DATABASE_ID, COLLECTIONS.LINKEDIN_REQUESTS, request.$id, {
    status: 'withdrawn',
    isActive: false,
    withdrawnAt: nowIso,
  });


  await createGeneralChatMessage(
    databases,
    `Linkedin URL available again: ${request.targetUrl} (${request.company}) was auto-withdrawn. Reason: ${reason}`,
  );

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
  const nowIso = now.toISOString();
  const todayStartIso = getTodayStartIso(now);
  const { databases } = await createAdminClient();
  const adminRecipientIds = await getAdminRecipientIds(databases);

  // One sweep of today's reminder notifications replaces a per-request count
  // query, so the cost is bounded by notifications created today rather than by
  // the number of active Linkedin requests.
  const reminderCounts = await loadNotificationCountsSince({
    databases,
    types: LINKEDIN_REMINDER_TYPES,
    sinceIso: todayStartIso,
  });

  const response = await databases.listDocuments(
    DATABASE_ID,
    COLLECTIONS.LINKEDIN_REQUESTS,
    [
      Query.equal('isActive', true),
      Query.equal('status', ['sent', 'accepted']),
      Query.limit(5000),
    ],
  );

  let evaluated = 0;
  let remindersSent = 0;
  let autoWithdrawn = 0;

  for (const requestDoc of response.documents as unknown as LinkedinRequest[]) {
    if (requestDoc.status === 'accepted' && requestDoc.leadId) {
      continue;
    }

    evaluated += 1;
    if (shouldAutoWithdrawLinkedinRequest({ request: requestDoc, now })) {
      await autoWithdrawLinkedinRequest(databases, requestDoc, nowIso, adminRecipientIds);
      autoWithdrawn += 1;
      continue;
    }

    const policy = getLinkedinReminderPolicy(requestDoc);
    if (!policy) {
      continue;
    }

    // The age/due window does not depend on how many reminders already went
    // out today, so test it first and skip the dedup lookup for rows that are
    // not due at all.
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

    await createNotificationsForRecipients(databases, [
      requestDoc.agentId,
      requestDoc.teamLeadId,
      ...adminRecipientIds,
    ], {
      ...buildLinkedinWithdrawalReminder(requestDoc),
    });
    // Keep the in-memory tally current so the per-day maximum still holds if
    // this cron is ever moved to a schedule that runs more than once a day.
    reminderCounts.set(dedupKey, remindersSentToday + 1);
    remindersSent += 1;
  }

  return NextResponse.json({
    ok: true,
    todayStartIso,
    evaluated,
    remindersSent,
    autoWithdrawn,
    // Counted only when the caller opened a meter scope; 0 otherwise.
    appwriteRequests: getRequestCount(),
  });
}
