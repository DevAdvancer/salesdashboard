import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { Account, Client, Databases, ID, Users } from 'node-appwrite';
import { COLLECTIONS, DATABASE_ID } from '@/lib/constants/appwrite';

export const CRM_PROOF_COOKIE = 'crm_email_verified';
export const OTP_TTL_MS = 10 * 60 * 1000;
export const PROOF_TTL_MS = 12 * 60 * 60 * 1000;
export type Proof = { userId: string; sessionId: string; expiresAt: number };
export type OtpBinding = { userId: string; sessionId: string; purpose: 'login' | 'delegate'; delegateId?: string };
type Challenge = OtpBinding & { provider: 'appwrite'; nativeUserId: string; expiresAt: number };

function providerClient() {
  return new Client().setEndpoint(process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT!)
    .setProject(process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID!).setKey(process.env.APPWRITE_API_KEY!);
}

function secret() {
  const key = process.env.APPWRITE_API_KEY;
  if (!key) throw new Error('CRM security is not configured.');
  return createHmac('sha256', key).update('crm-security-v1').digest();
}
function signature(value: string) { return createHmac('sha256', secret()).update(value).digest('base64url'); }
function equal(left: string, right: string) {
  const a = Buffer.from(left); const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}
export function signProof(proof: Proof) {
  const body = Buffer.from(JSON.stringify(proof)).toString('base64url');
  return `${body}.${signature(body)}`;
}
export function validProof(token: string | undefined, userId: string, sessionId: string, now = Date.now()) {
  if (!token || token.length > 2048) return false;
  try {
    const [body, sig, extra] = token.split('.');
    if (extra || !sig || !equal(signature(body), sig)) return false;
    const proof = JSON.parse(Buffer.from(body, 'base64url').toString()) as Proof;
    return proof.userId === userId && proof.sessionId === sessionId && Number.isFinite(proof.expiresAt) &&
      proof.expiresAt > now && proof.expiresAt <= now + PROOF_TTL_MS;
  } catch { return false; }
}

/**
 * Short-lived, server-only "already verified" pass.
 *
 * proxy.ts runs the full CRM access check (live user record + attendance) and
 * then forwards this signed pass to the route handler / server action of the
 * SAME request as an internal request header. The handler still validates the
 * native Appwrite session itself, and only reuses the proxy's user record and
 * access decision when the pass is genuine, unexpired and bound to that exact
 * account + session. It never reaches the browser, so it adds no settled
 * cache: every new request is checked fresh by the proxy.
 */
export const ACCESS_PASS_TTL_MS = 30_000;
export type AccessPass<TStatus = unknown, TUser = unknown> = {
  kind: 'crm-access-pass'; accountId: string; sessionId: string; dateKey: string;
  status: TStatus; user?: TUser; expiresAt: number;
};
export function signAccessPass<TStatus, TUser>(pass: Omit<AccessPass<TStatus, TUser>, 'kind' | 'expiresAt'>, now = Date.now()) {
  const body = Buffer.from(JSON.stringify({ ...pass, kind: 'crm-access-pass', expiresAt: now + ACCESS_PASS_TTL_MS })).toString('base64url');
  return `${body}.${signature(`access-pass:${body}`)}`;
}
export function readAccessPass<TStatus, TUser>(token: string | null | undefined, accountId: string, sessionId: string, now = Date.now()) {
  if (!token || token.length > 12_000) return null;
  try {
    const [body, sig, extra] = token.split('.');
    if (extra || !body || !sig || !equal(signature(`access-pass:${body}`), sig)) return null;
    const pass = JSON.parse(Buffer.from(body, 'base64url').toString()) as AccessPass<TStatus, TUser>;
    if (pass.kind !== 'crm-access-pass' || pass.accountId !== accountId || pass.sessionId !== sessionId) return null;
    if (!Number.isFinite(pass.expiresAt) || pass.expiresAt <= now || pass.expiresAt > now + ACCESS_PASS_TTL_MS) return null;
    return pass;
  } catch { return null; }
}

function recordId(value: string) { return createHash('sha256').update(value).digest('hex').slice(0, 36); }

