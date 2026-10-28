import { ID, Query } from 'node-appwrite';
import { z } from 'zod';
import { COLLECTIONS, DATABASE_ID } from '@/lib/constants/appwrite';
import { createAdminClient } from '@/lib/server/appwrite';
import { CrmAccessError, crmAccessEnabled, evaluateCrmAccess, resolveSecurityIdentity, securityDatabase, type SecurityIdentity } from '@/lib/server/crm-access';
import type { User } from '@/lib/types';

const leadership = (role: string) => ['admin', 'developer', 'monitor', 'operations'].includes(role);
const userColumns = ['$id', '$createdAt', '$updatedAt', '$permissions', 'name', 'email', 'role', 'department', 'teamLeadId',
  'branchIds', 'branchId', 'primaryBranchId', 'isActive'];
export const browserReadCollections = () => [COLLECTIONS.USERS, COLLECTIONS.BRANCHES, COLLECTIONS.FORM_CONFIG, COLLECTIONS.LEADS];

export async function verifiedBrowserActor(existingIdentity?: SecurityIdentity) {
  const identity = existingIdentity || await resolveSecurityIdentity();
  if (crmAccessEnabled() && (await evaluateCrmAccess(identity)).state !== 'allowed') throw new CrmAccessError(403, 'Native MFA verification is required.');
  return identity.user;
}
export function validateBrowserQueries(queries: string[], collectionId = COLLECTIONS.USERS) {
  if (queries.length > 50 || queries.some(query => query.length > 8000)) throw new CrmAccessError(400, 'Too many query parameters.');
  return queries.map(raw => {
    let query;
    try { query = JSON.parse(raw); } catch { throw new CrmAccessError(400, 'Invalid query.'); }
    const sort = query && ['orderAsc', 'orderDesc', 'orderRandom'].includes(query.method);
    if (!query || typeof query.method !== 'string' || (!sort && !Array.isArray(query.values)) ||
      (sort && query.method !== 'orderRandom' && typeof query.attribute !== 'string')) throw new CrmAccessError(400, 'Invalid query.');
    // A later projection must never union private fields into our user projection.
    if (collectionId === COLLECTIONS.USERS && query.method === 'select' && query.values.some((value: unknown) => typeof value !== 'string' || !userColumns.includes(value))) {
      throw new CrmAccessError(400, 'Unsupported field projection.');
    }
    return raw;
  });
}
function assertReadableCollection(actor: User, collectionId: string) {
  if (!browserReadCollections().includes(collectionId)) throw new CrmAccessError(403, 'Use the authorized CRM action for this collection.');
  if (collectionId === COLLECTIONS.LEADS && !leadership(actor.role)) throw new CrmAccessError(403, 'Use the scoped leads endpoint.');
}
export function publicUser(doc: Record<string, unknown>, own = false) {
  return Object.fromEntries([...userColumns, ...(own ? ['notificationsEnabled', 'notificationEmails'] : [])]
    .filter(key => key in doc).map(key => [key, doc[key]]));
}
export async function readBrowserDocument(collectionId: string, documentId: string | null, queries: string[]) {
  const identity = await resolveSecurityIdentity();
  // The auth provider needs its own profile before it can display the OTP screen.
  // This exception never lists profiles or reads another person's profile.
  if (collectionId === COLLECTIONS.USERS && documentId === identity.user.$id) {
    return publicUser(identity.user as unknown as Record<string, unknown>, true);
  }
  const actor = await verifiedBrowserActor(identity);
  assertReadableCollection(actor, collectionId);
  const db = securityDatabase();
  if (documentId) {
    const doc = await db.getDocument(DATABASE_ID, collectionId, documentId);
    if (collectionId === COLLECTIONS.USERS && !leadership(actor.role) && (doc.department || 'sales') !== (actor.department || 'sales')) {
      throw new CrmAccessError(403, 'This profile belongs to another department.');
    }
    return collectionId === COLLECTIONS.USERS ? publicUser(doc) : doc;
  }
  const checked = validateBrowserQueries(queries, collectionId);
  if (collectionId === COLLECTIONS.USERS) {
    checked.push(Query.select(userColumns));
    if (!leadership(actor.role)) checked.push(Query.equal('department', actor.department || 'sales'));
  }
  const response = await db.listDocuments(DATABASE_ID, collectionId, checked);
  return collectionId === COLLECTIONS.USERS ? { ...response, documents: response.documents.map(doc => publicUser(doc)) } : response;
}

const branchSchema = z.object({ name: z.string().trim().min(1).max(255).optional(), isActive: z.boolean().optional() }).strict();
export async function mutateBrowserBranch(method: string, documentId: string | null, input: unknown) {
  const actor = await verifiedBrowserActor();
  if (actor.role !== 'admin' && actor.role !== 'developer') throw new CrmAccessError(403, 'Only Admin and Developer can manage branches.');
  const { databases } = await createAdminClient();
  if (method === 'DELETE' && documentId) {
    const [users, leads] = await Promise.all([
      databases.listDocuments(DATABASE_ID, COLLECTIONS.USERS, [Query.or([Query.contains('branchIds', [documentId]), Query.equal('branchId', documentId)]), Query.limit(1)]),
      databases.listDocuments(DATABASE_ID, COLLECTIONS.LEADS, [Query.equal('branchId', documentId), Query.equal('isClosed', false), Query.limit(1)]),
    ]);
    if (users.total || leads.total) throw new CrmAccessError(409, 'Cannot delete a branch with assigned users or active leads.');
    await databases.deleteDocument(DATABASE_ID, COLLECTIONS.BRANCHES, documentId);
    return null;
  }
  const body = z.object({ documentId: z.string().max(36).optional(), data: branchSchema, permissions: z.array(z.string()).optional() }).strict().safeParse(input);
  if (!body.success || (!documentId && !body.data.data.name)) throw new CrmAccessError(400, 'Invalid branch details.');
  if (body.data.data.name) {
    const existing = await databases.listDocuments(DATABASE_ID, COLLECTIONS.BRANCHES, [Query.equal('name', body.data.data.name), Query.limit(2)]);
    if (existing.documents.some(doc => doc.$id !== documentId)) throw new CrmAccessError(409, 'A branch with this name already exists.');
  }
  if (method === 'POST' && !documentId) return databases.createDocument(DATABASE_ID, COLLECTIONS.BRANCHES, ID.unique(), { isActive: true, ...body.data.data }, []);
  if (method === 'PATCH' && documentId) return databases.updateDocument(DATABASE_ID, COLLECTIONS.BRANCHES, documentId, body.data.data);
  throw new CrmAccessError(405, 'Unsupported branch operation.');
}
