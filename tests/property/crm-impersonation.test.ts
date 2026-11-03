import fc from 'fast-check';
import { resolveSecurityIdentity, resolveImpersonationOperator, evaluateCrmAccess, accessCookieFor, effectiveCrmAuditActor } from '@/lib/server/crm-access';
import { CRM_IMPERSONATION_COOKIE, APPWRITE_IMPERSONATION_HEADER } from '@/lib/utils/crm-impersonation';

let mockCapability: unknown = true;
let mockMfa = true;
let mockTargetActive = true;
let mockTargetProof = 'operator';
const mockGet = jest.fn();
const now = new Date().toISOString();
const expiry = new Date(Date.now() + 3600_000).toISOString();
jest.mock('next/headers', () => ({ cookies: jest.fn(), headers: jest.fn() }));
jest.mock('node-appwrite', () => ({
  Client: class {
    headers: Record<string, string> = {};
    setEndpoint() { return this; } setProject() { return this; } setKey() { return this; }
    setJWT() { return this; } setSession() { return this; }
    addHeader(key: string, value: string) { this.headers[key] = value; return this; }
  },
  Account: class {
    constructor(private client: { headers: Record<string, string> }) {}
    async get() {
      mockGet();
      const target = this.client.headers[APPWRITE_IMPERSONATION_HEADER];
      return { $id: target || 'operator', email: `${target || 'operator'}@example.com`, name: target || 'Operator',
        status: true, mfa: true, emailVerification: true,
        ...(target ? { impersonatorUserId: mockTargetProof } : { impersonator: mockCapability }) };
    }
    async getSession() { return { $id: 'session', userId: 'operator', factors: mockMfa ? ['password', 'email'] : ['password'], mfaUpdatedAt: now, expire: expiry }; }
  },
  Databases: class {
    async getDocument(_db: string, _collection: string, id: string) {
      return { $id: id, name: id, email: `${id}@example.com`, isActive: id === 'operator' || mockTargetActive, role: 'agent', department: 'sales' };
    }
  },
}));
const reader = (target = 'target') => ({ get: (name: string) => name === CRM_IMPERSONATION_COOKIE ? { value: target }
  : name === 'crm_appwrite_jwt' ? { value: 'native-jwt' } : undefined });
beforeEach(() => { jest.clearAllMocks(); mockCapability = true; mockMfa = true; mockTargetActive = true; mockTargetProof = 'operator'; });

test('only a live native capability plus verified operator MFA permits a target', async () => {
  await fc.assert(fc.asyncProperty(fc.constantFrom(true, false, 'true', 1, null, undefined), fc.boolean(), async (capability, mfa) => {
    mockCapability = capability; mockMfa = mfa;
    if (capability === true && mfa) {
      const identity = await resolveSecurityIdentity(reader());
      expect(identity.user.$id).toBe('target');
      expect(identity.operator?.user.$id).toBe('operator');
      expect((await evaluateCrmAccess(identity)).state).toBe('allowed');
      expect(accessCookieFor(identity, reader())).toBeNull();
    } else await expect(resolveSecurityIdentity(reader())).rejects.toThrow();
  }));
});

test('checks capability again on every request and cannot reuse an allowed identity after revocation', async () => {
  await resolveSecurityIdentity(reader());
  mockCapability = false;
  await expect(resolveSecurityIdentity(reader())).rejects.toThrow('capability');
  expect(mockGet.mock.calls.length).toBeGreaterThanOrEqual(3);
});

test('rejects forged target values, inactive targets and an unconfirmed native impersonation', async () => {
  await fc.assert(fc.asyncProperty(fc.constantFrom('../admin', 'x y', 'x'.repeat(37), 'a\nb'), async target => {
    await expect(resolveSecurityIdentity(reader(target))).rejects.toThrow();
  }));
  mockTargetActive = false;
  await expect(resolveSecurityIdentity(reader())).rejects.toThrow('inactive');
  mockTargetActive = true; mockTargetProof = 'someone-else';
  await expect(resolveSecurityIdentity(reader())).rejects.toThrow('authorize');
});

test('returns the original operator for management and records both identities in CRM audit attribution', async () => {
  const operator = await resolveImpersonationOperator(reader());
  expect(operator.account.$id).toBe('operator');
  const identity = await resolveSecurityIdentity(reader());
  const old = process.env.CRM_ACCESS_ENFORCEMENT;
  process.env.CRM_ACCESS_ENFORCEMENT = 'true';
  try {
    expect(await effectiveCrmAuditActor({ id: 'target', name: 'target' }, identity)).toMatchObject({ id: 'operator', impersonatedUserId: 'target' });
  } finally { if (old === undefined) delete process.env.CRM_ACCESS_ENFORCEMENT; else process.env.CRM_ACCESS_ENFORCEMENT = old; }
});