/** Document creation is an atomic claim across processes and Vercel instances. */
async function claim(db: Databases, id: string, expiresAt: number) {
  try {
    await db.createDocument(DATABASE_ID, COLLECTIONS.SECURITY_CHALLENGES, id, {
      data: '{}', expiresAt: new Date(expiresAt).toISOString(),
    }, []);
    return true;
  } catch (error) {
    if ((error as { code?: number }).code === 409) return false;
    throw error;
  }
}

export async function issueEmailOtp(db: Databases, binding: OtpBinding, email: string, now = Date.now()) {
  // Throttle by account and purpose, not by a caller-controlled challenge/session ID.
  const scope = `${binding.userId}:${binding.purpose}`;
  if (!await claim(db, recordId(`send:${scope}:${Math.floor(now / 60_000)}`), now + 120_000)) {
    throw new Error('Please wait a minute before requesting another code.');
  }
  let hourlySlot = false;
  for (let slot = 0; slot < 10; slot++) {
    if (await claim(db, recordId(`hour:${scope}:${Math.floor(now / 3_600_000)}:${slot}`), now + 7_200_000)) {
      hourlySlot = true; break;
    }
  }
  if (!hourlySlot) throw new Error('Too many code requests. Please try again later.');
  const client = providerClient();
  const nativeUserId = binding.purpose === 'delegate' ? binding.delegateId : binding.userId;
  if (!nativeUserId) throw new Error('The verification account is unavailable.');
  const native = await new Users(client).get(nativeUserId);
  // createEmailToken otherwise creates an account, or ignores userId for an existing email.
  if (!native.status || native.email.toLowerCase() !== email.trim().toLowerCase()) {
    throw new Error('The registered email does not match the authentication account. Contact your administrator.');
  }
  let token;
  try { token = await new Account(client).createEmailToken(nativeUserId, native.email); }
  catch { throw new Error('The verification email could not be sent. Please contact your administrator.'); }
  if (token.userId !== nativeUserId) throw new Error('The verification account does not match.');
  // Appwrite sends through its configured SMTP. Never store or return token.secret.
  const expiresAt = Math.min(now + OTP_TTL_MS, Date.parse(token.expire));
  if (!Number.isFinite(expiresAt) || expiresAt <= now) throw new Error('The verification code has expired. Request a new code.');
  const id = ID.unique();
  await db.createDocument(DATABASE_ID, COLLECTIONS.SECURITY_CHALLENGES, id, {
    data: JSON.stringify({ ...binding, provider: 'appwrite', nativeUserId, expiresAt }),
    expiresAt: new Date(expiresAt).toISOString(),
  }, []);
  return { challengeId: id, expiresAt: new Date(expiresAt).toISOString() };
}

export async function consumeEmailOtp(db: Databases, binding: OtpBinding, id: string, code: string, now = Date.now()) {
  if (!/^[a-zA-Z0-9._-]{1,36}$/.test(id) || !/^\d{6}$/.test(code)) throw new Error('Enter the six-digit code.');
  const doc = await db.getDocument(DATABASE_ID, COLLECTIONS.SECURITY_CHALLENGES, id);
  const challenge = JSON.parse(doc.data) as Challenge;
  if (challenge.provider !== 'appwrite' || challenge.nativeUserId !== (binding.purpose === 'delegate' ? binding.delegateId : binding.userId) ||
    challenge.expiresAt <= now || challenge.userId !== binding.userId || challenge.sessionId !== binding.sessionId ||
    challenge.purpose !== binding.purpose || challenge.delegateId !== binding.delegateId) throw new Error('This code has expired or belongs to another sign-in.');
  let attemptClaimed = false;
  for (let attempt = 0; attempt < 5; attempt++) {
    if (await claim(db, recordId(`attempt:${id}:${attempt}`), challenge.expiresAt)) { attemptClaimed = true; break; }
  }
  if (!attemptClaimed) throw new Error('Too many attempts. Request a new code.');
  const client = providerClient();
  let verification;
  try { verification = await new Account(client).createSession(challenge.nativeUserId, code); }
  catch { throw new Error('The verification code is incorrect or has expired.'); }
  // Native OTP validation creates a temporary session. Do not expose it or replace the
  // password session: delete it before granting a proof bound to the original session.
  await new Users(client).deleteSession(challenge.nativeUserId, verification.$id);
  if (verification.userId !== challenge.nativeUserId) throw new Error('The verification account does not match.');
  if (!await claim(db, recordId(`consumed:${id}`), challenge.expiresAt)) throw new Error('This code has already been used.');
}
