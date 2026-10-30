/** @jest-environment node */
import fc from 'fast-check';
import { appwriteCacheKey } from '@/lib/server/appwrite-cache-key';

afterEach(() => jest.restoreAllMocks());

it('isolates cache entries across credential rotations, deployments and query scopes', () => {
  const env = { ...process.env, APPWRITE_API_KEY: 'cache-test-key',
    NEXT_PUBLIC_APPWRITE_ENDPOINT: 'https://appwrite.example/v1', NEXT_PUBLIC_APPWRITE_PROJECT_ID: 'test-project' };
  jest.replaceProperty(process, 'env', env);
  fc.assert(fc.property(fc.string({ minLength: 1 }), fc.jsonValue(), (suffix, query) => {
    const baseline = appwriteCacheKey('security-database-read', 'database', query);
    expect(appwriteCacheKey('security-database-read', 'database', query)).toBe(baseline);
    for (const field of ['APPWRITE_API_KEY', 'NEXT_PUBLIC_APPWRITE_ENDPOINT', 'NEXT_PUBLIC_APPWRITE_PROJECT_ID'] as const) {
      const original = env[field];
      env[field] = original + suffix;
      expect(appwriteCacheKey('security-database-read', 'database', query)).not.toBe(baseline);
      env[field] = original;
    }
    expect(appwriteCacheKey('change-markers', 'database', query)).not.toBe(baseline);
    expect(appwriteCacheKey('security-database-read', 'database' + suffix, query)).not.toBe(baseline);
    expect(appwriteCacheKey('security-database-read', 'database', [query])).not.toBe(baseline);
    expect(baseline).toMatch(/^[a-f0-9]{64}$/);
  }));
});
