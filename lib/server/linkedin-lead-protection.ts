import { createHash } from 'node:crypto';
import type { Databases, Models } from 'node-appwrite';
import { Query } from 'node-appwrite';
import { COLLECTIONS, DATABASE_ID } from '@/lib/constants/appwrite';
import { listAllDocuments } from '@/lib/server/appwrite-pagination';
import { leadProfileUrl, isLeadReleased } from '@/lib/utils/linkedin-lead-protection';
import type { LinkedinRequest } from '@/lib/types';
import { isWithdrawnLinkedinRequest } from '@/lib/utils/linkedin-request-state';
import { createBriefReadCache } from '@/lib/utils/brief-read-cache';

// Only UI previews share scans. Every mutation still performs a fresh lookup
// under the distributed profile lock, including when a preview reported no match.
const previewScans = createBriefReadCache<Models.Document[]>(60_000, 2);
export function invalidateLinkedinLeadPreviews() { previewScans.clear(); }
type LookupOptions = { preview?: boolean };

type Database = Pick<Databases, 'getDocument' | 'listDocuments' | 'createDocument' | 'updateDocument' | 'deleteDocument'> & {
  clearReadCacheForCollection?: (collectionId: string) => void;
};
export const profileDocumentId = (url: string, kind: 'profile' | 'lock' = 'profile') =>
  `${kind === 'profile' ? 'p' : 'l'}_${createHash('sha256').update(url).digest('hex').slice(0, 32)}`;
export const isNotFound = (error: unknown) => (error as { code?: number })?.code === 404;
export class LinkedinLeadProtectionError extends Error {}

export async function findLeadsForLinkedinProfile(databases: Database, targetUrl: string, options: LookupOptions = {}): Promise<Models.Document[]> {
  const url = leadProfileUrl({ linkedinProfileUrl: targetUrl });
  if (!url) throw new Error('Enter a valid public LinkedIn profile URL.');
  databases.clearReadCacheForCollection?.(COLLECTIONS.LINKEDIN_LEAD_REGISTRY);
  try {
    const entry = await databases.getDocument(DATABASE_ID, COLLECTIONS.LINKEDIN_LEAD_REGISTRY, profileDocumentId(url));
    if (entry?.leadId) {
      try {
        databases.clearReadCacheForCollection?.(COLLECTIONS.LEADS);
        const lead = await databases.getDocument(DATABASE_ID, COLLECTIONS.LEADS, entry.leadId);
        if (leadProfileUrl(lead.data) === url) return [lead];
      } catch (error) { if (!isNotFound(error)) throw error; }
    }
  } catch (error) { if (!isNotFound(error)) throw error; }
  // No age, branch, owner, company, or 1,000-record cutoff. Unknown profiles fail closed on scan errors.
  const scan = () => {
    // Do not inherit the SDK wrapper's two-hour cache when the preview expires.
    databases.clearReadCacheForCollection?.(COLLECTIONS.LEADS);
    return listAllDocuments<Models.Document>({ databases, databaseId: DATABASE_ID,
    collectionId: COLLECTIONS.LEADS, queries: [Query.orderAsc('$id'),
      Query.select(['$id', 'data', 'status', 'ownerId', 'assignedToId', '$updatedAt'])],
    pageLimit: 5000, maxPages: 1000, maxDocuments: 100000, requireComplete: true });
  };
  const key = createHash('sha256').update(JSON.stringify([process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT,
    process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID, process.env.APPWRITE_API_KEY, DATABASE_ID, COLLECTIONS.LEADS])).digest('hex');
  const leads = await (options.preview ? previewScans.read(key, scan) : scan());
  if (leads.length >= 100000) throw new Error('The lead profile scan is incomplete. Ask an admin to review it.');
  return leads.filter(lead => leadProfileUrl(lead.data) === url);
}

export async function findProtectedLinkedinLead(databases: Database, targetUrl: string, excludeLeadId?: string, options: LookupOptions = {}) {
  return (await findLeadsForLinkedinProfile(databases, targetUrl, options))
    .find(lead => lead.$id !== excludeLeadId && !isLeadReleased(lead.status)) ?? null;
}

export async function assertLinkedinProfileAvailable(databases: Database, targetUrl: string) {
  if (await findProtectedLinkedinLead(databases, targetUrl)) {
    throw new LinkedinLeadProtectionError('A lead already exists for this LinkedIn profile. It can only be reused after the lead is marked Not Interested or Backed Out.');
  }
}

export async function requestBlocksLinkedinProfile(databases: Database, request: LinkedinRequest) {
  if (isWithdrawnLinkedinRequest(request)) return false;
  if (request.leadId) {
    databases.clearReadCacheForCollection?.(COLLECTIONS.LEADS);
    const lead = await databases.getDocument(DATABASE_ID, COLLECTIONS.LEADS, request.leadId);
    if (isLeadReleased(lead.status)) return false;
  }
  return true;
}

/** Distributed lock: a crashed operation remains blocked for administrator recovery, never silently stolen. */
export async function withLinkedinProfileLock<T>(databases: Database, url: string, leadId: string, operation: () => Promise<T>) {
  const id = profileDocumentId(url, 'lock');
  await databases.createDocument(DATABASE_ID, COLLECTIONS.LINKEDIN_LEAD_REGISTRY, id,
    { kind: 'lock', profileUrl: url, leadId }, []).catch(error => {
      if ((error as { code?: number }).code === 409) throw new Error('This LinkedIn profile is being updated. Retry after the current operation completes.');
      throw error;
    });
  try { return await operation(); }
  finally { await databases.deleteDocument(DATABASE_ID, COLLECTIONS.LINKEDIN_LEAD_REGISTRY, id); }
}

export async function saveLeadProfileRegistry(databases: Database, lead: Models.Document) {
  const profileUrl = leadProfileUrl(lead.data);
  if (!profileUrl) return;
  const id = profileDocumentId(profileUrl);
  const data = { kind: 'profile', profileUrl, leadId: lead.$id };
  try { await databases.createDocument(DATABASE_ID, COLLECTIONS.LINKEDIN_LEAD_REGISTRY, id, data, []); }
  catch (error) {
    if ((error as { code?: number }).code !== 409) throw error;
    await databases.updateDocument(DATABASE_ID, COLLECTIONS.LINKEDIN_LEAD_REGISTRY, id, data);
  }
}
