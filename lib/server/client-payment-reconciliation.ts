import { Query } from 'node-appwrite';
import { COLLECTIONS, DATABASE_ID } from '@/lib/constants/appwrite';
import { listAllDocuments } from '@/lib/server/appwrite-pagination';
import type { createAdminClient } from '@/lib/server/appwrite';
import { reconcilePaymentDocuments } from '@/lib/utils/client-payment-reconciliation';

/** Call only with documents whose read scope has already been authorized. */
export async function readReconciledPaymentDocuments<T extends { leadId?: unknown; updates?: unknown; updatesJson?: unknown }>(
  databases: Awaited<ReturnType<typeof createAdminClient>>['databases'], documents: T[],
) {
  const ids = [...new Set(documents.map(doc => doc.leadId).filter((id): id is string => typeof id === 'string' && Boolean(id)))];
  const sources: Record<string, unknown>[] = [];
  for (let index = 0; index < ids.length; index += 100) {
    sources.push(...await listAllDocuments<Record<string, unknown>>({
      databases: databases.uncachedReads ?? databases, databaseId: DATABASE_ID, collectionId: COLLECTIONS.PREVIOUS_FOLLOWUPS_PAYMENTS,
      queries: [Query.equal('leadId', ids.slice(index, index + 100))], requireComplete: true,
    }));
  }
  return reconcilePaymentDocuments(documents, sources);
}
