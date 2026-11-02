import { Query, type Models, type Databases } from 'node-appwrite';
import { createAdminClient } from '@/lib/server/appwrite';
import { COLLECTIONS, DATABASE_ID } from '@/lib/constants/appwrite';
import { canShareProgress, isProgressEligible, PROGRESS_PAGE_SIZE, type ProgressEntry, type ProgressEvent } from '@/lib/client-progress';
import { closedClient } from '@/lib/server/client-progress-sync';
import { cardTokenSchema, clientCardSubject, matchesCardToken, encodeCardCursor, decodeCardCursor, publicClientCard } from '@/lib/server/client-card-security';
import type { SharedCardPage } from '@/lib/client-progress-share';

export type StoredCardShare = Models.Document & { entryId: string; tokenHash: string; subjectHash: string; issuerId: string;
  expiresAt: string; revoked: boolean; includeContact: boolean; includeNotes: boolean };
export async function eligibleCardLead(db: Pick<Databases, 'getDocument'>, entry: ProgressEntry) {
  if (!entry.leadId) return null;
  const lead = await db.getDocument(DATABASE_ID, COLLECTIONS.LEADS, entry.leadId,
    [Query.select(['$id', 'isClosed', 'status', 'ownerId', 'assignedToId', 'closedAt'])]);
  if (!closedClient(lead) || (!entry.assignmentOverride && (lead.assignedToId || lead.ownerId) !== entry.salespersonId)) throw new Error('Card unavailable.');
  return lead;
}
/** Only the possession-based, explicitly approved card grant is honored here. No CRM session is created. */
export async function readPublicClientCard(input: { token: string; cursor?: string }): Promise<SharedCardPage> {
  const token = cardTokenSchema.parse(input.token);
  const cursorId = input.cursor ? decodeCardCursor(token, input.cursor) : null;
  const id = token.split('.')[0];
  const { databases } = await createAdminClient();
  const db = databases.uncachedReads;
  const share = await db.getDocument<StoredCardShare>(DATABASE_ID, COLLECTIONS.CLIENT_PROGRESS_SHARES, id);
  if (share.revoked || !matchesCardToken(token, share.tokenHash) || !Number.isFinite(Date.parse(share.expiresAt)) || Date.parse(share.expiresAt) <= Date.now()) throw new Error('Card unavailable.');
  const [entry, issuer] = await Promise.all([
    db.getDocument<Models.Document & ProgressEntry>(DATABASE_ID, COLLECTIONS.CLIENT_PROGRESS, share.entryId),
    db.getDocument(DATABASE_ID, COLLECTIONS.USERS, share.issuerId, [Query.select(['$id', 'role', 'isActive'])]),
  ]);
  if (!canShareProgress(issuer as unknown as Parameters<typeof canShareProgress>[0]) || !entry.eligible || !isProgressEligible(entry.progressStatus)) throw new Error('Card unavailable.');
  const lead = await eligibleCardLead(db, entry);
  if (clientCardSubject(entry, lead) !== share.subjectHash) throw new Error('Card unavailable.');
  const queries = [Query.equal('entryId', entry.$id), Query.equal('kind', 'feedback'), Query.orderAsc('$createdAt'), Query.orderAsc('$id'),
    Query.limit(PROGRESS_PAGE_SIZE), Query.select(['$id', '$createdAt', 'text', 'authorName'])];
  // The cursor is encrypted, authenticated and bound to this exact token. It cannot select another client's events.
  if (cursorId) queries.push(Query.cursorAfter(cursorId));
  const page = await db.listDocuments<Models.Document & ProgressEvent>(DATABASE_ID, COLLECTIONS.CLIENT_PROGRESS_EVENTS, queries);
  return { card: publicClientCard(entry, share), feedback: page.documents.map(row => ({ text: row.text, authorName: row.authorName, createdAt: row.$createdAt })),
    nextCursor: page.documents.length === PROGRESS_PAGE_SIZE ? encodeCardCursor(token, page.documents.at(-1)!.$id) : null, expiresAt: share.expiresAt };
}
