export {};

const mockAssertAuthenticatedUserId = jest.fn();
const mockCreateAdminClient = jest.fn();
const mockUsersCreate = jest.fn();
const mockUsersDelete = jest.fn();
const mockUsersUpdateMfa = jest.fn();
const mockGetDocument = jest.fn();
const mockCreateDocument = jest.fn();
const mockListDocuments = jest.fn();
const mockUpdateDocument = jest.fn();

jest.mock('@/lib/server/current-user', () => ({
  assertAuthenticatedUserId: (...args: unknown[]) => mockAssertAuthenticatedUserId(...args),
}));

jest.mock('@/lib/server/appwrite', () => ({
  createAdminClient: () => mockCreateAdminClient(),
  createSessionClient: jest.fn(),
}));

jest.mock('node-appwrite', () => ({
  ID: {
    unique: jest.fn(() => 'new-user-id'),
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

// The retired attributes are the legacy `manager` / `assistant_manager` fields
// that `teamLeadId` replaced. A blanket manager -> teamLead rename (commit
// 9b76b2a) rewrote `managerId` / `managerIds` here into `teamLeadId` /
// `teamLeadIds`, which made every case assert that the live `teamLeadId` field
// must be absent while the objectContaining above requires it. The names below
// are back on the fields that really were retired.
describe('active user role creation actions', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    process.env.NEXT_PUBLIC_APPWRITE_DATABASE_ID = 'database';
    process.env.NEXT_PUBLIC_APPWRITE_USERS_COLLECTION_ID = 'users';
    process.env.NEXT_PUBLIC_APPWRITE_AUDIT_LOGS_COLLECTION_ID = 'audit';

    mockAssertAuthenticatedUserId.mockResolvedValue({ $id: 'admin-1' });
    mockCreateAdminClient.mockResolvedValue({
      users: {
        create: mockUsersCreate,
        delete: mockUsersDelete,
        updateMfa: mockUsersUpdateMfa,
      },
      databases: {
        getDocument: mockGetDocument,
        createDocument: mockCreateDocument,
        listDocuments: mockListDocuments,
        updateDocument: mockUpdateDocument,
      },
    });
    mockUsersCreate.mockResolvedValue({ $id: 'new-user-id' });
    mockCreateDocument.mockResolvedValue({ $id: 'new-user-id' });
    mockGetDocument.mockResolvedValue({
      $id: 'admin-1',
      name: 'Admin User',
      email: 'admin@example.com',
      role: 'admin',
      branchIds: ['branch-1'],
    });
  });

  function getCreatedUserPayload() {
    const userCreateCall = mockCreateDocument.mock.calls.find(
      (call) => call[1] === 'users' && call[2] === 'new-user-id',
    );
    return userCreateCall?.[3] as Record<string, unknown> | undefined;
  }

  it.each(['agent', 'team_lead'] as const)('persists both branches and the selected primary when creating %s', async role => {
    const actions = await import('@/app/actions/user');
    const input = { currentUserId: 'admin-1', name: 'Dual Branch', email: 'dual@example.com',
      password: 'password123', branchIds: ['ahm', 'ncr'], primaryBranchId: 'ncr' };
    if (role === 'agent') await actions.createAgentAction({ ...input, teamLeadId: 'tl-1' });
    else await actions.createTeamLeadAction(input);
    expect(getCreatedUserPayload()).toMatchObject({ branchIds: ['ncr', 'ahm'], primaryBranchId: 'ncr' });
  });

  it('persists a primary-only edit instead of returning success without a write', async () => {
    mockGetDocument.mockResolvedValueOnce({ $id: 'admin-1', role: 'admin', name: 'Admin' })
      .mockResolvedValueOnce({ $id: 'agent', role: 'agent', branchIds: ['ahm', 'ncr'], primaryBranchId: 'ahm' });
    const { updateUserAction } = await import('@/app/actions/user');
    await updateUserAction({ currentUserId: 'admin-1', userId: 'agent', primaryBranchId: 'ncr' });
    expect(mockUpdateDocument).toHaveBeenCalledWith(expect.any(String), 'users', 'agent',
      { branchIds: ['ncr', 'ahm'], primaryBranchId: 'ncr' }, undefined);
  });

  it('rejects a primary branch outside the saved memberships before writing', async () => {
    mockGetDocument.mockResolvedValueOnce({ $id: 'admin-1', role: 'admin', name: 'Admin' })
      .mockResolvedValueOnce({ $id: 'agent', role: 'agent', branchIds: ['ahm'], primaryBranchId: 'ahm' });
    const { updateUserAction } = await import('@/app/actions/user');
    await expect(updateUserAction({ currentUserId: 'admin-1', userId: 'agent', primaryBranchId: 'ncr' })).rejects.toThrow('selected branches');
    expect(mockUpdateDocument).not.toHaveBeenCalled();
  });

  it('creates team leads without retired manager attributes', async () => {
    const { createTeamLeadAction } = await import('@/app/actions/user');

    await createTeamLeadAction({
      currentUserId: 'admin-1',
      name: 'Team Lead',
      email: 'tl@example.com',
      password: 'password123',
      branchIds: ['branch-1'],
    });

    expect(getCreatedUserPayload()).toEqual(
      expect.objectContaining({
        name: 'Team Lead',
        email: 'tl@example.com',
        role: 'team_lead',
        teamLeadId: null,
        branchIds: ['branch-1'],
      }),
    );
    expect(getCreatedUserPayload()).not.toHaveProperty('managerId');
    expect(getCreatedUserPayload()).not.toHaveProperty('managerIds');
    expect(getCreatedUserPayload()).not.toHaveProperty('assistantManagerId');
    expect(getCreatedUserPayload()).not.toHaveProperty('assistantManagerIds');
    expect(mockUsersUpdateMfa).toHaveBeenCalledWith(mockUsersCreate.mock.calls[0][0], true);
  });

  it('still creates the user when native MFA cannot be enabled yet', async () => {
    mockUsersUpdateMfa.mockRejectedValueOnce(new Error('Appwrite unavailable'));
    const { createTeamLeadAction } = await import('@/app/actions/user');
    await createTeamLeadAction({ currentUserId: 'admin-1', name: 'Team Lead', email: 'tl2@example.com', password: 'password123', branchIds: ['branch-1'] });
    expect(mockCreateDocument).toHaveBeenCalled();
  });

  it('creates agents without retired manager attributes', async () => {
    const { createAgentAction } = await import('@/app/actions/user');

    await createAgentAction({
      currentUserId: 'admin-1',
      name: 'Agent User',
      email: 'agent@example.com',
      password: 'password123',
      role: 'agent',
      teamLeadId: 'tl-1',
      branchIds: ['branch-1'],
    });

    expect(getCreatedUserPayload()).toEqual(
      expect.objectContaining({
        name: 'Agent User',
        email: 'agent@example.com',
        role: 'agent',
        teamLeadId: 'tl-1',
        branchIds: ['branch-1'],
      }),
    );
    expect(getCreatedUserPayload()).not.toHaveProperty('managerId');
    expect(getCreatedUserPayload()).not.toHaveProperty('managerIds');
    expect(getCreatedUserPayload()).not.toHaveProperty('assistantManagerId');
    expect(getCreatedUserPayload()).not.toHaveProperty('assistantManagerIds');
  });

  it('creates monitors without retired manager attributes', async () => {
    const { createAgentAction } = await import('@/app/actions/user');

    await createAgentAction({
      currentUserId: 'admin-1',
      name: 'Monitor User',
      email: 'monitor@example.com',
      password: 'password123',
      role: 'monitor',
      branchIds: [],
    });

    expect(getCreatedUserPayload()).toEqual(
      expect.objectContaining({
        name: 'Monitor User',
        email: 'monitor@example.com',
        role: 'monitor',
        teamLeadId: null,
        branchIds: [],
      }),
    );
    expect(getCreatedUserPayload()).not.toHaveProperty('managerId');
    expect(getCreatedUserPayload()).not.toHaveProperty('managerIds');
    expect(getCreatedUserPayload()).not.toHaveProperty('assistantManagerId');
    expect(getCreatedUserPayload()).not.toHaveProperty('assistantManagerIds');
  });

  it('creates operations users without retired manager attributes', async () => {
    const { createAgentAction } = await import('@/app/actions/user');

    await createAgentAction({
      currentUserId: 'admin-1',
      name: 'Operations User',
      email: 'operations@example.com',
      password: 'password123',
      role: 'operations' as any,
      branchIds: [],
    });

    expect(getCreatedUserPayload()).toEqual(
      expect.objectContaining({
        name: 'Operations User',
        email: 'operations@example.com',
        role: 'operations',
        teamLeadId: null,
        branchIds: [],
      }),
    );
    expect(getCreatedUserPayload()).not.toHaveProperty('managerId');
    expect(getCreatedUserPayload()).not.toHaveProperty('managerIds');
    expect(getCreatedUserPayload()).not.toHaveProperty('assistantManagerId');
    expect(getCreatedUserPayload()).not.toHaveProperty('assistantManagerIds');
  });
});
