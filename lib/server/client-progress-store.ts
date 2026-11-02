import { createHash } from 'node:crypto';
import { type Databases, ID, type Models } from 'node-appwrite';
import { COLLECTIONS, DATABASE_ID } from '@/lib/constants/appwrite';
import type { ProgressEntry } from '@/lib/client-progress';

export type StoredProgress = Models.Document & ProgressEntry;
export async function withProgressLock<T>(db: Databases, entryId: string, operation: () => Promise<T>): Promise<T> {
  const lockId = `lock_${createHash('sha256').update(entryId).digest('hex').slice(0, 30)}`;
  await db.createDocument(DATABASE_ID, COLLECTIONS.CLIENT_PROGRESS_EVENTS, lockId, {
    entryId, kind: 'lock', text: '', authorId: 'system', authorName: 'System',
  }, []).catch(error => {
    if ((error as { code?: number }).code === 409) throw new Error('This entry is being saved. Please retry shortly.');
    throw error;
  });
  try { return await operation(); }
  finally { await db.deleteDocument(DATABASE_ID, COLLECTIONS.CLIENT_PROGRESS_EVENTS, lockId); }
}
export async function progressAudit(db: Databases, entryId: string, actor: { $id: string; name: string }, action: string, changes: unknown) {
  const text = JSON.stringify({ action, changes }, (_key, value) => typeof value === 'string' && value.length > 1000
    ? { preview: value.slice(0, 1000), length: value.length, sha256: createHash('sha256').update(value).digest('hex') } : value);
  return db.createDocument(DATABASE_ID, COLLECTIONS.CLIENT_PROGRESS_EVENTS, ID.unique(), {
    entryId, kind: 'audit', text, authorId: actor.$id, authorName: actor.name,
  }, []);
}
