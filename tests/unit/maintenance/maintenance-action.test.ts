const mockGetUser = jest.fn();
const mockCreateAdminClient = jest.fn();
const mockGetStatus = jest.fn();
const mockListAll = jest.fn();

jest.mock('node-appwrite', () => ({ Query: {
  select: jest.fn(() => 'select'), orderAsc: jest.fn(() => 'order'),
} }));
jest.mock('@/lib/server/current-user', () => ({ getAuthenticatedUserDoc: () => mockGetUser() }));
jest.mock('@/lib/server/appwrite', () => ({ createAdminClient: () => mockCreateAdminClient() }));
jest.mock('@/lib/server/appwrite-pagination', () => ({ listAllDocuments: () => mockListAll() }));
jest.mock('@/lib/server/maintenance', () => ({
  MAINTENANCE_SETTINGS_ID: 'global',
  isMaintenanceManager: (actor: { $id: string; email: string; role: string }) =>
    actor.$id === '698a5e64002675ad41f6' && actor.email === 'abhirupvizva@gmail.com' && actor.role === 'admin',
  getMaintenanceStatus: () => mockGetStatus(),
}));

test('turning maintenance on revokes every other CRM session and preserves the manager', async () => {
  const deleteSessions = jest.fn().mockResolvedValue(undefined);
  const updateDocument = jest.fn().mockResolvedValue({});
  mockGetUser.mockResolvedValue({ $id: '698a5e64002675ad41f6',
    email: 'abhirupvizva@gmail.com', role: 'admin' });
  mockCreateAdminClient.mockResolvedValue({ databases: {
    updateDocument, clearReadCacheForCollection: jest.fn(),
  }, users: { deleteSessions } });
  mockGetStatus.mockResolvedValueOnce({ active: false, enabled: false, endsAt: null })
    .mockResolvedValueOnce({ active: true, enabled: true, endsAt: '2099-10-14T19:00:00.000Z' });
  mockListAll.mockResolvedValue([{ $id: '698a5e64002675ad41f6' }, { $id: 'agent-1' }, { $id: 'agent-2' }]);

  const { setMaintenanceModeAction } = await import('@/app/actions/maintenance');
  const result = await setMaintenanceModeAction({ enabled: true, endsAtEastern: '2099-10-14T15:00' });
  expect(updateDocument).toHaveBeenCalledTimes(1);
  expect(deleteSessions).toHaveBeenCalledTimes(2);
  expect(deleteSessions).toHaveBeenCalledWith('agent-1');
  expect(deleteSessions).toHaveBeenCalledWith('agent-2');
  expect(deleteSessions).not.toHaveBeenCalledWith('698a5e64002675ad41f6');
  expect(result.signedOut).toBe(2);
});

test('another admin cannot turn maintenance on', async () => {
  mockGetUser.mockResolvedValue({ $id: 'someone-else', email: 'someone@example.com', role: 'admin' });
  const { setMaintenanceModeAction } = await import('@/app/actions/maintenance');
  await expect(setMaintenanceModeAction({ enabled: true, endsAtEastern: '2099-10-14T15:00' }))
    .rejects.toThrow('Unauthorized');
});
