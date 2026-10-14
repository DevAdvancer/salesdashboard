import { Query } from 'node-appwrite';
import { COLLECTIONS, DATABASE_ID } from '@/lib/constants/appwrite';
import { listAllDocuments } from '@/lib/server/appwrite-pagination';
import { linkedinReportUtcBounds } from '@/lib/server/linkedin-report-requests';
import { getCurrentEasternIsoDate } from '@/lib/utils/eastern-date';
import { normalizeLeadStatus } from '@/lib/utils/lead-status-workflow';
import type { Lead, LinkedinRequest } from '@/lib/types';
import type { createAdminClient } from '@/lib/server/appwrite';

export type LinkedinReportLeadActivity = {
  leadId: string;
  request: LinkedinRequest;
  generated: boolean;
  closure: boolean;
};

const SIGNED_CLOSURE_STATUSES = new Set(['signedclosure', 'signed', 'closure', 'won']);

function requestIdFromLead(lead: Lead): string | null {
  try {
    const data = JSON.parse(lead.data) as { linkedinRequestId?: unknown };
    return typeof data.linkedinRequestId === 'string' && data.linkedinRequestId.trim()
      ? data.linkedinRequestId.trim() : null;
  } catch { return null; }
}

function inEasternRange(value: string | null | undefined, start: string, end: string) {
  if (!value) return false;
  const time = new Date(value);
  if (Number.isNaN(time.getTime())) return false;
  const date = getCurrentEasternIsoDate(time);
  return date >= start && date <= end;
}

/** Link lead activity in the selected period to its original request, even if the request is older. */
export async function listLinkedinReportLeadActivity(input: {
  databases: Awaited<ReturnType<typeof createAdminClient>>['databases'];
  startDate: string;
  endDate: string;
  teamLeadId?: string | null;
}): Promise<LinkedinReportLeadActivity[]> {
  const { start, end, startUtc, endUtcExclusive } =
    linkedinReportUtcBounds(input.startDate, input.endDate);
  const db = input.databases;
  db.clearReadCacheForCollection?.(COLLECTIONS.LEADS);
  const select = Query.select(['$id', '$createdAt', 'closedAt', 'status', 'isClosed', 'data']);
  const [created, closed] = await Promise.all([
    listAllDocuments<Lead>({ databases: db, databaseId: DATABASE_ID, collectionId: COLLECTIONS.LEADS,
      queries: [Query.greaterThanEqual('$createdAt', startUtc),
        Query.lessThan('$createdAt', endUtcExclusive), select, Query.orderAsc('$id')] }),
    listAllDocuments<Lead>({ databases: db, databaseId: DATABASE_ID, collectionId: COLLECTIONS.LEADS,
      queries: [Query.greaterThanEqual('closedAt', startUtc),
        Query.lessThan('closedAt', endUtcExclusive), select, Query.orderAsc('$id')] }),
  ]);
  const leads = [...new Map([...created, ...closed].map(lead => [lead.$id, lead])).values()];
  const relevant = leads.map(lead => ({ lead,
    generated: inEasternRange(lead.$createdAt, start, end),
    closure: lead.isClosed && SIGNED_CLOSURE_STATUSES.has(normalizeLeadStatus(lead.status)) &&
      inEasternRange(lead.closedAt, start, end),
    reverseId: requestIdFromLead(lead),
  })).filter(item => item.generated || item.closure);
  const reverseIds = [...new Set(relevant.map(item => item.reverseId).filter((id): id is string => Boolean(id)))];
  const requestById = new Map<string, LinkedinRequest>();
  const directByLeadId = new Map<string, LinkedinRequest>();
  await Promise.all([
    (async () => {
      for (let index = 0; index < reverseIds.length; index += 100) {
        const page = await db.listDocuments(DATABASE_ID, COLLECTIONS.LINKEDIN_REQUESTS,
          [Query.equal('$id', reverseIds.slice(index, index + 100)), Query.limit(100)]);
        for (const request of page.documents as unknown as LinkedinRequest[]) requestById.set(request.$id, request);
      }
    })(),
    (async () => {
      const leadIds = relevant.map(item => item.lead.$id);
      for (let index = 0; index < leadIds.length; index += 100) {
        const page = await db.listDocuments(DATABASE_ID, COLLECTIONS.LINKEDIN_REQUESTS,
          [Query.equal('leadId', leadIds.slice(index, index + 100)), Query.limit(100)]);
        for (const request of page.documents as unknown as LinkedinRequest[]) {
          if (request.leadId) directByLeadId.set(request.leadId, request);
        }
      }
    })(),
  ]);
  return relevant.flatMap(({ lead, generated, closure, reverseId }) => {
    const request = (reverseId && requestById.get(reverseId)) || directByLeadId.get(lead.$id);
    if (!request || (input.teamLeadId && input.teamLeadId !== 'all' &&
      request.teamLeadId !== input.teamLeadId)) return [];
    return [{ leadId: lead.$id, request, generated, closure }];
  });
}
