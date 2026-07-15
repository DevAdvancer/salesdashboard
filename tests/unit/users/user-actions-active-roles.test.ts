export {};

const mockAssertAuthenticatedUserId = jest.fn();
const mockCreateAdminClient = jest.fn();
const mockUsersCreate = jest.fn();
const mockUsersDelete = jest.fn();
const mockGetDocument = jest.fn();
const mockCreateDocument = jest.fn();
const mockListDocuments = jest.fn();

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
      },
      databases: {
        getDocument: mockGetDocument,
        createDocument: mockCreateDocument,
        listDocuments: mockListDocuments,
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

  it('creates team leads without retired teamLead attributes', async () => {
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
    expect(getCreatedUserPayload()).not.toHaveProperty('teamLeadId');
    expect(getCreatedUserPayload()).not.toHaveProperty('teamLeadIds');
    expect(getCreatedUserPayload()).not.toHaveProperty('assistantManagerId');
    expect(getCreatedUserPayload()).not.toHaveProperty('assistantManagerIds');
  });

  it('creates agents without retired teamLead attributes', async () => {
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
    expect(getCreatedUserPayload()).not.toHaveProperty('teamLeadId');
    expect(getCreatedUserPayload()).not.toHaveProperty('teamLeadIds');
    expect(getCreatedUserPayload()).not.toHaveProperty('assistantManagerId');
    expect(getCreatedUserPayload()).not.toHaveProperty('assistantManagerIds');
  });

  it('creates monitors without retired teamLead attributes', async () => {
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
    expect(getCreatedUserPayload()).not.toHaveProperty('teamLeadId');
    expect(getCreatedUserPayload()).not.toHaveProperty('teamLeadIds');
    expect(getCreatedUserPayload()).not.toHaveProperty('assistantManagerId');
    expect(getCreatedUserPayload()).not.toHaveProperty('assistantManagerIds');
  });

  it('creates operations users without retired teamLead attributes', async () => {
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
    expect(getCreatedUserPayload()).not.toHaveProperty('teamLeadId');
    expect(getCreatedUserPayload()).not.toHaveProperty('teamLeadIds');
    expect(getCreatedUserPayload()).not.toHaveProperty('assistantManagerId');
    expect(getCreatedUserPayload()).not.toHaveProperty('assistantManagerIds');
  });
});
