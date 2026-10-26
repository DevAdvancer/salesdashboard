import type { Databases } from 'node-appwrite';
import { Query } from 'node-appwrite';
import { COLLECTIONS, DATABASE_ID } from '@/lib/constants/appwrite';
import type { Lead, LinkedinRequest } from '@/lib/types';
import { listAllDocuments } from '@/lib/server/appwrite-pagination';
import { leadProfileUrl } from '@/lib/utils/linkedin-lead-protection';
import { isWithdrawnLinkedinRequest } from '@/lib/utils/linkedin-request-state';

/** Keep historical links and acceptance dates; retire only the old outreach. */
export async function withdrawLeadRequests(databases: Databases & {
  uncachedReads?: Pick<Databases, 'getDocument' | 'listDocuments'>;
}, lead: Lead, occurredAt: string, currentRequestId?: string) {
  const reads = databases.uncachedReads || databases;
  const requests = await listAllDocuments<LinkedinRequest>({ databases: reads, databaseId: DATABASE_ID,
    collectionId: COLLECTIONS.LINKEDIN_REQUESTS, queries: [Query.equal('leadId', lead.$id), Query.orderAsc('$id')],
    requireComplete: true });
  const data = JSON.parse(lead.data || '{}');
  const legacyId = typeof data.linkedinRequestId === 'string' ? data.linkedinRequestId.trim() : '';
  if (legacyId && !requests.some(request => request.$id === legacyId)) {
    try {
      const request = await reads.getDocument(DATABASE_ID, COLLECTIONS.LINKEDIN_REQUESTS, legacyId) as unknown as LinkedinRequest;
      const profile = leadProfileUrl(lead.data);
      if (typeof request.targetUrl === 'string' && (!request.leadId || request.leadId === lead.$id) &&
          (!profile || leadProfileUrl({ linkedinProfileUrl: request.targetUrl }) === profile)) requests.push(request);
    } catch (error) { if ((error as { code?: number }).code !== 404) throw error; }
  }
  const withdrawn: LinkedinRequest[] = [];
  for (const request of requests) {
    // Same-company resends reuse a row. Its earlier state is in lead_history;
    // the newly accepted request must survive restoring the lead.
    if (request.$id === currentRequestId || isWithdrawnLinkedinRequest(request)) continue;
    await databases.updateDocument(DATABASE_ID, COLLECTIONS.LINKEDIN_REQUESTS, request.$id,
      { status: 'withdrawn', isActive: false, withdrawnAt: occurredAt });
    withdrawn.push(request);
  }
  return withdrawn;
}
