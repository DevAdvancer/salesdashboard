import type { Databases } from 'node-appwrite';
import { Query } from 'node-appwrite';
import { COLLECTIONS, DATABASE_ID } from '@/lib/constants/appwrite';
import { listAllDocuments } from '@/lib/server/appwrite-pagination';
import { latestPaymentActivityAt } from '@/lib/utils/payment-reminder-activity';

type Row = Record<string, unknown>;
type ActivityReader = Pick<Databases, 'listDocuments'> & {
  uncachedReads?: Pick<Databases, 'listDocuments'>;
};

/** Read the same source as Payment History, in bounded batches and without a
 * settled cache, so a different server instance's follow-up is visible now. */
export async function loadPaymentReminderActivity(databases: ActivityReader, payments: Row[], now: Date) {
  const reads = databases.uncachedReads ?? databases;
  const leadIds = [...new Set(payments.map(row => row.leadId).filter((id): id is string => typeof id === 'string' && Boolean(id)))];
  const byLead = new Map<string, Row[]>();
  for (let index = 0; index < leadIds.length; index += 100) {
    const rows = await listAllDocuments<Row>({ databases: reads, databaseId: DATABASE_ID,
      collectionId: COLLECTIONS.PREVIOUS_FOLLOWUPS_PAYMENTS,
      queries: [Query.equal('leadId', leadIds.slice(index, index + 100)), Query.orderAsc('$id'),
        Query.select(['$id', 'leadId', 'createdAt', 'updatedAt', '$createdAt', '$updatedAt'])],
      requireComplete: true });
    for (const row of rows) {
      if (typeof row.leadId !== 'string') continue;
      const existing = byLead.get(row.leadId) ?? [];
      existing.push(row);
      byLead.set(row.leadId, existing);
    }
  }
  return new Map(payments.map(payment => [String(payment.$id),
    latestPaymentActivityAt(payment, byLead.get(String(payment.leadId)) ?? [], now)]));
}
