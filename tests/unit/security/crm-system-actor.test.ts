import { createAdminClient } from '@/lib/server/appwrite';
import { withLeadHistory } from '@/lib/server/lead-history';
import { getAuthenticatedAccount } from '@/lib/server/current-user';
jest.mock('node-appwrite', () => ({
  Client: class { setEndpoint() { return this; } setProject() { return this; } setKey() { return this; } },
  Databases: class {},
}));
jest.mock('next/headers', () => ({ cookies: jest.fn() }));
jest.mock('@/lib/server/current-user', () => ({ getAuthenticatedAccount: jest.fn() }));
jest.mock('@/lib/server/lead-history', () => ({ withLeadHistory: jest.fn(db => db) }));
jest.mock('@/lib/server/server-owned-permissions', () => ({ withServerOwnedPermissions: (db: unknown) => db }));
jest.mock('@/lib/utils/appwrite-read-cache', () => ({ createAppwriteReadCacheStores: () => ({}), createReadThroughDatabases: (db: unknown) => db }));
const oldFlag = process.env.CRM_ACCESS_ENFORCEMENT;
afterEach(() => { if (oldFlag === undefined) delete process.env.CRM_ACCESS_ENFORCEMENT; else process.env.CRM_ACCESS_ENFORCEMENT = oldFlag; });
it('retains a named audit actor for an explicitly authenticated internal job', async () => {
  const actor = { id: 'system', name: 'Scheduled LinkedIn withdrawal' };
  void (await createAdminClient({ systemActor: actor })).databases;
  const actorProvider = (withLeadHistory as jest.Mock).mock.calls.at(-1)![1];
  expect(await actorProvider()).toEqual(actor);
});
it('does not silently replace a blocked ordinary actor with System', async () => {
  process.env.CRM_ACCESS_ENFORCEMENT = 'true';
  (getAuthenticatedAccount as jest.Mock).mockRejectedValue(new Error('Attendance required'));
  void (await createAdminClient()).databases;
  const actorProvider = (withLeadHistory as jest.Mock).mock.calls.at(-1)![1];
  await expect(actorProvider()).rejects.toThrow('Attendance required');
});
