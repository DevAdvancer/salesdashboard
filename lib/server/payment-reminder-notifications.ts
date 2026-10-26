import type { Databases } from 'node-appwrite';
import { Query } from 'node-appwrite';
import { COLLECTIONS, DATABASE_ID } from '@/lib/constants/appwrite';
import { listAllDocuments } from '@/lib/server/appwrite-pagination';
import { loadPaymentReminderActivity } from '@/lib/server/payment-reminder-activity';
import { activityTimestamp } from '@/lib/utils/payment-reminder-activity';
import type { NotificationRecord } from '@/lib/types';

const REMINDER_TYPES = ['CLIENT_PAYMENT_STALE', 'CLIENT_PAYMENT_PARTIAL_PAID_STALE'];
type Reader = Pick<Databases, 'listDocuments'> & { uncachedReads?: Pick<Databases, 'listDocuments'> };

/** Hide answered or incorrectly generated alerts without deleting stored notices.
 * The caller supplies only the authenticated recipient's notification list. */
export async function filterResolvedPaymentReminders(databases: Reader, notifications: NotificationRecord[], now = new Date()) {
  const leadIds = [...new Set(notifications.filter(row => REMINDER_TYPES.includes(row.type))
    .map(row => row.targetId).filter((id): id is string => typeof id === 'string' && Boolean(id)))];
  if (!leadIds.length) return notifications;
  const reads = databases.uncachedReads ?? databases;
  const latestByLead = new Map<string, Record<string, unknown>>();
  for (let index = 0; index < leadIds.length; index += 100) {
    const rows = await listAllDocuments<Record<string, unknown>>({ databases: reads,
      databaseId: DATABASE_ID, collectionId: COLLECTIONS.CLIENT_PAYMENTS,
      queries: [Query.equal('leadId', leadIds.slice(index, index + 100)), Query.orderAsc('$id')], requireComplete: true });
    for (const row of rows) {
      if (typeof row.leadId !== 'string') continue;
      const previous = latestByLead.get(row.leadId);
      if (!previous || (activityTimestamp(row.createdAt) ?? 0) > (activityTimestamp(previous.createdAt) ?? 0)) {
        latestByLead.set(row.leadId, row);
      }
    }
  }
  const activity = await loadPaymentReminderActivity(databases, [...latestByLead.values()], now);
  return notifications.filter(notification => {
    if (!REMINDER_TYPES.includes(notification.type)) return true;
    const payment = latestByLead.get(notification.targetId ?? '');
    if (!payment) return true;
    if (['fully_paid', 'refunded', 'non_upfront'].includes(String(payment.status))) return false;
    const lastActivity = activityTimestamp(activity.get(String(payment.$id)));
    const notifiedAt = activityTimestamp(notification.createdAt);
    if (lastActivity === null || notifiedAt === null) return true;
    const days = notification.type === 'CLIENT_PAYMENT_STALE'
      ? Number(process.env.PAYMENT_REMINDER_STALE_DAYS ?? '30')
      : Number(process.env.PARTIAL_PAID_STALE_DAYS ?? '2');
    return notifiedAt - lastActivity >= days * 24 * 60 * 60 * 1000;
  });
}
