import { removeUserFromBranch, updateUserRole } from '@/lib/services/user-service';
import { updateUserAction } from '@/app/actions/user';
import { account, databases, invalidateCollectionReads } from '@/lib/appwrite';

jest.mock('@/app/actions/user', () => ({ updateUserAction: jest.fn() }));
jest.mock('@/lib/appwrite', () => ({ account: { get: jest.fn() }, databases: { getDocument: jest.fn(), updateDocument: jest.fn() },
  DATABASE_ID: 'db', COLLECTIONS: {}, invalidateCollectionReads: jest.fn() }));
let userDoc: Record<string, unknown>;
beforeEach(() => {
  jest.clearAllMocks();
  userDoc = { $id: 'agent', name: 'Agent', email: 'agent@example.com', role: 'agent', department: 'sales', branchIds: ['one', 'two'], primaryBranchId: 'one' };
  (account.get as jest.Mock).mockResolvedValue({ $id: 'admin' });
  (databases.getDocument as jest.Mock).mockImplementation(async () => userDoc);
  (updateUserAction as jest.Mock).mockImplementation(async input => { userDoc = { ...userDoc, ...input }; return { success: true }; });
});
it('routes role changes through the authenticated action and invalidates browser reads', async () => {
  expect((await updateUserRole('agent', 'team_lead')).role).toBe('team_lead');
  expect(updateUserAction).toHaveBeenCalledWith({ userId: 'agent', role: 'team_lead', currentUserId: 'admin' });
  expect(databases.updateDocument).not.toHaveBeenCalled();
  expect(invalidateCollectionReads).toHaveBeenCalled();
});
it('keeps branch removal working after browser user-write permissions are removed', async () => {
  await removeUserFromBranch('agent', 'one');
  expect(updateUserAction).toHaveBeenCalledWith(expect.objectContaining({ userId: 'agent', branchIds: ['two'], primaryBranchId: 'two', currentUserId: 'admin' }));
  expect(databases.updateDocument).not.toHaveBeenCalled();
});
