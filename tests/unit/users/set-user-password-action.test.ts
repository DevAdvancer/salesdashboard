export {};

const mockAccount = jest.fn();
const mockActor = jest.fn();
const mockGetDocument = jest.fn();
const mockUpdatePassword = jest.fn();
const mockDeleteSessions = jest.fn();
const mockHistory = jest.fn();
let mockImpersonating = false;

jest.mock('@/lib/server/current-user', () => ({
  assertAuthenticatedUserId: jest.fn(),
  getAuthenticatedAccount: () => mockAccount(),
  getAuthenticatedUserDoc: () => mockActor(),
}));
jest.mock('@/lib/server/appwrite', () => ({
  createAdminClient: async () => ({
    users: { updatePassword: mockUpdatePassword, deleteSessions: mockDeleteSessions },
    databases: { getDocument: mockGetDocument, clearReadCacheForCollection: jest.fn() },
  }),
  createSessionClient: jest.fn(),
}));
jest.mock('next/headers', () => ({ cookies: async () => ({ get: (name: string) => name === 'crm_impersonate_user' && mockImpersonating ? { value: 'x' } : undefined }) }));
jest.mock('@/lib/server/lead-history', () => ({ appendLeadHistory: (...args: unknown[]) => mockHistory(...args) }));
jest.mock('node-appwrite', () => ({ ID: { unique: () => 'id' }, Permission: {}, Query: {}, Role: {} }));

const owner = { $id: '698a5e64002675ad41f6', name: 'Owner', role: 'admin', email: 'abhirupvizva@gmail.com', isActive: true };
const admin = { $id: 'admin-2', name: 'Admin', role: 'admin', email: 'admin@example.com', isActive: true };
const people: Record<string, { $id: string; name: string; role: string; email: string }> = {
  agent: { $id: 'agent', name: 'Agent', role: 'agent', email: 'agent@example.com' },
  boss: { $id: 'boss', name: 'Other admin', role: 'admin', email: 'boss@example.com' },
};
function signIn(actor: typeof owner) { mockActor.mockResolvedValue(actor); mockAccount.mockResolvedValue({ $id: actor.$id, email: actor.email }); }

beforeEach(() => {
  jest.clearAllMocks(); mockImpersonating = false;
  process.env.NEXT_PUBLIC_APPWRITE_DATABASE_ID = 'database';
  process.env.NEXT_PUBLIC_APPWRITE_USERS_COLLECTION_ID = 'users';
  mockGetDocument.mockImplementation(async (_db: string, _c: string, id: string) => people[id]);
  mockUpdatePassword.mockResolvedValue({}); mockDeleteSessions.mockResolvedValue({}); mockHistory.mockResolvedValue({});
});

it('lets an admin set an agent password, ends their sessions and records it without the password', async () => {
  signIn(admin);
  const { setUserPasswordAction } = await import('@/app/actions/user');
  await expect(setUserPasswordAction({ userId: 'agent', password: 'new-password-1' })).resolves.toEqual({ success: true });
  expect(mockUpdatePassword).toHaveBeenCalledWith('agent', 'new-password-1');
  expect(mockDeleteSessions).toHaveBeenCalledWith('agent');
  expect(JSON.stringify(mockHistory.mock.calls)).not.toContain('new-password-1');
  expect(mockHistory).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ eventType: 'USER_PASSWORD_SET' }));
});
it('refuses an admin changing another admin, but allows the owner', async () => {
  const { setUserPasswordAction } = await import('@/app/actions/user');
  signIn(admin);
  await expect(setUserPasswordAction({ userId: 'boss', password: 'new-password-1' })).rejects.toThrow('Permission denied');
  signIn(owner);
  await expect(setUserPasswordAction({ userId: 'boss', password: 'new-password-1' })).resolves.toEqual({ success: true });
  expect(mockUpdatePassword).toHaveBeenCalledTimes(1);
});
it('does not treat a profile email the native account does not share as the owner', async () => {
  const { setUserPasswordAction } = await import('@/app/actions/user');
  mockActor.mockResolvedValue(owner); mockAccount.mockResolvedValue({ $id: owner.$id, email: 'someone@example.com' });
  await expect(setUserPasswordAction({ userId: 'boss', password: 'new-password-1' })).rejects.toThrow('Permission denied');
});
it('rejects short passwords and any change while impersonating', async () => {
  signIn(owner);
  const { setUserPasswordAction } = await import('@/app/actions/user');
  await expect(setUserPasswordAction({ userId: 'agent', password: 'short' })).rejects.toThrow('8-256');
  mockImpersonating = true;
  await expect(setUserPasswordAction({ userId: 'agent', password: 'new-password-1' })).rejects.toThrow('Stop impersonating');
  expect(mockUpdatePassword).not.toHaveBeenCalled();
});
