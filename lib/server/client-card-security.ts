import { createHash, randomBytes, timingSafeEqual, createHmac, createCipheriv, createDecipheriv } from 'node:crypto';
import { z } from 'zod';
import type { ProgressEntry } from '@/lib/client-progress';
import { normalizeProgressStatus } from '@/lib/client-progress';
import type { SharedClientCard } from '@/lib/client-progress-share';

export const cardTokenSchema = z.string().regex(/^s_[0-9a-f]{32}\.[A-Za-z0-9_-]{43}$/);
export const cardRequestSchema = z.object({ token: cardTokenSchema, cursor: z.string().regex(/^[A-Za-z0-9_-]{1,400}$/).optional() }).strict();
export function clientCardShareId(entryId: string) { return `s_${createHash('sha256').update(`client-card:${entryId}`).digest('hex').slice(0, 32)}`; }
export function hashCardToken(token: string) { return createHash('sha256').update(token).digest('hex'); }
export function newCardToken(entryId: string) { const id = clientCardShareId(entryId); const token = `${id}.${randomBytes(32).toString('base64url')}`; return { id, token, tokenHash: hashCardToken(token) }; }
export function matchesCardToken(token: string, hash: string) {
  return /^[0-9a-f]{64}$/.test(hash) && timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(hashCardToken(token), 'hex'));
}
export function clientCardSubject(entry: ProgressEntry, lead: Record<string, unknown> | null) {
  return createHash('sha256').update(JSON.stringify([entry.$id, entry.candidateName, entry.email, entry.phone, entry.salespersonId, entry.enteredAt,
    lead?.$id, lead?.closedAt, lead?.ownerId, lead?.assignedToId])).digest('hex');
}
export function publicClientCard(entry: ProgressEntry, options: { includeContact: boolean; includeNotes: boolean }): SharedClientCard {
  return { candidateName: entry.candidateName, salespersonName: entry.salespersonName, marketingTl: entry.marketingTl,
    recruiterName: entry.recruiterName, progressStatus: normalizeProgressStatus(entry.progressStatus), enteredAt: entry.enteredAt,
    marketingStartedOn: entry.marketingStartedOn || '', finalFeedback: entry.finalFeedback, finalSavedAt: entry.finalSavedAt,
    ...(options.includeContact ? { email: entry.email, phone: entry.phone } : {}), ...(options.includeNotes ? { notes: entry.notes } : {}) };
}
function cursorKey() {
  const secret = process.env.APPWRITE_API_KEY;
  if (!secret) throw new Error('Card access is unavailable.');
  return createHmac('sha256', secret).update('crm-public-client-card-cursor-v1').digest();
}
// Authenticated encryption keeps internal event IDs out of the public response.
export function encodeCardCursor(token: string, lastId: string) {
  const nonce = randomBytes(12), cipher = createCipheriv('aes-256-gcm', cursorKey(), nonce);
  cipher.setAAD(Buffer.from(hashCardToken(token)));
  const encrypted = Buffer.concat([cipher.update(lastId, 'utf8'), cipher.final()]);
  return Buffer.concat([nonce, cipher.getAuthTag(), encrypted]).toString('base64url');
}
export function decodeCardCursor(token: string, cursor: string) {
  try {
    const bytes = Buffer.from(cursor, 'base64url');
    if (bytes.length < 29 || bytes.length > 100) throw new Error('Invalid cursor');
    const decipher = createDecipheriv('aes-256-gcm', cursorKey(), bytes.subarray(0, 12));
    decipher.setAAD(Buffer.from(hashCardToken(token))); decipher.setAuthTag(bytes.subarray(12, 28));
    const id = Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString('utf8');
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,35}$/.test(id)) throw new Error('Invalid cursor');
    return id;
  } catch { throw new Error('Card unavailable.'); }
}
