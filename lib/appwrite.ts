import { Client, Account, Databases, Storage } from 'appwrite';
import { createReadThroughDatabases } from './utils/appwrite-read-cache';
import { subscribeCrmChanges } from './utils/crm-realtime-client';
export { DATABASE_ID, COLLECTIONS } from './constants/appwrite';

// Initialize Appwrite client
const client = new Client()
  .setEndpoint(process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT!)
  .setProject(process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID!);

// Export services
export const account = new Account(client);
// Authentication stays with Appwrite. CRM data and files always pass the OTP/attendance boundary.
const dataClient = new Client().setEndpoint(`${typeof window === 'undefined' ? 'http://localhost:5000' : window.location.origin}/api/appwrite`)
  .setProject(process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID!);
Client.CHUNK_SIZE = 2 * 1024 * 1024; // Fits Vercel's request limit, including multipart overhead.
export const databases = createReadThroughDatabases(new Databases(dataClient));
export const storage = new Storage(dataClient);
client.subscribe = subscribeCrmChanges as typeof client.subscribe;

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
