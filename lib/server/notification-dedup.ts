import { Query } from 'node-appwrite';
import { COLLECTIONS, DATABASE_ID } from '@/lib/constants/appwrite';
import { listAllDocuments } from '@/lib/server/appwrite-pagination';

interface NotificationDedupDoc {
  $id?: unknown;
  recipientId?: unknown;
  type?: unknown;
  targetId?: unknown;
}

/**
 * Key layout shared by every caller of loadNotificationCountsSince so a lookup
 * built here can be probed with the same string a cron builds per recipient.
 */
export function notificationDedupKey(
  recipientId: string,
  type: string,
  targetId: string
) {
  return `${recipientId}|${type}|${targetId}`;
}

/**
 * Build a "who already got which notification since <sinceIso>" index in one
 * paged scan.
 *
 * Crons used to answer that question with a listDocuments call per (recipient,
 * target) pair, so a fan-out to every admin cost recipients x rows reads per
 * run just to decide what NOT to send. One scan of the notifications created
 * today is bounded by the number of notifications, not by the fan-out.
 */
export async function loadNotificationCountsSince(input: {
  databases: any;
  types: string[];
  sinceIso: string;
}): Promise<Map<string, number>> {
  const counts = new Map<string, number>();

  const types = Array.from(
    new Set(input.types.filter((type): type is string => Boolean(type)))
  );
  if (types.length === 0) return counts;

  const documents = await listAllDocuments<NotificationDedupDoc>({
    databases: input.databases,
    databaseId: DATABASE_ID,
    collectionId: COLLECTIONS.NOTIFICATIONS,
    queries: [
      Query.equal('type', types),
      // `createdAt` is the collection's own datetime attribute (see
      // scripts/lib/schema-definitions.ts); it is what notifications.ts writes.
      Query.greaterThanEqual('createdAt', input.sinceIso),
      // Only the three dedup fields are read, but `$id` has to stay in the
      // projection because listAllDocuments pages with Query.cursorAfter($id).
      Query.select(['$id', 'recipientId', 'type', 'targetId']),
    ],
    // Explicit bounds. listAllDocuments silently returns a PARTIAL array when
    // maxPages is exhausted, and a partial sweep here means a missed suppression
    // (a duplicate reminder), not just a slow run. The window is one day of a
    // single notification type, so 20 pages is far above the real volume while
    // still bounding a runaway.
    pageLimit: 100,
    maxPages: 20,
  });

  for (const doc of documents) {
    const recipientId =
      typeof doc.recipientId === 'string' ? doc.recipientId : '';
    const type = typeof doc.type === 'string' ? doc.type : '';
    const targetId = typeof doc.targetId === 'string' ? doc.targetId : '';
    if (!recipientId || !type || !targetId) continue;

    const key = notificationDedupKey(recipientId, type, targetId);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  return counts;
}
