import { NextResponse, type NextRequest } from 'next/server';
import { ID, Query } from 'node-appwrite';
import { COLLECTIONS, DATABASE_ID } from '@/lib/constants/appwrite';
import { createAdminClient } from '@/lib/server/appwrite';
import { createNotificationsForRecipients } from '@/lib/server/notifications';
import type { LinkedinRequest, User } from '@/lib/types';
import {
  buildLinkedinWithdrawalReminder,
  getLinkedinReminderPolicy,
  shouldAutoWithdrawLinkedinRequest,
  shouldSendLinkedinWithdrawalReminder,
} from '@/lib/utils/linkedin-withdrawal-reminders';

function getAuthorizationToken(request: NextRequest) {
  const header = request.headers.get('authorization');
  if (!header) return null;
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || null;
}

function isAuthorized(request: NextRequest) {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  const provided = getAuthorizationToken(request) ?? request.headers.get('x-cron-secret');
  return Boolean(provided) && provided === expected;
}

function getTodayStartIso(now: Date) {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0),
  ).toISOString();
}

async function getReminderCountToday(
  databases: Awaited<ReturnType<typeof createAdminClient>>['databases'],
  request: LinkedinRequest,
  todayStartIso: string,
) {
  const policy = getLinkedinReminderPolicy(request);
  if (!policy) return 0;

  const response = await databases.listDocuments(
    DATABASE_ID,
    COLLECTIONS.NOTIFICATIONS,
    [
      Query.equal('recipientId', request.agentId),
      Query.equal('type', policy.type),
      Query.equal('targetId', request.$id),
      Query.greaterThanEqual('createdAt', todayStartIso),
      Query.limit(100),
    ],
  );

  return response.total ?? response.documents.length;
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
) {
  const isAcceptedWithoutLead =
    request.status === 'accepted' && !request.leadId;
  const reason = isAcceptedWithoutLead
    ? 'No lead was created within 12 days after connection acceptance.'
    : 'Connection was not withdrawn within 20 days after sending.';

  await databases.updateDocument(DATABASE_ID, COLLECTIONS.LINKEDIN_REQUESTS, request.$id, {
    status: 'withdrawn',
    isActive: false,
    withdrawnAt: nowIso,
  });

  await databases.createDocument(DATABASE_ID, COLLECTIONS.AUDIT_LOGS, ID.unique(), {
    action: 'LINKEDIN_REQUEST_AUTO_WITHDRAW',
    actorId: 'system',
    actorName: 'System',
    targetId: request.$id,
    targetType: 'linkedin_request',
    metadata: JSON.stringify({
      company: request.company,
      targetUrl: request.targetUrl,
      reason,
      withdrawnAt: nowIso,
    }),
    performedAt: nowIso,
  });

  await createGeneralChatMessage(
    databases,
    `Linkedin URL available again: ${request.targetUrl} (${request.company}) was auto-withdrawn. Reason: ${reason}`,
  );
}

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const now = new Date();
  const nowIso = now.toISOString();
  const todayStartIso = getTodayStartIso(now);
  const { databases } = await createAdminClient();
  const adminRecipientIds = await getAdminRecipientIds(databases);

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
      await autoWithdrawLinkedinRequest(databases, requestDoc, nowIso);
      autoWithdrawn += 1;
      continue;
    }

    const remindersSentToday = await getReminderCountToday(databases, requestDoc, todayStartIso);

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
    remindersSent += 1;
  }

  return NextResponse.json({
    ok: true,
    todayStartIso,
    evaluated,
    remindersSent,
    autoWithdrawn,
  });
}
