import { Account, Databases, ID, Query } from 'node-appwrite';
import { ServerAppwriteClient as Client } from '@/lib/server/appwrite-client';
import type { Models } from 'node-appwrite';
import { cookies } from 'next/headers';
import { COLLECTIONS, DATABASE_ID } from '@/lib/constants/appwrite';
import type { AttendanceRecord, User } from '@/lib/types';
import { getTodayEst } from '@/lib/utils/est-date';
import { attendanceExempt, canApproveCrmAccess, normalizeVerificationName } from '@/lib/utils/crm-access-policy';
import { consumeEmailOtp, CRM_PROOF_COOKIE, issueEmailOtp, validProof } from '@/lib/server/crm-security-store';
import { listAllDocuments } from '@/lib/server/appwrite-pagination';
import { createHash } from 'node:crypto';
import { cache } from 'react';
import { createInFlightGroup } from '@/lib/utils/in-flight';
import { bumpRequestCount } from '@/lib/server/appwrite-request-meter';
import { memoizeCrmRequest } from '@/lib/server/crm-request-context';

const inFlightIdentity = createInFlightGroup();
const inFlightReads = createInFlightGroup();

export function crmAccessEnabled() { return process.env.CRM_ACCESS_ENFORCEMENT === 'true'; }
type CookieReader = { get: (name: string) => { value: string } | undefined };
export type SecurityIdentity = { account: Models.User<Models.Preferences>; session: Models.Session; user: User; proof?: string };
export type AccessRequest = {
  $id: string; userId: string; delegateId: string; dateKey: string; state: 'pending' | 'approved' | 'denied';
  data: string;
};
type RequestData = { sessionId: string; assignedAt: string | null; requestedAt: string; delegateName: string;
  decidedAt?: string; decidedById?: string; decidedByName?: string;
  decisions?: Array<{ approved: boolean; at: string; actorId: string; actorName: string }> };
