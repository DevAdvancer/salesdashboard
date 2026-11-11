import { Query } from 'node-appwrite';
import type { createAdminClient } from '@/lib/server/appwrite';
import { listAllDocuments } from '@/lib/server/appwrite-pagination';
import { COLLECTIONS, DATABASE_ID } from '@/lib/constants/appwrite';
import type { LinkedinRequest } from '@/lib/types';

export async function listDeactivationLinkedinRequests(
  databases: Awaited<ReturnType<typeof createAdminClient>>['databases'], agentIds: string | string[], accountIds: string[],
) {
  const requests = new Map<string, LinkedinRequest>();
  // Keep account arrays within Appwrite query limits, without truncating assigned accounts.
  for (let start = 0; start < Math.max(1, accountIds.length); start += 90) {
    const accounts = accountIds.slice(start, start + 90);
    const agent = Query.equal('agentId', agentIds);
    const rows = await listAllDocuments<LinkedinRequest>({ databases: databases.uncachedReads, databaseId: DATABASE_ID,
      collectionId: COLLECTIONS.LINKEDIN_REQUESTS, requireComplete: true,
      queries: [Query.equal('isActive', true), Query.equal('status', ['sent', 'accepted']),
        accounts.length ? Query.or([agent, Query.equal('accountId', accounts)]) : agent],
    });
    for (const row of rows) requests.set(row.$id, row);
  }
  return [...requests.values()];
}
