import { Account, Databases } from 'node-appwrite';
import { ServerAppwriteClient as Client } from '@/lib/server/appwrite-client';
import type { Models } from 'node-appwrite';
import { cookies, headers } from 'next/headers';
import { COLLECTIONS, DATABASE_ID } from '@/lib/constants/appwrite';
import type { User } from '@/lib/types';
import { getTodayEst } from '@/lib/utils/est-date';
import { readAccessPass, signAccessPass } from '@/lib/server/crm-access-pass';
import { nativeMfaStatus } from '@/lib/utils/native-mfa-policy';
import { createHash } from 'node:crypto';
import { cache } from 'react';
import { createInFlightGroup } from '@/lib/utils/in-flight';
import { bumpRequestCount } from '@/lib/server/appwrite-request-meter';
import { memoizeCrmRequest } from '@/lib/server/crm-request-context';

const inFlightIdentity = createInFlightGroup();
const inFlightReads = createInFlightGroup();

export function crmAccessEnabled() { return process.env.CRM_ACCESS_ENFORCEMENT === 'true'; }
type CookieReader = { get: (name: string) => { value: string } | undefined };
export type SecurityIdentity = { account: Models.User<Models.Preferences>; session: Models.Session; user: User;
  /** Access decision the proxy made for this same request (see CRM_ACCESS_PASS_HEADER). */
  preverified?: CrmAccessStatus };
/** Internal request header proxy.ts forwards to the handler of the same request. */
export const CRM_ACCESS_PASS_HEADER = 'x-crm-access-pass';
/** User records larger than this are re-read by the handler instead of forwarded. */
const ACCESS_PASS_MAX_USER_CHARS = 3_000;
export type CrmAccessStatus = {
  state: 'disabled' | 'mfa_required' | 'mfa_setup_required' | 'allowed';
  dateKey: string; recheckAt?: string;
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
      // No settled cache: account activation changes are re-read immediately.
      return inFlightReads(key, () => { bumpRequestCount(); return method.apply(target, args); });
    };
  } });
}
async function readSecurityIdentity(jar: CookieReader, passToken?: string | null): Promise<SecurityIdentity> {
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
    // The native session above is always validated live. Only the user record and
    // access decision the proxy just read for this same request are reused, and
    // only when the signed pass is bound to this exact account and session.
    const pass = readAccessPass<CrmAccessStatus, User>(passToken, account.$id, session.$id);
    const user = pass?.user && pass.user.$id === account.$id ? pass.user
      : await securityDatabase().getDocument(DATABASE_ID, COLLECTIONS.USERS, account.$id) as unknown as User;
    if (account.status === false || user.isActive === false) throw new CrmAccessError(403, 'This CRM account is inactive.', 'ACCOUNT_INACTIVE');
    if (!account.email || !user.email || account.email.trim().toLowerCase() !== user.email.trim().toLowerCase()) {
      throw new CrmAccessError(403, 'Your sign-in email does not match your CRM profile. Contact an administrator.', 'ACCOUNT_EMAIL_MISMATCH');
    }
    const preverified = pass && pass.dateKey === getTodayEst() && pass.status && (pass.status as CrmAccessStatus).state === 'allowed'
      ? pass.status : undefined;
    return { account, session, user, ...(preverified ? { preverified } : {}) };
  }
  throw new CrmAccessError(401, 'Please sign in again.', 'UNAUTHENTICATED');
}
async function requestAccessPass() {
  try { return (await headers()).get(CRM_ACCESS_PASS_HEADER); } catch { return null; }
}
const requestIdentity = cache(async () => resolveSecurityIdentity(await cookies(), await requestAccessPass()));
const identityRequestKey = Symbol('crm-identity');
export async function resolveSecurityIdentity(reader?: CookieReader, passToken?: string | null): Promise<SecurityIdentity> {
  if (!reader) return memoizeCrmRequest(identityRequestKey, requestIdentity);
  const project = process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID!;
  const values = ['crm_appwrite_jwt', `a_session_${project}`, `a_session_${project}_legacy`, project].map(name => reader.get(name)?.value || '');
  values.push(passToken || '');
  const key = createHash('sha256').update(JSON.stringify([process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT, project, ...values])).digest('hex');
  // Parallel dashboard requests share only an outstanding lookup. Every later request
  // revalidates native session, user activation and MFA; no authorization TTL is added.
  return inFlightIdentity(key, () => readSecurityIdentity(reader, passToken));
}
export async function evaluateCrmAccess(identity: SecurityIdentity): Promise<CrmAccessStatus> {
  return memoizeCrmRequest(identity, async () => ({ dateKey: getTodayEst(),
    ...nativeMfaStatus(identity.account, identity.session),
  }));
}
/**
 * proxy.ts entry point: run the full access check, then return a signed pass for
 * the handler of this same request so it does not repeat the user read.
 */
export async function assertCrmAccessForProxy(reader: CookieReader): Promise<string | null> {
  const identity = await resolveSecurityIdentity(reader);
  const status = await evaluateCrmAccess(identity);
  if (status.state !== 'allowed') throw new CrmAccessError(403,
    status.state === 'mfa_setup_required' ? 'Enable native Appwrite MFA to access CRM.' : 'Verify your sign-in code to access CRM.', status.state);
  try {
    const user = JSON.stringify(identity.user).length <= ACCESS_PASS_MAX_USER_CHARS ? identity.user : undefined;
    return signAccessPass<CrmAccessStatus, User>({ accountId: identity.account.$id, sessionId: identity.session.$id,
      dateKey: status.dateKey, status, user });
  } catch { return null; }
}
export async function assertCrmAccess(reader?: CookieReader, existingIdentity?: SecurityIdentity) {
  if (!crmAccessEnabled()) return;
  const identity = existingIdentity || await resolveSecurityIdentity(reader);
  const status = await evaluateCrmAccess(identity);
  if (status.state !== 'allowed') throw new CrmAccessError(403,
    status.state === 'mfa_setup_required' ? 'Enable native Appwrite MFA to access CRM.' : 'Verify your sign-in code to access CRM.', status.state);
  return identity;
}
/** Audit the authenticated account itself; attendance never changes the actor. */
export async function effectiveCrmAuditActor(actor: { id: string; name: string }, existingIdentity?: SecurityIdentity) {
  if (!crmAccessEnabled()) return actor;
  const identity = existingIdentity || await resolveSecurityIdentity();
  if ((await evaluateCrmAccess(identity)).state !== 'allowed') throw new CrmAccessError(403, 'Verify your sign-in code to access CRM.');
  return { id: identity.user.$id, name: identity.user.name };
}
