import fc from 'fast-check';
import { nativeMfaStatus, NATIVE_MFA_WINDOW_MS } from '@/lib/utils/native-mfa-policy';

const now = Date.parse('2026-10-28T16:00:00Z');
const account = { $id: 'person', mfa: true, status: true, emailVerification: true };
const session = { userId: 'person', factors: ['password', 'email'], mfaUpdatedAt: new Date(now - 3600_000).toISOString(), expire: new Date(now + 86400_000).toISOString() };

it('expires at exactly twelve elapsed hours across dates, time zones and DST', () => {
  fc.assert(fc.property(fc.date({ min: new Date('2025-01-01'), max: new Date('2028-01-01'), noInvalidDate: true }),
    fc.integer({ min: 0, max: NATIVE_MFA_WINDOW_MS * 2 }), (verified, age) => {
      const current = verified.getTime() + age;
      const status = nativeMfaStatus(account, { ...session, mfaUpdatedAt: verified.toISOString(), expire: new Date(current + 86400_000).toISOString() }, current);
      expect(status.state === 'allowed').toBe(age < NATIVE_MFA_WINDOW_MS);
      if (age < NATIVE_MFA_WINDOW_MS) expect(status.recheckAt).toBe(new Date(verified.getTime() + NATIVE_MFA_WINDOW_MS).toISOString());
    }));
});
it('requires enabled native MFA and a verified email for all roles, with no attendance exemption', () => {
  fc.assert(fc.property(fc.boolean(), fc.boolean(), (mfa, emailVerification) => {
    expect(nativeMfaStatus({ ...account, mfa, emailVerification }, session, now).state === 'allowed').toBe(mfa && emailVerification);
  }));
});
it('never authorizes password-only, wrong-user, disabled, expired, missing or future MFA evidence', () => {
  for (const factors of [[], ['password'], ['email'], ['oauth2', 'email'], ['password', 'made-up']]) {
    expect(nativeMfaStatus(account, { ...session, factors }, now).state).not.toBe('allowed');
  }
  fc.assert(fc.property(fc.string().filter(id => id !== 'person'), id => {
    expect(nativeMfaStatus(account, { ...session, userId: id }, now).state).not.toBe('allowed');
  }));
  expect(nativeMfaStatus({ ...account, status: false }, session, now).state).not.toBe('allowed');
  for (const mfaUpdatedAt of ['', 'invalid', new Date(now + 1).toISOString()]) {
    expect(nativeMfaStatus(account, { ...session, mfaUpdatedAt }, now).state).not.toBe('allowed');
  }
  for (const expire of ['', 'invalid', new Date(now).toISOString()]) {
    expect(nativeMfaStatus(account, { ...session, expire }, now).state).not.toBe('allowed');
  }
});
it('never extends native session expiry just because the MFA window is longer', () => {
  fc.assert(fc.property(fc.integer({ min: 1, max: 3600_000 }), remaining => {
    const expire = new Date(now + remaining).toISOString();
    expect(nativeMfaStatus(account, { ...session, expire }, now)).toEqual({ state: 'allowed', recheckAt: expire });
  }));
});
