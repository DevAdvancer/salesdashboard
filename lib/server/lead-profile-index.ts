import { createHash } from 'node:crypto';
import { Query, type Databases, type Models } from 'node-appwrite';
import { COLLECTIONS, DATABASE_ID } from '@/lib/constants/appwrite';
import { leadProfileUrl } from '@/lib/utils/linkedin-lead-protection';
import { appwriteCacheKey } from '@/lib/server/appwrite-cache-key';
const MAX_PROFILE_CANDIDATES = 100;
const cooldowns = new Map<string, number>();
export class ProfileReadBudgetError extends Error {
  constructor() { super('Profile checking is busy. Retry in one minute or ask your administrator to refresh the profile index.'); }
}

export const LEAD_PROFILE_KEY = 'linkedinProfileKey';
export const LEAD_PROFILE_INDEX = 'linkedin_profile_key_idx';
export const LEAD_PROFILE_CHECKPOINT = 'profile-index-v1';
export function leadProfileIndexKey(data: unknown) {
  const url = leadProfileUrl(data);
  return url ? `p_${createHash('sha256').update(url).digest('hex').slice(0, 32)}` : '';
}

/** Every change since the verified checkpoint is included, even from an older
 * deployment or a native SDK writer that does not maintain the derived key. */
export async function indexedProfileCandidates(db: Pick<Databases, 'getDocument' | 'listDocuments'>, url: string): Promise<Models.Document[] | null> {
  const scope = appwriteCacheKey('profile-index-cooldown', DATABASE_ID);
  if ((cooldowns.get(scope) || 0) > Date.now()) throw new ProfileReadBudgetError();
  const boundedRead = async (collectionId: string, queries: string[]) => {
    // One overflow row detects a query that is too broad without retrieving its
    // entire result set. A partial result must NEVER authorize a duplicate save.
    const response = await db.listDocuments(DATABASE_ID, collectionId, [...queries, Query.limit(MAX_PROFILE_CANDIDATES + 1)]);
    if (response.documents.length > MAX_PROFILE_CANDIDATES || response.total > MAX_PROFILE_CANDIDATES)
      throw new ProfileReadBudgetError();
    return response.documents;
  };
  let checkpoint;
  try { checkpoint = await db.getDocument(DATABASE_ID, COLLECTIONS.LINKEDIN_LEAD_REGISTRY, LEAD_PROFILE_CHECKPOINT); }
  catch (error) { if ((error as { code?: number }).code === 404) return null; throw error; }
  if (checkpoint.kind !== LEAD_PROFILE_CHECKPOINT || checkpoint.leadId !== 'ready' ||
      typeof checkpoint.profileUrl !== 'string' || !Number.isFinite(Date.parse(checkpoint.profileUrl)) ||
      Date.parse(checkpoint.profileUrl) > Date.now()) return null;
  try {
    const entries = await boundedRead(COLLECTIONS.LINKEDIN_LEAD_REGISTRY,
      [Query.equal(LEAD_PROFILE_KEY, leadProfileIndexKey({ linkedinProfileUrl: url })),
        Query.equal('kind', 'lead-index'), Query.select(['leadId']), Query.orderAsc('$id')]);
    const ids = [...new Set(entries.map(entry => String(entry.leadId)))];
    const result = new Map<string, Models.Document>();
    for (let offset = 0; offset < Math.max(1, ids.length); offset += 100) {
      const clauses = [...(offset === 0 ? [Query.greaterThanEqual('$updatedAt', checkpoint.profileUrl)] : []),
        ...(ids.length ? [Query.equal('$id', ids.slice(offset, offset + 100))] : [])];
      const rows = await boundedRead(COLLECTIONS.LEADS,
        [clauses.length === 1 ? clauses[0]! : Query.or(clauses), Query.orderAsc('$id'),
          Query.select(['$id', 'data', 'status', 'ownerId', 'assignedToId', '$updatedAt'])]);
      for (const row of rows) result.set(row.$id, row);
    }
    return [...result.values()];
  } catch (error) {
    if (error instanceof ProfileReadBudgetError) {
      if (cooldowns.size >= 8) cooldowns.delete(cooldowns.keys().next().value!);
      cooldowns.set(scope, Date.now() + 60_000);
      throw error;
    }
    // Missing/in-progress indexes on an older installation use strict fallback.
    if ((error as { code?: number }).code === 400) return null;
    throw error;
  }
}
