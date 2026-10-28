/** Native Appwrite session fields are the only MFA evidence; browser flags and
 * legacy CRM proof cookies are never accepted. This policy is shared for UI hints
 * and server checks; the server always obtains its own native session. */
export const NATIVE_MFA_WINDOW_MS = 12 * 60 * 60 * 1000;
type Account = { $id: string; mfa?: boolean; status?: boolean; emailVerification?: boolean };
type Session = { userId?: string; factors?: string[]; mfaUpdatedAt?: string; expire?: string };

export function nativeMfaStatus(account: Account, session: Session, now = Date.now()): {
  state: 'mfa_setup_required' | 'mfa_required' | 'allowed'; recheckAt?: string;
} {
  if (account.mfa !== true || account.emailVerification !== true) return { state: 'mfa_setup_required' };
  const factors = new Set(session.factors || []);
  const verifiedAt = Date.parse(session.mfaUpdatedAt || '');
  const nativeExpiry = Date.parse(session.expire || '');
  const secondFactor = ['email', 'totp', 'phone', 'recoverycode', 'recoveryCode'].some(factor => factors.has(factor));
  if (account.status === false || session.userId !== account.$id || !factors.has('password') || !secondFactor ||
    !Number.isFinite(verifiedAt) || verifiedAt > now || !Number.isFinite(nativeExpiry)) return { state: 'mfa_required' };
  const expiresAt = Math.min(verifiedAt + NATIVE_MFA_WINDOW_MS, nativeExpiry);
  if (expiresAt <= now) return { state: 'mfa_required' };
  return { state: 'allowed', recheckAt: new Date(expiresAt).toISOString() };
}
