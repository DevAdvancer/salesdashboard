import fc from 'fast-check';
import { deleteUserAction } from '@/app/actions/user';
import { createAdminClient } from '@/lib/server/appwrite';
import { assertAuthenticatedUserId } from '@/lib/server/current-user';
import { CRM_OWNER_EMAIL, CRM_OWNER_USER_ID } from '@/lib/utils/protected-user';

jest.mock('node-appwrite', () => ({ Query: { limit: (value: number) => `limit:${value}` } }));
jest.mock('@/lib/server/appwrite', () => ({ createAdminClient: jest.fn() }));
jest.mock('@/lib/server/current-user', () => ({ assertAuthenticatedUserId: jest.fn() }));

const getAuthUser = jest.fn();
const deleteAuthUser = jest.fn();
const getCaller = jest.fn();
const getTargetProfile = jest.fn();
const listDocuments = jest.fn();
const updateDocument = jest.fn();
const deleteDocument = jest.fn();

beforeEach(() => {
  jest.resetAllMocks();
  jest.mocked(assertAuthenticatedUserId).mockResolvedValue({ $id: 'caller' } as never);
  jest.mocked(createAdminClient).mockResolvedValue({
    users: { get: getAuthUser, delete: deleteAuthUser },
    databases: { getDocument: getCaller, uncachedReads: { getDocument: getTargetProfile },
      listDocuments, updateDocument, deleteDocument },
  } as never);
  listDocuments.mockResolvedValue({ documents: [{ $id: 'member', teamLeadId: 'target' }] });
});

it('blocks every privileged deletion attempt before changing the CRM profile, auth account, or related users', async () => {
  const emailCase = fc.array(fc.boolean(), { minLength: CRM_OWNER_EMAIL.length, maxLength: CRM_OWNER_EMAIL.length });
  await fc.assert(fc.asyncProperty(fc.constantFrom('admin', 'developer'), fc.constantFrom('profile', 'auth', 'id'), emailCase,
    async (role, match, uppercase) => {
      const email = ` ${Array.from(CRM_OWNER_EMAIL, (character, index) => uppercase[index] ? character.toUpperCase() : character).join('')} `;
      const userId = match === 'id' ? CRM_OWNER_USER_ID : 'target';
      getCaller.mockResolvedValue({ $id: 'caller', role });
      getTargetProfile.mockResolvedValue({ $id: userId, email: match === 'profile' ? email : 'profile@example.com', role: 'agent' });
      getAuthUser.mockResolvedValue({ $id: userId, email: match === 'auth' ? email : 'auth@example.com' });

      await expect(deleteUserAction({ currentUserId: 'caller', userId })).rejects.toThrow('protected from deletion');
      expect(listDocuments).not.toHaveBeenCalled();
      expect(updateDocument).not.toHaveBeenCalled();
      expect(deleteDocument).not.toHaveBeenCalled();
      expect(deleteAuthUser).not.toHaveBeenCalled();
    }));
});

it('still deletes an ordinary account and clears the related user reference', async () => {
  getCaller.mockResolvedValue({ $id: 'caller', role: 'admin' });
  getTargetProfile.mockResolvedValue({ $id: 'target', email: 'target@example.com', role: 'agent' });
  getAuthUser.mockResolvedValue({ $id: 'target', email: 'target@example.com' });

  await expect(deleteUserAction({ currentUserId: 'caller', userId: 'target' })).resolves.toEqual({ success: true });
  expect(updateDocument).toHaveBeenCalledWith(expect.any(String), expect.any(String), 'member', { teamLeadId: null });
  expect(deleteDocument).toHaveBeenCalledWith(expect.any(String), expect.any(String), 'target');
  expect(deleteAuthUser).toHaveBeenCalledWith('target');
});
