jest.mock('@/lib/server/current-user', () => ({ getAuthenticatedUserDoc: jest.fn() }));
jest.mock('@/lib/server/appwrite', () => ({ createAdminClient: jest.fn() }));
jest.mock('@/lib/server/appwrite-pagination', () => ({ listAllDocuments: jest.fn() }));
jest.mock('@/lib/services/audit-service', () => ({ logAction: jest.fn() }));
jest.mock('node-appwrite', () => ({ Query: { select: (value: unknown) => JSON.stringify(value), orderAsc: (value: unknown) => value, equal: (key: string, value: unknown) => JSON.stringify({ key, value }) } }));

import fc from 'fast-check';
import { getAuthenticatedUserDoc } from '@/lib/server/current-user';
import { getMyLinkedinHelperAccessAction, setLinkedinHelperBetaAccessAction, listLinkedinHelperBetaUsersAction } from '@/app/actions/beta';
import { canUseLinkedinExtension } from '@/lib/server/linkedin-extension-policy';
import { VALID_ROLES } from '@/lib/types';
import { createAdminClient } from '@/lib/server/appwrite';
import { betaAccessDocumentId, LINKEDIN_HELPER_FEATURE } from '@/lib/server/beta-feature-access';
import { COLLECTIONS, DATABASE_ID } from '@/lib/constants/appwrite';
import { listAllDocuments } from '@/lib/server/appwrite-pagination';

const databases = { clearReadCacheForCollection: jest.fn(), getDocument: jest.fn(), updateDocument: jest.fn(), createDocument: jest.fn() };
const agent = { $id: 'agent', name: 'Agent', role: 'agent', department: 'sales', isActive: true };
beforeEach(() => {
  jest.resetAllMocks();
  (createAdminClient as jest.Mock).mockResolvedValue({ databases });
  (getAuthenticatedUserDoc as jest.Mock).mockResolvedValue({ $id: 'admin', name: 'Admin', role: 'admin', isActive: true });
  databases.getDocument.mockResolvedValue(agent);
});

it('requires an explicit grant as well as active Sales eligibility for every role', async () => {
  await fc.assert(fc.asyncProperty(fc.constantFrom(...VALID_ROLES), fc.constantFrom('sales', 'resume'), fc.boolean(), fc.boolean(),
    async (role, department, isActive, enabled) => {
      const actor = { ...agent, role, department: department as 'sales' | 'resume', isActive };
      (getAuthenticatedUserDoc as jest.Mock).mockResolvedValue(actor);
      databases.getDocument.mockResolvedValue({ userId: agent.$id, feature: LINKEDIN_HELPER_FEATURE, enabled });
      expect(await getMyLinkedinHelperAccessAction()).toBe(canUseLinkedinExtension(actor) && enabled);
    }));
});

it('rejects missing, retired-feature and other-user grants; observes revocation without a cached grant', async () => {
  (getAuthenticatedUserDoc as jest.Mock).mockResolvedValue(agent);
  databases.getDocument.mockRejectedValueOnce({ code: 404 });
  expect(await getMyLinkedinHelperAccessAction()).toBe(false);
  for (const record of [
    { feature: 'linkedin-helper', userId: 'agent', enabled: true },
    { feature: LINKEDIN_HELPER_FEATURE, userId: 'other', enabled: true },
    { feature: LINKEDIN_HELPER_FEATURE, userId: 'agent', enabled: true },
    { feature: LINKEDIN_HELPER_FEATURE, userId: 'agent', enabled: false },
  ]) databases.getDocument.mockResolvedValueOnce(record);
  for (const expected of [false, false, true, false]) expect(await getMyLinkedinHelperAccessAction()).toBe(expected);
  expect(databases.getDocument).toHaveBeenCalledWith(DATABASE_ID, COLLECTIONS.BETA_FEATURE_ACCESS, betaAccessDocumentId('agent'));
  expect(databases.clearReadCacheForCollection).toHaveBeenCalledWith(COLLECTIONS.BETA_FEATURE_ACCESS);
  databases.getDocument.mockRejectedValue({ code: 503 });
  await expect(getMyLinkedinHelperAccessAction()).rejects.toEqual({ code: 503 });
});

it('only active admins may list or mutate grants regardless of requested enablement', async () => {
  await fc.assert(fc.asyncProperty(fc.constantFrom(...VALID_ROLES), fc.boolean(), fc.boolean(), async (role, isActive, enabled) => {
    databases.updateDocument.mockClear();
    (getAuthenticatedUserDoc as jest.Mock).mockResolvedValue({ role, isActive });
    if (role !== 'admin' || !isActive) {
      await expect(setLinkedinHelperBetaAccessAction('agent', enabled)).rejects.toThrow('Only active admins');
      await expect(listLinkedinHelperBetaUsersAction()).rejects.toThrow('Only active admins');
      expect(databases.updateDocument).not.toHaveBeenCalled();
    }
  }));
});

it('does not grant beta to any ineligible target and permits revocation after deactivation', async () => {
  await fc.assert(fc.asyncProperty(fc.constantFrom(...VALID_ROLES), fc.constantFrom('sales', 'resume'), fc.boolean(), async (role, department, isActive) => {
    const target = { ...agent, role, department, isActive };
    databases.getDocument.mockResolvedValue(target);
    databases.updateDocument.mockClear();
    if (canUseLinkedinExtension(target)) {
      await expect(setLinkedinHelperBetaAccessAction('agent', true)).resolves.toEqual({ enabled: true });
    } else {
      await expect(setLinkedinHelperBetaAccessAction('agent', true)).rejects.toThrow('active Sales');
      expect(databases.updateDocument).not.toHaveBeenCalled();
    }
    await expect(setLinkedinHelperBetaAccessAction('agent', false)).resolves.toEqual({ enabled: false });
  }));
});

it('creates a server-managed grant and invalidates access; handles a concurrent first grant', async () => {
  databases.updateDocument.mockRejectedValueOnce({ code: 404 });
  databases.createDocument.mockRejectedValueOnce({ code: 409 });
  await expect(setLinkedinHelperBetaAccessAction('agent', true)).resolves.toEqual({ enabled: true });
  expect(databases.createDocument).toHaveBeenCalledWith(DATABASE_ID, COLLECTIONS.BETA_FEATURE_ACCESS, betaAccessDocumentId('agent'),
    { feature: LINKEDIN_HELPER_FEATURE, userId: 'agent', enabled: true }, []);
  expect(databases.updateDocument).toHaveBeenCalledTimes(2);
  expect(databases.clearReadCacheForCollection).toHaveBeenCalledWith(COLLECTIONS.BETA_FEATURE_ACCESS);
});

it('lists eligible users and grants needing revocation without exposing full documents', async () => {
  (listAllDocuments as jest.Mock).mockImplementation(async ({ collectionId }) => collectionId === COLLECTIONS.USERS ?
    [agent, { ...agent, $id: 'inactive', isActive: false }, { ...agent, $id: 'resume', department: 'resume' }] :
    [{ userId: 'inactive', enabled: true }]);
  expect(await listLinkedinHelperBetaUsersAction()).toEqual([
    { id: 'agent', name: 'Agent', email: undefined, role: 'agent', eligible: true, enabled: false },
    { id: 'inactive', name: 'Agent', email: undefined, role: 'agent', eligible: false, enabled: true },
  ]);
});
