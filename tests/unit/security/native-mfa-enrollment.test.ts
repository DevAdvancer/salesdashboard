import { planNativeMfaEnrollment } from '@/lib/utils/native-mfa-enrollment';

const profile = { email: 'Person@Example.com ', isActive: true };
const account = { email: 'person@example.com', status: true, mfa: false, emailVerification: true };
const defaults = { verifyEmails: false, includeInactive: false };

it('enables MFA for every matching active account regardless of role', () => {
  expect(planNativeMfaEnrollment(profile, account, defaults)).toEqual({ enableMfa: true, verifyEmail: false, outcome: 'mfa-on-code-at-sign-in' });
  expect(planNativeMfaEnrollment(profile, { ...account, mfa: true }, defaults)).toEqual({ enableMfa: false, verifyEmail: false, outcome: 'ready' });
});
it('verifies the email only when asked, leaving the link flow otherwise', () => {
  const unverified = { ...account, emailVerification: false };
  expect(planNativeMfaEnrollment(profile, unverified, defaults)).toMatchObject({ enableMfa: true, verifyEmail: false, outcome: 'mfa-on-email-link-at-sign-in' });
  expect(planNativeMfaEnrollment(profile, unverified, { ...defaults, verifyEmails: true })).toMatchObject({ enableMfa: true, verifyEmail: true, outcome: 'mfa-on-code-at-sign-in' });
});
it('never touches missing, mismatched or (by default) inactive accounts', () => {
  expect(planNativeMfaEnrollment(profile, undefined, defaults)).toMatchObject({ skipped: 'missing-account', enableMfa: false, verifyEmail: false });
  expect(planNativeMfaEnrollment(profile, { ...account, email: 'other@example.com' }, { verifyEmails: true, includeInactive: true }))
    .toMatchObject({ skipped: 'email-mismatch', enableMfa: false, verifyEmail: false });
  expect(planNativeMfaEnrollment({ ...profile, isActive: false }, account, defaults)).toMatchObject({ skipped: 'inactive' });
  expect(planNativeMfaEnrollment(profile, { ...account, status: false }, defaults)).toMatchObject({ skipped: 'inactive' });
  expect(planNativeMfaEnrollment({ ...profile, isActive: false }, account, { ...defaults, includeInactive: true })).toMatchObject({ enableMfa: true });
});
