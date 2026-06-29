const mockAssertAuthenticatedUserId = jest.fn();
const mockCreateAdminClient = jest.fn();
const mockGetDocument = jest.fn();
const mockUpdateDocument = jest.fn();
const mockListDocuments = jest.fn();
const mockUsersUpdateStatus = jest.fn();

jest.mock('@/lib/server/current-user', () => ({
  assertAuthenticatedUserId: (...args: unknown[]) => mockAssertAuthenticatedUserId(...args),
}));

jest.mock('@/lib/server/appwrite', () => ({
  createAdminClient: () => mockCreateAdminClient(),
  createSessionClient: jest.fn(),
}));

jest.mock('node-appwrite', () => ({
  ID: {
    unique: jest.fn(() => 'unique-id'),
  },
  Permission: {
    read: jest.fn((role) => `read:${role}`),
    update: jest.fn((role) => `update:${role}`),
    delete: jest.fn((role) => `delete:${role}`),
  },
  Query: {
    equal: jest.fn((key, value) => `equal:${key}:${JSON.stringify(value)}`),
    limit: jest.fn((limit) => `limit:${limit}`),
  },
  Role: {
    user: jest.fn((userId) => `user:${userId}`),
    label: jest.fn((label) => `label:${label}`),
    any: jest.fn(() => 'any'),
  },
}));

describe('setAgentActiveAction authorization and cascading deactivation', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    process.env.NEXT_PUBLIC_APPWRITE_DATABASE_ID = 'database';
    process.env.NEXT_PUBLIC_APPWRITE_USERS_COLLECTION_ID = 'users';
    process.env.NEXT_PUBLIC_APPWRITE_AUDIT_LOGS_COLLECTION_ID = 'audit';
    process.env.NEXT_PUBLIC_APPWRITE_LINKEDIN_ACCOUNTS_COLLECTION_ID = 'linkedin_accounts';

    mockCreateAdminClient.mockResolvedValue({
      users: {
        updateStatus: mockUsersUpdateStatus,
      },
      databases: {
        getDocument: mockGetDocument,
        updateDocument: mockUpdateDocument,
        listDocuments: mockListDocuments,
        getAttribute: jest.fn().mockResolvedValue({}),
        createDocument: jest.fn().mockResolvedValue({}),
      },
    });

    // Default mock response for lists/documents
    mockListDocuments.mockResolvedValue({ documents: [], total: 0 });
  });

  it('allows admin to toggle active status of any agent', async () => {
    mockAssertAuthenticatedUserId.mockResolvedValue({ $id: 'admin-1' });

    // Mock caller is admin
    mockGetDocument.mockImplementation(async (db, coll, id) => {
      if (id === 'admin-1') {
        return { $id: 'admin-1', role: 'admin', name: 'Admin' };
      }
      if (id === 'agent-1') {
        return { $id: 'agent-1', role: 'agent', name: 'Agent', teamLeadId: 'tl-1' };
      }
      return null;
    });

    const { setAgentActiveAction } = await import('@/app/actions/user');

    await setAgentActiveAction({
      currentUserId: 'admin-1',
      userId: 'agent-1',
      isActive: false,
    });

    expect(mockUsersUpdateStatus).toHaveBeenCalledWith('agent-1', false);
    expect(mockUpdateDocument).toHaveBeenCalledWith(
      expect.any(String),
      'users',
      'agent-1',
      expect.objectContaining({ isActive: false, teamLeadId: null })
    );
  });

  it('allows team lead to toggle active status of agent on their team', async () => {
    mockAssertAuthenticatedUserId.mockResolvedValue({ $id: 'tl-1' });

    // Mock caller is team_lead, target is on their team
    mockGetDocument.mockImplementation(async (db, coll, id) => {
      if (id === 'tl-1') {
        return { $id: 'tl-1', role: 'team_lead', name: 'Team Lead' };
      }
      if (id === 'agent-1') {
        return { $id: 'agent-1', role: 'agent', name: 'Agent', teamLeadId: 'tl-1' };
      }
      return null;
    });

    const { setAgentActiveAction } = await import('@/app/actions/user');

    await setAgentActiveAction({
      currentUserId: 'tl-1',
      userId: 'agent-1',
      isActive: false,
    });

    expect(mockUsersUpdateStatus).toHaveBeenCalledWith('agent-1', false);
  });

  it('rejects team lead attempting to toggle agent not on their team', async () => {
    mockAssertAuthenticatedUserId.mockResolvedValue({ $id: 'tl-1' });

    // Mock caller is team_lead, target is on another team (tl-2)
    mockGetDocument.mockImplementation(async (db, coll, id) => {
      if (id === 'tl-1') {
        return { $id: 'tl-1', role: 'team_lead', name: 'Team Lead' };
      }
      if (id === 'agent-2') {
        return { $id: 'agent-2', role: 'agent', name: 'Agent', teamLeadId: 'tl-2' };
      }
      return null;
    });

    const { setAgentActiveAction } = await import('@/app/actions/user');

    await expect(
      setAgentActiveAction({
        currentUserId: 'tl-1',
        userId: 'agent-2',
        isActive: false,
      })
    ).rejects.toThrow('You can only update the active status of agents on your team');
  });

  it('deactivates LinkedIn accounts when agent is set inactive', async () => {
    mockAssertAuthenticatedUserId.mockResolvedValue({ $id: 'admin-1' });

    mockGetDocument.mockImplementation(async (db, coll, id) => {
      if (id === 'admin-1') {
        return { $id: 'admin-1', role: 'admin', name: 'Admin' };
      }
      if (id === 'agent-1') {
        return { $id: 'agent-1', role: 'agent', name: 'Agent', teamLeadId: 'tl-1' };
      }
      return null;
    });

    // Mock returning some LinkedIn accounts
    mockListDocuments.mockResolvedValue({
      documents: [
        { $id: 'li-acc-1', assignedUserId: 'agent-1', idName: 'LI Account 1' },
      ],
      total: 1,
    });

    const { setAgentActiveAction } = await import('@/app/actions/user');

    await setAgentActiveAction({
      currentUserId: 'admin-1',
      userId: 'agent-1',
      isActive: false,
    });

    // Verify listDocuments was called for linkedin accounts
    expect(mockListDocuments).toHaveBeenCalledWith(
      expect.any(String),
      'linkedin_accounts',
      expect.any(Array)
    );

    // Verify updateDocument deactivated the linkedin account
    expect(mockUpdateDocument).toHaveBeenCalledWith(
      expect.any(String),
      'linkedin_accounts',
      'li-acc-1',
      { isActive: false }
    );
  });
});
