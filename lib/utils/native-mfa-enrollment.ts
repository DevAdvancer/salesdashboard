/** Which native MFA changes the bulk enrollment script may make for one CRM profile. */
export type MfaEnrollmentAccount = { email?: string; status?: boolean; mfa?: boolean; emailVerification?: boolean };
export type MfaEnrollmentPlan = {
  enableMfa: boolean; verifyEmail: boolean;
  outcome: 'ready' | 'mfa-on-code-at-sign-in' | 'mfa-on-email-link-at-sign-in' | 'skipped';
  skipped?: 'missing-account' | 'email-mismatch' | 'inactive';
};

export function planNativeMfaEnrollment(profile: { email?: unknown; isActive?: unknown }, account: MfaEnrollmentAccount | undefined,
  options: { verifyEmails: boolean; includeInactive: boolean }): MfaEnrollmentPlan {
  const skip = (skipped: MfaEnrollmentPlan['skipped']): MfaEnrollmentPlan => ({ enableMfa: false, verifyEmail: false, outcome: 'skipped', skipped });
  if (!account) return skip('missing-account');
  // Codes go to the native email, so only enroll where it is the address the CRM has on file.
  if (!account.email || typeof profile.email !== 'string' ||
    account.email.trim().toLowerCase() !== profile.email.trim().toLowerCase()) return skip('email-mismatch');
  if (!options.includeInactive && (profile.isActive === false || account.status === false)) return skip('inactive');
  const enableMfa = account.mfa !== true;
  const verifyEmail = options.verifyEmails && account.emailVerification !== true;
  if (!enableMfa && !verifyEmail && account.emailVerification === true) return { enableMfa, verifyEmail, outcome: 'ready' };
  return { enableMfa, verifyEmail,
    outcome: account.emailVerification === true || verifyEmail ? 'mfa-on-code-at-sign-in' : 'mfa-on-email-link-at-sign-in' };
}
