import { NextResponse, type NextRequest } from 'next/server';
import { Query } from 'node-appwrite';
import { COLLECTIONS, DATABASE_ID } from '@/lib/constants/appwrite';
import { createAdminClient } from '@/lib/server/appwrite';
import { createNotificationRecord } from '@/lib/server/notifications';
import type { LinkedinRequest } from '@/lib/types';
import {
  buildLinkedinWithdrawalReminder,
  LINKEDIN_WITHDRAWAL_REMINDER_DAYS,
  LINKEDIN_WITHDRAWAL_REMINDER_INTERVAL_MS,
  LINKEDIN_WITHDRAWAL_REMINDER_TYPE,
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

async function getLastReminderCreatedAt(
  databases: Awaited<ReturnType<typeof createAdminClient>>['databases'],
  request: LinkedinRequest,
  recentThresholdIso: string,
) {
  const response = await databases.listDocuments(
    DATABASE_ID,
    COLLECTIONS.NOTIFICATIONS,
    [
      Query.equal('recipientId', request.agentId),
      Query.equal('type', LINKEDIN_WITHDRAWAL_REMINDER_TYPE),
      Query.equal('targetId', request.$id),
      Query.greaterThanEqual('createdAt', recentThresholdIso),
      Query.orderDesc('createdAt'),
      Query.limit(1),
    ],
  );

  const latest = response.documents[0] as { createdAt?: unknown } | undefined;
  return typeof latest?.createdAt === 'string' ? latest.createdAt : null;
}

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const now = new Date();
  const dueThresholdIso = new Date(
    now.getTime() - LINKEDIN_WITHDRAWAL_REMINDER_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();
  const recentThresholdIso = new Date(
    now.getTime() - LINKEDIN_WITHDRAWAL_REMINDER_INTERVAL_MS,
  ).toISOString();
  const { databases } = await createAdminClient();

  const response = await databases.listDocuments(
    DATABASE_ID,
    COLLECTIONS.LINKEDIN_REQUESTS,
    [
      Query.equal('status', 'sent'),
      Query.equal('isActive', true),
      Query.lessThanEqual('dateSent', dueThresholdIso),
      Query.limit(5000),
    ],
  );

  let evaluated = 0;
  let remindersSent = 0;

  for (const requestDoc of response.documents as unknown as LinkedinRequest[]) {
    evaluated += 1;
    const lastReminderCreatedAt = await getLastReminderCreatedAt(
      databases,
      requestDoc,
      recentThresholdIso,
    );

    if (
      !shouldSendLinkedinWithdrawalReminder({
        request: requestDoc,
        now,
        lastReminderCreatedAt,
      })
    ) {
      continue;
    }

    await createNotificationRecord(databases, {
      recipientId: requestDoc.agentId,
      ...buildLinkedinWithdrawalReminder(requestDoc),
    });
    remindersSent += 1;
  }

  return NextResponse.json({
    ok: true,
    dueThresholdIso,
    evaluated,
    remindersSent,
  });
}
