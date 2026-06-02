const mockAssertAuthenticatedUserId = jest.fn();
const mockCreateAdminClient = jest.fn();
const mockListDocuments = jest.fn();
const mockGetDocument = jest.fn();
const mockUpdateDocument = jest.fn();
const mockUpdateFile = jest.fn();

jest.mock('@/lib/server/current-user', () => ({
  assertAuthenticatedUserId: (...args: unknown[]) => mockAssertAuthenticatedUserId(...args),
}));

jest.mock('@/lib/server/appwrite', () => ({
  createAdminClient: () => mockCreateAdminClient(),
}));

jest.mock('@/lib/server/notifications', () => ({
  createNotificationsForRecipients: jest.fn(),
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
    contains: jest.fn((key, values) => `contains:${key}:${JSON.stringify(values)}`),
    equal: jest.fn((key, value) => `equal:${key}:${JSON.stringify(value)}`),
    greaterThanEqual: jest.fn((key, value) => `gte:${key}:${value}`),
    lessThanEqual: jest.fn((key, value) => `lte:${key}:${value}`),
    limit: jest.fn((limit) => `limit:${limit}`),
    or: jest.fn((conditions) => `or:${conditions.join('|')}`),
    orderAsc: jest.fn((key) => `orderAsc:${key}`),
    orderDesc: jest.fn((key) => `orderDesc:${key}`),
  },
  Role: {
    user: jest.fn((userId) => `user:${userId}`),
  },
}));

jest.mock('@/lib/constants/special-lead-access', () => ({
  getSpecialBranchLeadAccess: jest.fn(() => null),
}));