export type CrmAccessStatus = {
  state: 'disabled' | 'otp_required' | 'attendance_required' | 'approval_pending' | 'approval_denied' | 'allowed';
  dateKey: string; canVerifyDelegate?: boolean; requestId?: string; actingAs?: string;
};
export class CrmAccessError extends Error {
  constructor(public status: number, message: string, public code = 'CRM_ACCESS_REQUIRED') { super(message); }
}
function sessionClient() {
  return new Client().setEndpoint(process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT!)
    .setProject(process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID!);
}
export function securityDatabase() {
  const database = new Databases(sessionClient().setKey(process.env.APPWRITE_API_KEY!));
  return new Proxy(database, { get(target, property) {
    const method = Reflect.get(target, property);
    if (typeof method !== 'function') return method;
    if (property !== 'getDocument' && property !== 'listDocuments') return method.bind(target);
    return (...args: unknown[]) => {
      const key = createHash('sha256').update(JSON.stringify([process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT,
        process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID, process.env.APPWRITE_API_KEY, property, args])).digest('hex');
      // No settled cache: revocations and attendance changes are re-read immediately.
      return inFlightReads(key, () => { bumpRequestCount(); return method.apply(target, args); });
    };
  } });
}
async function readSecurityIdentity(jar: CookieReader): Promise<SecurityIdentity> {
  const jwt = jar.get('crm_appwrite_jwt')?.value;
  const project = process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID!;
  const credentials = jwt ? [{ jwt }] : [`a_session_${project}`, `a_session_${project}_legacy`, project]
    .map(name => ({ session: jar.get(name)?.value })).filter(item => item.session);
  for (const credential of credentials) {
    const client = sessionClient();
    if ('jwt' in credential) client.setJWT(credential.jwt!);
    else client.setSession(credential.session!);
    const accountApi = new Account(client);
    let account; let session;
    try { bumpRequestCount(); bumpRequestCount(); [account, session] = await Promise.all([accountApi.get(), accountApi.getSession('current')]); }
    catch { continue; }
    const user = await securityDatabase().getDocument(DATABASE_ID, COLLECTIONS.USERS, account.$id) as unknown as User;
    if (user.isActive === false) throw new CrmAccessError(403, 'This CRM account is inactive.', 'ACCOUNT_INACTIVE');
    return { account, session, user, proof: jar.get(CRM_PROOF_COOKIE)?.value };
  }
  throw new CrmAccessError(401, 'Please sign in again.', 'UNAUTHENTICATED');
}
const requestIdentity = cache(async () => resolveSecurityIdentity(await cookies()));
const identityRequestKey = Symbol('crm-identity');
export async function resolveSecurityIdentity(reader?: CookieReader): Promise<SecurityIdentity> {
  if (!reader) return memoizeCrmRequest(identityRequestKey, requestIdentity);
  const project = process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID!;
  const values = ['crm_appwrite_jwt', `a_session_${project}`, `a_session_${project}_legacy`, project, CRM_PROOF_COOKIE].map(name => reader.get(name)?.value || '');
  const key = createHash('sha256').update(JSON.stringify([process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT, project, ...values])).digest('hex');
  // Parallel dashboard requests share only an outstanding lookup. Every later request
  // revalidates native session, user activation and proof; no authorization TTL is added.
  return inFlightIdentity(key, () => readSecurityIdentity(reader));
}
export function hasEmailProof(identity: SecurityIdentity) {
  return validProof(identity.proof, identity.account.$id, identity.session.$id);
}
export async function attendanceFor(userId: string, db = securityDatabase(), dateKey = getTodayEst()) {
  const rows = await db.listDocuments(DATABASE_ID, COLLECTIONS.ATTENDANCE, [
    Query.equal('userId', userId), Query.equal('dateKey', dateKey), Query.limit(2),
  ]);
  // Fail closed if duplicate records disagree, rather than trusting an arbitrary first row.
  return rows.documents.length === 1 ? rows.documents[0] as unknown as AttendanceRecord : null;
}
async function assignedDelegate(identity: SecurityIdentity, db = securityDatabase(), existingAttendance?: AttendanceRecord | null) {
  const attendance = existingAttendance === undefined ? await attendanceFor(identity.user.$id, db) : existingAttendance;
  if (!attendance?.delegateUserId || !attendance.assignedAt) return null;
  try {
    const delegate = await db.getDocument(DATABASE_ID, COLLECTIONS.USERS, attendance.delegateUserId) as unknown as User;
    if (delegate.isActive === false || delegate.$id === identity.user.$id ||
      (delegate.department || 'sales') !== (identity.user.department || 'sales')) return null;
    return { attendance, delegate };
  } catch (error) {
    if ((error as { code?: number }).code === 404) return null;
    throw error;
  }
}
function requestMatches(row: AccessRequest, data: RequestData, identity: SecurityIdentity, attendance: AttendanceRecord) {
  return row.userId === identity.user.$id && row.dateKey === getTodayEst() && row.delegateId === attendance.delegateUserId &&
    data.sessionId === identity.session.$id && data.assignedAt === attendance.assignedAt;
}
export async function evaluateCrmAccess(identity: SecurityIdentity): Promise<CrmAccessStatus> {
  return memoizeCrmRequest(identity, () => readCrmAccessStatus(identity));
}
async function readCrmAccessStatus(identity: SecurityIdentity): Promise<CrmAccessStatus> {
  const dateKey = getTodayEst();
  if (!hasEmailProof(identity)) return { state: 'otp_required', dateKey };
  if (attendanceExempt(identity.user.role)) return { state: 'allowed', dateKey };
  const db = securityDatabase();
  const attendance = await attendanceFor(identity.user.$id, db, dateKey);
  if (attendance?.present === true) return { state: 'allowed', dateKey };
  const assigned = await assignedDelegate(identity, db, attendance);
  if (!assigned) return { state: 'attendance_required', dateKey, canVerifyDelegate: false };
  const rows = await db.listDocuments(DATABASE_ID, COLLECTIONS.CRM_ACCESS_REQUESTS, [
    Query.equal('userId', identity.user.$id), Query.equal('dateKey', dateKey), Query.orderDesc('$createdAt'), Query.limit(100),
  ]);
  for (const row of rows.documents as unknown as AccessRequest[]) {
    const data = JSON.parse(row.data) as RequestData;
    if (!requestMatches(row, data, identity, assigned.attendance)) continue;
    if (row.state === 'approved' && data.decidedById && data.decidedById !== row.delegateId) {
      const approver = await db.getDocument(DATABASE_ID, COLLECTIONS.USERS, data.decidedById) as unknown as User;
      const delegatePresent = attendanceExempt(assigned.delegate.role) || (await attendanceFor(row.delegateId, db, dateKey))?.present === true;
      if (canApproveCrmAccess(approver, identity.user) && delegatePresent) {
        return { state: 'allowed', dateKey, requestId: row.$id, actingAs: assigned.delegate.name };
      }
    }
    return { state: row.state === 'denied' ? 'approval_denied' : 'approval_pending', dateKey, requestId: row.$id, canVerifyDelegate: false };
  }
  return { state: 'attendance_required', dateKey, canVerifyDelegate: true };
}
export async function assertCrmAccess(reader?: CookieReader, existingIdentity?: SecurityIdentity) {
  if (!crmAccessEnabled()) return;
  const identity = existingIdentity || await resolveSecurityIdentity(reader);
  const status = await evaluateCrmAccess(identity);
  if (status.state !== 'allowed') throw new CrmAccessError(403,
    status.state === 'otp_required' ? 'Verify your email to access CRM.' : 'Ask your TL or manager to mark you present or approve assigned cover.', status.state);
  return identity;
}
export async function startLoginOtp(identity: SecurityIdentity) {
  return issueEmailOtp(securityDatabase(), { userId: identity.user.$id, sessionId: identity.session.$id, purpose: 'login' }, identity.account.email);
}
export async function startDelegateOtp(identity: SecurityIdentity, name: string) {
  if (!hasEmailProof(identity)) throw new CrmAccessError(403, 'Verify the sign-in email first.');
  const assigned = await assignedDelegate(identity);
  if (!assigned) throw new CrmAccessError(403, 'No one is assigned. Ask your TL or manager to mark you present or assign cover.');
  if (normalizeVerificationName(name) !== normalizeVerificationName(assigned.delegate.name)) throw new CrmAccessError(400, 'Enter the name of the person assigned to cover this account.');
  return issueEmailOtp(securityDatabase(), { userId: identity.user.$id, sessionId: identity.session.$id,
    purpose: 'delegate', delegateId: assigned.delegate.$id }, assigned.delegate.email);
}
export async function submitDelegateRequest(identity: SecurityIdentity, challengeId: string, code: string) {
  if (!hasEmailProof(identity)) throw new CrmAccessError(403, 'Verify the sign-in email first.');
  const db = securityDatabase();
  const assigned = await assignedDelegate(identity, db);
  if (!assigned) throw new CrmAccessError(403, 'There is no current cover assignment.');
  await consumeEmailOtp(db, { userId: identity.user.$id, sessionId: identity.session.$id, purpose: 'delegate', delegateId: assigned.delegate.$id }, challengeId, code);
  const id = ID.unique();
  await db.createDocument(DATABASE_ID, COLLECTIONS.CRM_ACCESS_REQUESTS, id, {
    userId: identity.user.$id, delegateId: assigned.delegate.$id, dateKey: getTodayEst(), state: 'pending',
    data: JSON.stringify({ sessionId: identity.session.$id, assignedAt: assigned.attendance.assignedAt,
      requestedAt: new Date().toISOString(), delegateName: assigned.delegate.name } satisfies RequestData),
  }, []);
  return { requestId: id };
}
export async function listAccessApprovals(actor: User, actingUserId = actor.$id) {
  const db = securityDatabase();
  const rows = await listAllDocuments<AccessRequest>({ databases: db, databaseId: DATABASE_ID,
    collectionId: COLLECTIONS.CRM_ACCESS_REQUESTS, queries: [Query.equal('dateKey', getTodayEst())],
  });
  const ids = [...new Set(rows.map(row => row.userId))];
  const targets = new Map<string, User>();
  for (let offset = 0; offset < ids.length; offset += 100) {
    const people = await listAllDocuments<User>({ databases: db, databaseId: DATABASE_ID, collectionId: COLLECTIONS.USERS,
      queries: [Query.equal('$id', ids.slice(offset, offset + 100))] });
    people.forEach(person => targets.set(person.$id, person));
  }
  const visible = [];
  for (const row of rows) {
    const target = targets.get(row.userId);
    if (!target) continue;
    if (!canApproveCrmAccess(actor, target) || row.delegateId === actingUserId || row.userId === actingUserId) continue;
    let data: RequestData;
    try { data = JSON.parse(row.data) as RequestData; } catch { continue; }
    if (!data || typeof data.requestedAt !== 'string' || typeof data.delegateName !== 'string') continue;
    visible.push({ id: row.$id, userName: target.name, delegateName: data.delegateName, state: row.state,
      requestedAt: data.requestedAt, decidedByName: data.decidedByName });
  }
  return visible;
}
export async function decideAccessRequest(actor: User, id: string, approve: boolean, auditActor = { id: actor.$id, name: actor.name }) {
  const db = securityDatabase();
  const row = await db.getDocument(DATABASE_ID, COLLECTIONS.CRM_ACCESS_REQUESTS, id) as unknown as AccessRequest;
  const target = await db.getDocument(DATABASE_ID, COLLECTIONS.USERS, row.userId) as unknown as User;
  if (!canApproveCrmAccess(actor, target) || row.delegateId === auditActor.id || row.userId === auditActor.id || row.dateKey !== getTodayEst()) throw new CrmAccessError(403, 'You cannot approve this access request.');
  const attendance = await attendanceFor(row.userId, db);
  const data = JSON.parse(row.data) as RequestData;
  if (!attendance || attendance.delegateUserId !== row.delegateId || attendance.assignedAt !== data.assignedAt) throw new CrmAccessError(409, 'The cover assignment has changed.');
  await db.updateDocument(DATABASE_ID, COLLECTIONS.CRM_ACCESS_REQUESTS, row.$id, {
    state: approve ? 'approved' : 'denied', data: JSON.stringify({ ...data, decidedAt: new Date().toISOString(), decidedById: actor.$id, decidedByName: auditActor.name,
      decisions: [...data.decisions || [], { approved: approve, at: new Date().toISOString(), actorId: auditActor.id, actorName: auditActor.name }] }),
  });
}

export async function effectiveCrmAuditActor(actor: { id: string; name: string }, existingIdentity?: SecurityIdentity) {
  if (!crmAccessEnabled()) return actor;
  const identity = existingIdentity || await resolveSecurityIdentity();
  const status = await evaluateCrmAccess(identity);
  if (status.state !== 'allowed') throw new CrmAccessError(403, 'CRM access is not approved.');
  if (!status.requestId) return actor;
  const row = await securityDatabase().getDocument(DATABASE_ID, COLLECTIONS.CRM_ACCESS_REQUESTS, status.requestId) as unknown as AccessRequest;
  const delegate = await securityDatabase().getDocument(DATABASE_ID, COLLECTIONS.USERS, row.delegateId) as unknown as User;
  return { id: delegate.$id, name: delegate.name };
}
