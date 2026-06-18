import { Client, Account, Databases, Storage } from 'appwrite';
import { createReadThroughDatabases } from './utils/appwrite-read-cache';
export { DATABASE_ID, COLLECTIONS } from './constants/appwrite';

// Initialize Appwrite client
const client = new Client()
  .setEndpoint(process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT!)
  .setProject(process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID!);

// Export services
export const account = new Account(client);
export const databases = createReadThroughDatabases(new Databases(client));
export const storage = new Storage(client);

export { client };

/**
 * Surgical cache invalidation: drop cached reads for one collection only.
 *
 * Call this from service write paths so unrelated collections (users,
 * branches, audit logs, etc.) stay warm. The previous "clear on any write"
 * behavior caused a single mutation to evict every cached read in the
 * browser, then refetch them lazily on the next access.
 */
export function invalidateCollectionReads(collectionId: string): void {
  if (!collectionId) return;
  (databases as unknown as { clearReadCacheForCollection?: (id: string) => void })
    .clearReadCacheForCollection?.(collectionId);
}
