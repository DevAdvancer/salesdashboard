/** @jest-environment node */
import fc from 'fast-check';
import { canShareProgress, PROGRESS_ROLES } from '@/lib/client-progress';
import { newCardToken, matchesCardToken, hashCardToken, encodeCardCursor, decodeCardCursor } from '@/lib/server/client-card-security';
import { bypassCrmGate } from '@/lib/utils/crm-access-policy';

test('only an active Admin can manage public cards, across all roles', () => {
  fc.assert(fc.property(fc.constantFrom(...PROGRESS_ROLES), fc.boolean(), (role, isActive) => {
    expect(canShareProgress({ $id: 'user', role, isActive })).toBe(role === 'admin' && isActive);
  }));
});
test('tokens are unique, verified by hash, and cannot be reused across clients', () => {
  fc.assert(fc.property(fc.uuid(), fc.uuid(), (first, second) => {
    const a = newCardToken(first), b = newCardToken(second);
    expect(a.token).not.toBe(b.token);
    expect(matchesCardToken(a.token, a.tokenHash)).toBe(true);
    expect(matchesCardToken(b.token, a.tokenHash)).toBe(false);
    expect(a.tokenHash).toBe(hashCardToken(a.token));
    expect(a.tokenHash).not.toContain(a.token.split('.')[1]);
  }));
});
test('encrypted feedback cursors reject forgery, different cards and rotated links', () => {
  const previous = process.env.APPWRITE_API_KEY; process.env.APPWRITE_API_KEY = 'test-only-card-key';
  try {
    const first = newCardToken('entry'), replacement = newCardToken('entry');
    const cursor = encodeCardCursor(first.token, 'feedback-internal-id');
    expect(cursor).not.toContain('feedback-internal-id');
    expect(decodeCardCursor(first.token, cursor)).toBe('feedback-internal-id');
    expect(() => decodeCardCursor(replacement.token, cursor)).toThrow('unavailable');
    expect(() => decodeCardCursor(newCardToken('other-entry').token, cursor)).toThrow('unavailable');
    const tampered = Buffer.from(cursor, 'base64url'); tampered[20] ^= 1;
    expect(() => decodeCardCursor(first.token, tampered.toString('base64url'))).toThrow('unavailable');
  } finally { if (previous === undefined) delete process.env.APPWRITE_API_KEY; else process.env.APPWRITE_API_KEY = previous; }
});
test('public card exceptions are exact paths/methods and never exempt server actions', () => {
  fc.assert(fc.property(fc.constantFrom('GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'), method => {
    expect(bypassCrmGate('/share/client', method, false)).toBe(['GET', 'HEAD'].includes(method));
    expect(bypassCrmGate('/api/public/client-card', method, false)).toBe(method === 'POST');
    expect(bypassCrmGate('/share/client', method, true)).toBe(false);
    expect(bypassCrmGate('/api/public/client-card', method, true)).toBe(false);
    expect(bypassCrmGate('/share/client/other', method, false)).toBe(false);
    expect(bypassCrmGate('/api/public/client-card/other', method, false)).toBe(false);
  }));
});
