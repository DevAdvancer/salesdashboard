/** @jest-environment node */
import { ACCESS_PASS_TTL_MS, readAccessPass, signAccessPass, signProof } from '@/lib/server/crm-security-store';

const allowed = { state: 'allowed', dateKey: '2026-10-23' };
const user = { $id: 'person', role: 'agent', isActive: true };
const issue = (now = Date.now()) => signAccessPass({ accountId: 'person', sessionId: 'session', dateKey: '2026-10-23', status: allowed, user }, now);

it('accepts a genuine pass only for the same account and session', () => {
  const token = issue();
  expect(readAccessPass(token, 'person', 'session')).toMatchObject({ status: allowed, user });
  expect(readAccessPass(token, 'someone-else', 'session')).toBeNull();
  expect(readAccessPass(token, 'person', 'other-session')).toBeNull();
});

it('rejects forged, tampered and unsigned values', () => {
  const token = issue();
  const [body, sig] = token.split('.');
  const tampered = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body, 'base64url').toString()), accountId: 'admin' })).toString('base64url');
  expect(readAccessPass(`${tampered}.${sig}`, 'admin', 'session')).toBeNull();
  expect(readAccessPass(`${body}.not-the-signature`, 'person', 'session')).toBeNull();
  expect(readAccessPass(body, 'person', 'session')).toBeNull();
  expect(readAccessPass('forged', 'person', 'session')).toBeNull();
  expect(readAccessPass(undefined, 'person', 'session')).toBeNull();
});

it('cannot be confused with the email-verification proof cookie', () => {
  const proof = signProof({ userId: 'person', sessionId: 'session', expiresAt: Date.now() + 60_000 });
  expect(readAccessPass(proof, 'person', 'session')).toBeNull();
});

it('expires quickly and rejects passes dated in the future', () => {
  const now = Date.now();
  expect(readAccessPass(issue(now), 'person', 'session', now + ACCESS_PASS_TTL_MS + 1)).toBeNull();
  expect(readAccessPass(issue(now + 10 * 60_000), 'person', 'session', now)).toBeNull();
});
