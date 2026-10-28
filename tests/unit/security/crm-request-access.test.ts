/** @jest-environment node */
const mockAccount = { get: jest.fn(), getSession: jest.fn() };
const mockDb = { getDocument: jest.fn(), listDocuments: jest.fn() };
jest.mock('node-appwrite', () => ({
  Client: class { setEndpoint() { return this; } setProject() { return this; } setKey() { return this; } setJWT() { return this; } },
  Account: jest.fn(() => mockAccount), Databases: jest.fn(() => mockDb),
  Query: { equal: jest.fn((key, value) => JSON.stringify({ key, value })), limit: jest.fn(value => String(value)) },
}));
let mockPassHeader: string | null = null;
const mockReadAccessPass = jest.fn((): unknown => null);
jest.mock('next/headers', () => ({ cookies: async () => ({ get: (name: string) => ({ value: name === 'crm_appwrite_jwt' ? 'jwt' : 'proof' }) }),
  headers: async () => ({ get: (name: string) => name === 'x-crm-access-pass' ? mockPassHeader : null }) }));
jest.mock('@/lib/server/crm-access-pass', () => ({ readAccessPass: (...args: unknown[]) => (mockReadAccessPass as (...a: unknown[]) => unknown)(...args), signAccessPass: () => 'pass' }));
jest.mock('@/lib/server/appwrite', () => ({ createAdminClient: async () => ({ databases: { clearReadCacheForCollection: jest.fn() } }) }));
jest.mock('@/lib/server/maintenance', () => ({ getRequestMaintenanceStatus: async () => ({ active: false }) }));
import { assertCrmAccess } from '@/lib/server/crm-access';
import { getAuthenticatedUserDoc } from '@/lib/server/current-user';
import { withCrmRequestContext } from '@/lib/server/crm-request-context';
const originalFlag = process.env.CRM_ACCESS_ENFORCEMENT;
beforeEach(() => {
  jest.useFakeTimers().setSystemTime(new Date('2026-10-23T15:00:00Z'));
  process.env.CRM_ACCESS_ENFORCEMENT = 'true'; jest.clearAllMocks(); mockPassHeader = null; mockReadAccessPass.mockReturnValue(null);
  mockAccount.get.mockResolvedValue({ $id: 'person', email: 'person@example.com', mfa: true, emailVerification: true });
  mockAccount.getSession.mockResolvedValue({ $id: 'session', userId: 'person', factors: ['password', 'email'], mfaUpdatedAt: '2026-10-23T14:00:00Z', expire: '2026-10-24T00:00:00Z' });
  mockDb.getDocument.mockResolvedValue({ $id: 'person', name: 'Person', department: 'resume', role: 'agent', email: 'person@example.com', isActive: true });
  mockDb.listDocuments.mockResolvedValue({ documents: [{ userId: 'person', present: true }] });
});
afterEach(() => { jest.useRealTimers(); if (originalFlag === undefined) delete process.env.CRM_ACCESS_ENFORCEMENT; else process.env.CRM_ACCESS_ENFORCEMENT = originalFlag; });

it('uses one live profile and native MFA lookup for an entire save, preserving department', async () => {
  await withCrmRequestContext(async () => {
    expect(await getAuthenticatedUserDoc()).toMatchObject({ $id: 'person', department: 'resume' });
    expect(await getAuthenticatedUserDoc()).toMatchObject({ email: 'person@example.com', isActive: true });
    await assertCrmAccess(); await assertCrmAccess();
  });
  expect(mockAccount.get).toHaveBeenCalledTimes(1);
  expect(mockAccount.getSession).toHaveBeenCalledTimes(1);
  expect(mockDb.getDocument).toHaveBeenCalledTimes(1);
  expect(mockDb.listDocuments).not.toHaveBeenCalled();
});

it('does not read the profile twice in a server action without an explicit request-context wrapper', async () => {
  expect(await getAuthenticatedUserDoc()).toMatchObject({ $id: 'person', department: 'resume' });
  expect(mockAccount.get).toHaveBeenCalledTimes(1);
  expect(mockAccount.getSession).toHaveBeenCalledTimes(1);
  expect(mockDb.getDocument).toHaveBeenCalledTimes(1);
});

it('rechecks activation on the next unwrapped action instead of keeping a settled profile cache', async () => {
  expect(await getAuthenticatedUserDoc()).toMatchObject({ isActive: true });
  mockDb.getDocument.mockResolvedValueOnce({ $id: 'person', email: 'person@example.com', isActive: false });
  await expect(getAuthenticatedUserDoc()).rejects.toThrow('inactive');
  expect(mockAccount.get).toHaveBeenCalledTimes(2);
  expect(mockDb.getDocument).toHaveBeenCalledTimes(2);
});

it('allows absence without querying attendance on later requests', async () => {
  await withCrmRequestContext(() => assertCrmAccess());
  mockDb.listDocuments.mockResolvedValue({ documents: [{ userId: 'person', present: false }] });
  await expect(withCrmRequestContext(() => assertCrmAccess())).resolves.toBeDefined();
  expect(mockDb.listDocuments).not.toHaveBeenCalled();
});

it('rejects deactivation and native session revocation on later requests', async () => {
  await withCrmRequestContext(() => getAuthenticatedUserDoc());
  mockDb.getDocument.mockResolvedValueOnce({ $id: 'person', isActive: false });
  await expect(withCrmRequestContext(() => getAuthenticatedUserDoc())).rejects.toThrow('inactive');
  mockAccount.get.mockRejectedValueOnce(new Error('revoked'));
  await expect(withCrmRequestContext(() => getAuthenticatedUserDoc())).rejects.toThrow('sign in again');
});

it('reuses the proxy decision for the same request without re-reading the profile or attendance', async () => {
  mockPassHeader = 'signed-pass';
  mockReadAccessPass.mockReturnValue({ accountId: 'person', sessionId: 'session', dateKey: '2026-10-23',
    status: { state: 'allowed', dateKey: '2026-10-23', requestId: 'cover-1', actingAs: 'Cover' },
    user: { $id: 'person', name: 'Person', department: 'resume', role: 'agent', email: 'person@example.com', isActive: true } });
  await withCrmRequestContext(async () => {
    expect(await getAuthenticatedUserDoc()).toMatchObject({ $id: 'person', department: 'resume' });
    await assertCrmAccess();
  });
  expect(mockReadAccessPass).toHaveBeenCalledWith('signed-pass', 'person', 'session');
  expect(mockAccount.get).toHaveBeenCalledTimes(1);
  expect(mockDb.getDocument).not.toHaveBeenCalled();
  expect(mockDb.listDocuments).not.toHaveBeenCalled();
});

it('does not let an internal proxy pass bypass the native 12-hour MFA expiry', async () => {
  mockPassHeader = 'signed-pass';
  mockReadAccessPass.mockReturnValue({ accountId: 'person', sessionId: 'session', dateKey: '2026-10-23',
    status: { state: 'allowed', dateKey: '2026-10-23' }, user: { $id: 'person', role: 'agent', email: 'person@example.com', isActive: true } });
  mockAccount.getSession.mockResolvedValue({ $id: 'session', userId: 'person', factors: ['password', 'email'],
    mfaUpdatedAt: '2026-10-22T14:00:00Z', expire: '2026-10-24T00:00:00Z' });
  await expect(withCrmRequestContext(() => assertCrmAccess())).rejects.toThrow('sign-in code');
  expect(mockDb.listDocuments).not.toHaveBeenCalled();
});
