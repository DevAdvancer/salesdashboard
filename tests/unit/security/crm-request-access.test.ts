/** @jest-environment node */
const mockAccount = { get: jest.fn(), getSession: jest.fn() };
const mockDb = { getDocument: jest.fn(), listDocuments: jest.fn() };
jest.mock('node-appwrite', () => ({
  Client: class { setEndpoint() { return this; } setProject() { return this; } setKey() { return this; } setJWT() { return this; } },
  Account: jest.fn(() => mockAccount), Databases: jest.fn(() => mockDb),
  Query: { equal: jest.fn((key, value) => JSON.stringify({ key, value })), limit: jest.fn(value => String(value)) },
}));
jest.mock('next/headers', () => ({ cookies: async () => ({ get: (name: string) => ({ value: name === 'crm_appwrite_jwt' ? 'jwt' : 'proof' }) }) }));
jest.mock('@/lib/server/crm-security-store', () => ({ CRM_PROOF_COOKIE: 'crm_email_verified', validProof: () => true }));
jest.mock('@/lib/server/appwrite', () => ({ createAdminClient: async () => ({ databases: { clearReadCacheForCollection: jest.fn() } }) }));
jest.mock('@/lib/server/maintenance', () => ({ getRequestMaintenanceStatus: async () => ({ active: false }) }));
import { assertCrmAccess } from '@/lib/server/crm-access';
import { getAuthenticatedUserDoc } from '@/lib/server/current-user';
import { withCrmRequestContext } from '@/lib/server/crm-request-context';
const originalFlag = process.env.CRM_ACCESS_ENFORCEMENT;
beforeEach(() => {
  jest.useFakeTimers().setSystemTime(new Date('2026-10-23T15:00:00Z'));
  process.env.CRM_ACCESS_ENFORCEMENT = 'true'; jest.clearAllMocks();
  mockAccount.get.mockResolvedValue({ $id: 'person', email: 'person@example.com' });
  mockAccount.getSession.mockResolvedValue({ $id: 'session' });
  mockDb.getDocument.mockResolvedValue({ $id: 'person', name: 'Person', department: 'resume', role: 'agent', isActive: true });
  mockDb.listDocuments.mockResolvedValue({ documents: [{ userId: 'person', present: true }] });
});
afterEach(() => { jest.useRealTimers(); if (originalFlag === undefined) delete process.env.CRM_ACCESS_ENFORCEMENT; else process.env.CRM_ACCESS_ENFORCEMENT = originalFlag; });

it('uses one live profile and attendance lookup for an entire save, preserving department', async () => {
  await withCrmRequestContext(async () => {
    expect(await getAuthenticatedUserDoc()).toMatchObject({ $id: 'person', department: 'resume' });
    expect(await getAuthenticatedUserDoc()).toMatchObject({ isActive: true });
    await assertCrmAccess(); await assertCrmAccess();
  });
  expect(mockAccount.get).toHaveBeenCalledTimes(1);
  expect(mockAccount.getSession).toHaveBeenCalledTimes(1);
  expect(mockDb.getDocument).toHaveBeenCalledTimes(1);
  expect(mockDb.listDocuments).toHaveBeenCalledTimes(1);
});

it('rejects removed attendance on the very next request', async () => {
  await withCrmRequestContext(() => assertCrmAccess());
  mockDb.listDocuments.mockResolvedValue({ documents: [{ userId: 'person', present: false }] });
  await expect(withCrmRequestContext(() => assertCrmAccess())).rejects.toThrow('mark you present');
  expect(mockAccount.get).toHaveBeenCalledTimes(2);
});

it('rejects deactivation and native session revocation on later requests', async () => {
  await withCrmRequestContext(() => getAuthenticatedUserDoc());
  mockDb.getDocument.mockResolvedValueOnce({ $id: 'person', isActive: false });
  await expect(withCrmRequestContext(() => getAuthenticatedUserDoc())).rejects.toThrow('inactive');
  mockAccount.get.mockRejectedValueOnce(new Error('revoked'));
  await expect(withCrmRequestContext(() => getAuthenticatedUserDoc())).rejects.toThrow('sign in again');
});
