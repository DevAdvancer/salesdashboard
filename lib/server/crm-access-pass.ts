import { createHmac, timingSafeEqual } from 'node:crypto';

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

/**
 * Short-lived, server-only "already verified" pass.
 *
 * proxy.ts runs the full CRM access check (native MFA session + live user record) and
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

/**
 * HttpOnly browser cookie: "this server already verified native MFA for these exact
 * sign-in credentials". It is bound to a hash of the native credential cookies, so
 * it is useless without them and is replaced whenever the browser rotates its JWT.
 * It lets proxy.ts admit requests without Appwrite round trips; handlers still read
 * the live user record before returning data or writing.
 */
export const ACCESS_COOKIE_TTL_MS = 15 * 60_000;
export type AccessCookie<TAccount, TSession> = {
  kind: 'crm-access-cookie'; credential: string; account: TAccount; session: TSession; expiresAt: number;
};
/** Returns null when `notAfter` (the native session expiry) has already passed. */
export function signAccessCookie<TAccount, TSession>(cookie: Omit<AccessCookie<TAccount, TSession>, 'kind' | 'expiresAt'>, notAfter: number, now = Date.now()) {
  const expiresAt = Math.min(now + ACCESS_COOKIE_TTL_MS, Number.isFinite(notAfter) ? notAfter : now);
  if (expiresAt <= now) return null;
  const body = Buffer.from(JSON.stringify({ ...cookie, kind: 'crm-access-cookie', expiresAt })).toString('base64url');
  return { value: `${body}.${signature(`access-cookie:${body}`)}`, expiresAt };
}
export function readAccessCookie<TAccount, TSession>(token: string | null | undefined, credential: string, now = Date.now()) {
  if (!token || token.length > 4_000) return null;
  try {
    const [body, sig, extra] = token.split('.');
    if (extra || !body || !sig || !equal(signature(`access-cookie:${body}`), sig)) return null;
    const cookie = JSON.parse(Buffer.from(body, 'base64url').toString()) as AccessCookie<TAccount, TSession>;
    if (cookie.kind !== 'crm-access-cookie' || cookie.credential !== credential) return null;
    if (!Number.isFinite(cookie.expiresAt) || cookie.expiresAt <= now || cookie.expiresAt > now + ACCESS_COOKIE_TTL_MS) return null;
    return cookie;
  } catch { return null; }
}
