import fc from 'fast-check';
import { nativeMfaStatus } from '@/lib/utils/native-mfa-policy';

const now = Date.parse('2026-10-28T16:00:00Z');
const account = { $id: 'person', mfa: true, status: true, emailVerification: true };
const session = { userId: 'person', factors: ['password', 'email'], mfaUpdatedAt: new Date(now - 3600_000).toISOString(), expire: new Date(now + 86400_000).toISOString() };

it('lasts from one verification until the native session expires, with no shorter re-entry window', () => {
  fc.assert(fc.property(fc.integer({ min: 0, max: 7 * 86400_000 }), fc.integer({ min: 1, max: 86400_000 }), (age, remaining) => {
    const expire = new Date(now + remaining).toISOString();
    const status = nativeMfaStatus(account, { ...session, mfaUpdatedAt: new Date(now - age).toISOString(), expire }, now);
    expect(status).toEqual({ state: 'allowed', recheckAt: expire });
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
