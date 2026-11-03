import { identityCacheMs } from '@/lib/server/crm-identity-cache';

const original = process.env.CRM_IDENTITY_CACHE_MS;
afterEach(() => { if (original === undefined) delete process.env.CRM_IDENTITY_CACHE_MS; else process.env.CRM_IDENTITY_CACHE_MS = original; });

it('defaults to four minutes so an idle tab\'s 3-minute change poll reuses the checked identity', () => {
  delete process.env.CRM_IDENTITY_CACHE_MS;
  expect(identityCacheMs()).toBe(240_000);
});
it('can be switched off, and is capped at five minutes', () => {
  for (const [value, expected] of [['0', 0], ['-5', 0], ['abc', 0], ['900000', 300_000], ['60000', 60_000]] as const) {
    process.env.CRM_IDENTITY_CACHE_MS = value;
    expect(identityCacheMs()).toBe(expected);
  }
});
