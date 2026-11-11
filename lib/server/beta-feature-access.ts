import { createHash } from 'node:crypto';
import { Query } from 'node-appwrite';
import { COLLECTIONS, DATABASE_ID } from '@/lib/constants/appwrite';
import { createAdminClient } from '@/lib/server/appwrite';
import { listAllDocuments } from '@/lib/server/appwrite-pagination';

export const LINKEDIN_HELPER_FEATURE = 'linkedin-helper';
export const LINKEDIN_CONVERSATIONS_FEATURE = 'linkedin-conversations';
type Databases = Awaited<ReturnType<typeof createAdminClient>>['databases'];
type AccessRecord = { userId: string; feature: string; enabled: boolean };

export function betaAccessDocumentId(userId: string, feature = LINKEDIN_HELPER_FEATURE) {
  return `beta_${createHash('sha256').update(`${feature}:${userId}`).digest('hex').slice(0, 30)}`;
}

export async function hasLinkedinHelperAccess(databases: Databases, userId: string): Promise<boolean> {
  return hasBetaFeatureAccess(databases, userId, LINKEDIN_HELPER_FEATURE);
}

export async function hasBetaFeatureAccess(databases: Databases, userId: string, feature: string): Promise<boolean> {
  databases.clearReadCacheForCollection(COLLECTIONS.BETA_FEATURE_ACCESS);
  try {
    const record = await databases.getDocument(DATABASE_ID, COLLECTIONS.BETA_FEATURE_ACCESS, betaAccessDocumentId(userId, feature));
    return record.feature === feature && record.userId === userId && record.enabled === true;
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 404) return false;
    throw error;
  }
}

export async function listLinkedinHelperAccess(databases: Databases): Promise<Set<string>> {
  return listBetaFeatureAccess(databases, LINKEDIN_HELPER_FEATURE);
}

export async function listBetaFeatureAccess(databases: Databases, feature: string): Promise<Set<string>> {
  databases.clearReadCacheForCollection(COLLECTIONS.BETA_FEATURE_ACCESS);
  const records = await listAllDocuments<AccessRecord>({ databases, databaseId: DATABASE_ID,
    collectionId: COLLECTIONS.BETA_FEATURE_ACCESS,
    queries: [Query.equal('feature', feature), Query.select(['userId', 'enabled'])] });
  return new Set(records.filter(record => record.enabled).map(record => record.userId));
}