describe('lead server action authorization', () => {
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    process.env.NEXT_PUBLIC_APPWRITE_DATABASE_ID = 'database';
    process.env.NEXT_PUBLIC_APPWRITE_LEADS_COLLECTION_ID = 'leads';
    process.env.NEXT_PUBLIC_APPWRITE_USERS_COLLECTION_ID = 'users';
    process.env.NEXT_PUBLIC_APPWRITE_AUDIT_LOGS_COLLECTION_ID = 'audit';

    mockAssertAuthenticatedUserId.mockResolvedValue({ $id: 'viewer-1' });
    mockCreateAdminClient.mockResolvedValue({
      databases: {
        listDocuments: mockListDocuments,
        getDocument: mockGetDocument,
        updateDocument: mockUpdateDocument,
        createDocument: jest.fn(),
      },
      storage: {
        updateFile: mockUpdateFile,
      },
    });
    mockListDocuments.mockResolvedValue({ documents: [] });
    mockUpdateDocument.mockResolvedValue({
      $id: 'lead-1',
      data: '{}',
      ownerId: 'owner-1',
      assignedToId: null,
      branchId: null,
      isClosed: false,
      closedAt: null,
      status: 'Generated',
    });
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it('uses the persisted user role instead of the browser supplied role when listing leads', async () => {
    mockGetDocument.mockResolvedValueOnce({
      $id: 'viewer-1',
      email: 'leadgen@example.com',
      role: 'lead_generation',
      branchIds: ['branch-1'],
    });

    const { listLeadsAction } = await import('@/app/actions/lead');
    const { Query } = await import('node-appwrite');

    await listLeadsAction({}, 'viewer-1', 'admin', ['branch-1']);

    expect(Query.equal).toHaveBeenCalledWith('ownerId', 'viewer-1');
    expect(Query.contains).not.toHaveBeenCalledWith('data', ['viewer-1']);
  });

  it('rejects reopen attempts from non-manager users before updating with the admin client', async () => {
    mockGetDocument.mockResolvedValueOnce({
      $id: 'agent-1',
      email: 'agent@example.com',
      role: 'agent',
      branchIds: ['branch-1'],
    });

    const { reopenLeadAction } = await import('@/app/actions/lead');

    await expect(reopenLeadAction('lead-1', 'agent-1', 'Agent')).rejects.toThrow('Permission denied');
    expect(mockUpdateDocument).not.toHaveBeenCalled();
  });

  it('allows team lead to reopen a closed lead for their team', async () => {
    mockGetDocument
      .mockResolvedValueOnce({
        $id: 'tl-1',
        email: 'tl@example.com',
        role: 'team_lead',
        branchIds: ['branch-1'],
      })
      .mockResolvedValueOnce({
        $id: 'lead-1',
        data: '{}',
        ownerId: 'leadgen-1',
        assignedToId: 'agent-1',
        branchId: 'branch-1',
        isClosed: true,
        closedAt: '2024-01-15T10:00:00.000Z',
        status: 'Closed',
      });

    mockListDocuments.mockResolvedValueOnce({
      documents: [
        { $id: 'agent-1' },
        { $id: 'leadgen-1' },
      ],
    });

    const { reopenLeadAction } = await import('@/app/actions/lead');

    await expect(reopenLeadAction('lead-1', 'tl-1', 'TL')).resolves.toBeTruthy();
    expect(mockUpdateDocument).toHaveBeenCalled();
  });

  it('rejects manager lead assignment to agents outside their branch scope', async () => {
    mockGetDocument
      .mockResolvedValueOnce({
        $id: 'manager-1',
        email: 'manager@example.com',
        role: 'manager',
        branchIds: ['branch-1'],
        managerId: null,
        managerIds: [],
        teamLeadId: null,
      })
      .mockResolvedValueOnce({
        $id: 'lead-1',
        data: '{}',
        ownerId: 'manager-1',
        assignedToId: null,
        branchId: 'branch-1',
        isClosed: false,
        closedAt: null,
        status: 'Generated',
      })
      .mockResolvedValueOnce({
        $id: 'agent-2',
        email: 'agent2@example.com',
        role: 'agent',
        branchIds: ['branch-2'],
        managerId: 'manager-2',
        managerIds: ['manager-2'],
        teamLeadId: null,
      });

    const { assignLeadAction } = await import('@/lib/actions/lead-actions');

    await expect(assignLeadAction('lead-1', 'agent-2', 'manager-1', 'Manager')).rejects.toThrow('Permission denied');
    expect(mockUpdateDocument).not.toHaveBeenCalled();
  });

  it('keeps scoped team lead assignment to their own agent working', async () => {
    const documentsById = new Map<string, Record<string, unknown>>([
      ['tl-1', {
        $id: 'tl-1',
        email: 'tl@example.com',
        role: 'team_lead',
        branchIds: ['branch-1'],
        managerId: 'manager-1',
        managerIds: ['manager-1'],
        teamLeadId: null,
      }],
      ['lead-1', {
        $id: 'lead-1',
        data: '{}',
        ownerId: 'leadgen-1',
        assignedToId: null,
        branchId: 'branch-1',
        isClosed: false,
        closedAt: null,
        status: 'Generated',
      }],
      ['agent-1', {
        $id: 'agent-1',
        email: 'agent@example.com',
        role: 'agent',
        branchIds: ['branch-1'],
        managerId: 'manager-1',
        managerIds: ['manager-1'],
        teamLeadId: 'tl-1',
      }],
      ['leadgen-1', {
        $id: 'leadgen-1',
        email: 'leadgen@example.com',
        role: 'lead_generation',
        branchIds: ['branch-1'],
        managerId: 'manager-1',
        managerIds: ['manager-1'],
        teamLeadId: 'tl-1',
      }],
      ['manager-1', {
        $id: 'manager-1',
        email: 'manager@example.com',
        role: 'manager',
        branchIds: ['branch-1'],
        managerId: null,
        managerIds: [],
        teamLeadId: null,
      }],
    ]);

    mockGetDocument.mockImplementation((_databaseId, _collectionId, documentId: string) => {
      const doc = documentsById.get(documentId);
      if (!doc) throw new Error(`Missing document ${documentId}`);
      return Promise.resolve(doc);
    });
    mockListDocuments.mockResolvedValueOnce({
      documents: [
        documentsById.get('agent-1'),
        documentsById.get('leadgen-1'),
      ],
    });
    mockUpdateDocument.mockResolvedValueOnce({
      ...(documentsById.get('lead-1') ?? {}),
      assignedToId: 'agent-1',
    });

    const { assignLeadAction } = await import('@/lib/actions/lead-actions');

    await expect(assignLeadAction('lead-1', 'agent-1', 'tl-1', 'Team Lead')).resolves.toMatchObject({
      success: true,
    });
    expect(mockUpdateDocument).toHaveBeenCalledWith(
      'database',
      'leads',
      'lead-1',
      { assignedToId: 'agent-1' },
      expect.arrayContaining(['read:user:agent-1', 'update:user:agent-1'])
    );
  });

  it('blocks duplicate lead edits and notifies admins and team leads only', async () => {
    mockGetDocument
      .mockResolvedValueOnce({
        $id: 'manager-1',
        email: 'manager@example.com',
        role: 'manager',
        branchIds: ['branch-1'],
        managerId: null,
        managerIds: [],
        teamLeadId: null,
      })
      .mockResolvedValueOnce({
        $id: 'lead-1',
        data: JSON.stringify({
          firstName: 'Current',
          email: 'current@example.com',
          phone: '(555) 111-2222',
          linkedinProfileUrl: 'https://linkedin.com/in/current',
        }),
        ownerId: 'manager-1',
        assignedToId: 'agent-1',
        branchId: 'branch-1',
        isClosed: false,
        closedAt: null,
        status: 'Interested',
      });

    mockListDocuments
      .mockResolvedValueOnce({
        documents: [
          {
            $id: 'lead-2',
            branchId: 'branch-2',
            data: JSON.stringify({
              firstName: 'Existing',
              email: 'other@example.com',
              phone: '5551112222',
              linkedinProfileUrl: 'https://linkedin.com/in/existing',
            }),
          },
        ],
      })
      .mockResolvedValueOnce({
        documents: [
          { $id: 'admin-1', role: 'admin' },
          { $id: 'tl-1', role: 'team_lead' },
          { $id: 'tl-2', role: 'team_lead' },
          { $id: 'tl-3', role: 'team_lead' },
          { $id: 'agent-1', role: 'agent' },
        ],
      });

    const { updateLeadAction } = await import('@/app/actions/lead');
    const { createNotificationsForRecipients } = await import('@/lib/server/notifications');

    await expect(
      updateLeadAction('lead-1', { phone: '+1 (555) 111-2222' }, 'manager-1', 'Manager')
    ).rejects.toThrow('Duplicate phone found in lead lead-2');

    expect(mockUpdateDocument).not.toHaveBeenCalled();
    expect(createNotificationsForRecipients).toHaveBeenCalledWith(
      expect.anything(),
      ['admin-1', 'tl-1', 'tl-2', 'tl-3'],
      expect.objectContaining({
        type: 'LEAD_DUPLICATE_UPDATE',
        title: 'Duplicate lead update blocked',
        targetId: 'lead-1',
        targetType: 'LEAD',
      })
    );
  });

  it('rejects blank required lead fields before updating', async () => {
    mockGetDocument
      .mockResolvedValueOnce({
        $id: 'manager-1',
        email: 'manager@example.com',
        role: 'manager',
        branchIds: ['branch-1'],
        managerId: null,
        managerIds: [],
        teamLeadId: null,
      })
      .mockResolvedValueOnce({
        $id: 'lead-1',
        data: JSON.stringify({
          firstName: 'Current',
          lastName: 'Lead',
          email: 'current@example.com',
          phone: '5551112222',
          status: 'Interested',
        }),
        ownerId: 'manager-1',
        assignedToId: 'agent-1',
        branchId: 'branch-1',
        isClosed: false,
        closedAt: null,
        status: 'Interested',
      });

    mockListDocuments.mockResolvedValueOnce({ documents: [] });

    const { updateLeadAction } = await import('@/app/actions/lead');

    await expect(
      updateLeadAction('lead-1', { firstName: '   ' }, 'manager-1', 'Manager')
    ).rejects.toThrow('First Name is required');

    expect(mockUpdateDocument).not.toHaveBeenCalled();
  });

  it('rejects blank required lead fields before creating', async () => {
    const { createLeadAction } = await import('@/app/actions/lead');

    await expect(
      createLeadAction(
        'manager-1',
        {
          data: {
            firstName: '',
            lastName: 'Lead',
            email: 'lead@example.com',
            phone: '5551112222',
          },
          status: 'Interested',
        },
        'manager-1',
        'Manager',
      )
    ).rejects.toThrow('First Name is required');

    expect(mockListDocuments).not.toHaveBeenCalled();
    expect(mockUpdateDocument).not.toHaveBeenCalled();
  });
});
