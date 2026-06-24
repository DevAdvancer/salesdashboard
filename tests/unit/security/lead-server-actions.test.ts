export {};

const mockAssertAuthenticatedUserId = jest.fn();
const mockCreateAdminClient = jest.fn();
const mockListDocuments = jest.fn();
const mockGetDocument = jest.fn();
const mockCreateDocument = jest.fn();
const mockUpdateDocument = jest.fn();
const mockUpdateFile = jest.fn();
const mockGetDepartmentScopedUserIds = jest.fn();

jest.mock('@/lib/server/current-user', () => ({
  assertAuthenticatedUserId: (...args: unknown[]) => mockAssertAuthenticatedUserId(...args),
}));

jest.mock('@/lib/server/appwrite', () => ({
  createAdminClient: () => mockCreateAdminClient(),
}));

jest.mock('@/lib/server/department-user-cache', () => ({
  getDepartmentScopedUserIds: (...args: unknown[]) =>
    mockGetDepartmentScopedUserIds(...args),
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
    offset: jest.fn((offset) => `offset:${offset}`),
    cursorAfter: jest.fn((value) => `cursorAfter:${value}`),
    or: jest.fn((conditions) => `or:${conditions.join('|')}`),
    orderAsc: jest.fn((key) => `orderAsc:${key}`),
    orderDesc: jest.fn((key) => `orderDesc:${key}`),
    select: jest.fn((fields) => `select:${JSON.stringify(fields)}`),
    isNull: jest.fn((key) => `isNull:${key}`),
  },
  Role: {
    user: jest.fn((userId) => `user:${userId}`),
    label: jest.fn((label) => `label:${label}`),
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
    process.env.APPWRITE_UNASSIGNED_OWNER_ID = 'unassigned-owner';

    mockAssertAuthenticatedUserId.mockResolvedValue({ $id: 'viewer-1' });
    mockCreateAdminClient.mockResolvedValue({
      databases: {
        listDocuments: mockListDocuments,
        getDocument: mockGetDocument,
        updateDocument: mockUpdateDocument,
        createDocument: mockCreateDocument,
      },
      storage: {
        updateFile: mockUpdateFile,
      },
    });
    mockListDocuments.mockResolvedValue({ documents: [] });
    mockGetDepartmentScopedUserIds.mockResolvedValue(
      new Set([
        'owner-1',
        'agent-1',
        'agent-2',
        'leadgen-1',
        'manager-1',
        'monitor-1',
        'operations-1',
        'sales-owner',
        'tl-1',
        'tl-2',
        'tl-3',
        'unassigned-owner',
        'viewer-1',
      ])
    );
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

  it('lets monitors list active leads without owner or assignment scoping', async () => {
    mockGetDocument.mockResolvedValueOnce({
      $id: 'monitor-1',
      email: 'monitor@example.com',
      role: 'monitor',
      branchIds: [],
    });

    const { listLeadsAction } = await import('@/app/actions/lead');
    const { Query } = await import('node-appwrite');

    await listLeadsAction({}, 'monitor-1', 'agent', []);

    expect(Query.equal).not.toHaveBeenCalledWith('ownerId', expect.anything());
    expect(Query.equal).not.toHaveBeenCalledWith('assignedToId', expect.anything());
    expect(Query.equal).toHaveBeenCalledWith('isClosed', false);
  });

  it('lets operations list active leads without owner or assignment scoping', async () => {
    mockGetDocument.mockResolvedValueOnce({
      $id: 'operations-1',
      email: 'operations@example.com',
      role: 'operations',
      branchIds: [],
    });

    const { listLeadsAction } = await import('@/app/actions/lead');
    const { Query } = await import('node-appwrite');

    await listLeadsAction({}, 'operations-1', 'agent' as any, []);

    expect(Query.equal).not.toHaveBeenCalledWith('ownerId', expect.anything());
    expect(Query.equal).not.toHaveBeenCalledWith('assignedToId', expect.anything());
    expect(Query.equal).toHaveBeenCalledWith('isClosed', false);
  });

  it('keeps admin export department-scoped by default', async () => {
    mockGetDocument.mockResolvedValueOnce({
      $id: 'admin-1',
      email: 'admin@example.com',
      role: 'admin',
      branchIds: [],
      department: 'sales',
    });
    mockGetDepartmentScopedUserIds.mockResolvedValueOnce(new Set(['sales-owner']));
    mockListDocuments.mockResolvedValueOnce({
      documents: [
        {
          $id: 'lead-sales',
          data: '{}',
          ownerId: 'sales-owner',
          assignedToId: null,
          branchId: 'branch-1',
          isClosed: true,
          closedAt: '2026-06-01T10:00:00.000Z',
          status: 'Signed/Closure',
        },
        {
          $id: 'lead-archived',
          data: '{}',
          ownerId: 'archived-owner',
          assignedToId: null,
          branchId: 'branch-1',
          isClosed: true,
          closedAt: '2026-06-02T10:00:00.000Z',
          status: 'Signed/Closure',
        },
      ],
      total: 2,
    });

    const { listLeadsAction } = await import('@/app/actions/lead');

    const result = await listLeadsAction(
      { isClosed: true },
      'admin-1',
      'admin',
      [],
      { forExport: true },
    );

    expect(result.leads.map((lead) => lead.$id)).toEqual(['lead-sales']);
  });

  it('lets client history skip admin department post-filtering', async () => {
    mockGetDocument.mockResolvedValueOnce({
      $id: 'admin-1',
      email: 'admin@example.com',
      role: 'admin',
      branchIds: [],
      department: 'sales',
    });
    mockListDocuments.mockResolvedValueOnce({
      documents: [
        {
          $id: 'lead-sales',
          data: '{}',
          ownerId: 'sales-owner',
          assignedToId: null,
          branchId: 'branch-1',
          isClosed: true,
          closedAt: '2026-06-01T10:00:00.000Z',
          status: 'Signed/Closure',
        },
        {
          $id: 'lead-archived',
          data: '{}',
          ownerId: 'archived-owner',
          assignedToId: null,
          branchId: 'branch-1',
          isClosed: true,
          closedAt: '2026-06-02T10:00:00.000Z',
          status: 'Signed/Closure',
        },
      ],
      total: 2,
    });

    const { listLeadsAction } = await import('@/app/actions/lead');

    const result = await listLeadsAction(
      { isClosed: true },
      'admin-1',
      'admin',
      [],
      { forExport: true, skipDepartmentScope: true },
    );

    expect(result.leads.map((lead) => lead.$id)).toEqual([
      'lead-sales',
      'lead-archived',
    ]);
    expect(mockGetDepartmentScopedUserIds).not.toHaveBeenCalled();
  });

  it('lets operations read any lead detail', async () => {
    mockGetDocument
      .mockResolvedValueOnce({
        $id: 'operations-1',
        email: 'operations@example.com',
        role: 'operations',
        branchIds: [],
      })
      .mockResolvedValueOnce({
        $id: 'lead-1',
        data: '{}',
        ownerId: 'owner-1',
        assignedToId: 'agent-1',
        branchId: 'branch-1',
        isClosed: false,
        closedAt: null,
        status: 'Generated',
      });

    const { getLeadAction } = await import('@/app/actions/lead');

    await expect(getLeadAction('lead-1', 'operations-1')).resolves.toMatchObject({
      $id: 'lead-1',
      ownerId: 'owner-1',
    });
  });

  it('allows monitor lead edits only when the monitor owns the lead', async () => {
    mockGetDocument
      .mockResolvedValueOnce({
        $id: 'monitor-1',
        email: 'monitor@example.com',
        role: 'monitor',
        branchIds: [],
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
        ownerId: 'monitor-1',
        assignedToId: null,
        branchId: 'branch-1',
        isClosed: false,
        closedAt: null,
        status: 'Interested',
      });

    const { updateLeadAction } = await import('@/app/actions/lead');

    await expect(
      updateLeadAction('lead-1', { firstName: 'Changed' }, 'monitor-1', 'Monitor')
    ).resolves.toBeTruthy();

    expect(mockUpdateDocument).toHaveBeenCalledWith(
      'database',
      'leads',
      'lead-1',
      expect.objectContaining({
        data: expect.stringContaining('Changed'),
      }),
    );
  });

  it('allows monitor lead edits even when the monitor does not own the lead', async () => {
    mockGetDocument
      .mockResolvedValueOnce({
        $id: 'monitor-1',
        email: 'monitor@example.com',
        role: 'monitor',
        branchIds: [],
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
        ownerId: 'owner-1',
        assignedToId: null,
        branchId: 'branch-1',
        isClosed: false,
        closedAt: null,
        status: 'Interested',
      });

    const { updateLeadAction } = await import('@/app/actions/lead');

    // Monitors are leadership-level observers: they can edit any lead they
    // can see, not only leads they personally own. This matches the
    // admin/developer behavior so the /leads list and /leads/[id] detail
    // page surface the same set of leads for the role.
    await expect(
      updateLeadAction('lead-1', { firstName: 'Changed' }, 'monitor-1', 'Monitor')
    ).resolves.toBeTruthy();

    expect(mockUpdateDocument).toHaveBeenCalledWith(
      'database',
      'leads',
      'lead-1',
      expect.objectContaining({
        data: expect.stringContaining('Changed'),
      }),
    );
  });

  it('allows monitor lead creation with the monitor as owner', async () => {
    mockGetDocument.mockResolvedValueOnce({
      $id: 'monitor-1',
      email: 'monitor@example.com',
      role: 'monitor',
      branchIds: [],
    });
    mockCreateDocument.mockResolvedValueOnce({
      $id: 'lead-1',
      data: JSON.stringify({
        firstName: 'New',
        lastName: 'Lead',
        email: 'new@example.com',
        phone: '5551112222',
      }),
      ownerId: 'monitor-1',
      assignedToId: 'monitor-1',
      branchId: null,
      isClosed: false,
      closedAt: null,
      status: 'Interested',
    });

    const { createLeadAction } = await import('@/app/actions/lead');

    await expect(
      createLeadAction(
        'monitor-1',
        {
          data: {
            firstName: 'New',
            lastName: 'Lead',
            email: 'new@example.com',
            phone: '5551112222',
          },
          status: 'Interested',
        },
        'monitor-1',
        'Monitor',
      )
    ).resolves.toMatchObject({
      ownerId: 'monitor-1',
    });

    expect(mockCreateDocument).toHaveBeenCalledWith(
      'database',
      'leads',
      expect.any(String),
      expect.objectContaining({
        ownerId: 'monitor-1',
      }),
      expect.arrayContaining(['read:user:monitor-1', 'update:user:monitor-1']),
    );
  });

  it('rejects operations lead creation before writing', async () => {
    mockGetDocument.mockResolvedValueOnce({
      $id: 'operations-1',
      email: 'operations@example.com',
      role: 'operations',
      branchIds: [],
    });

    const { createLeadAction } = await import('@/app/actions/lead');

    await expect(
      createLeadAction(
        'operations-1',
        {
          data: {
            firstName: 'New',
            lastName: 'Lead',
            email: 'new@example.com',
            phone: '5551112222',
          },
          status: 'Interested',
        },
        'operations-1',
        'Operations',
      )
    ).rejects.toThrow('Permission denied');

    expect(mockCreateDocument).not.toHaveBeenCalled();
  });

  it('rejects operations lead edits even when operations owns the lead', async () => {
    mockGetDocument
      .mockResolvedValueOnce({
        $id: 'operations-1',
        email: 'operations@example.com',
        role: 'operations',
        branchIds: [],
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
        ownerId: 'operations-1',
        assignedToId: null,
        branchId: 'branch-1',
        isClosed: false,
        closedAt: null,
        status: 'Interested',
      });

    const { updateLeadAction } = await import('@/app/actions/lead');

    await expect(
      updateLeadAction('lead-1', { firstName: 'Changed' }, 'operations-1', 'Operations')
    ).rejects.toThrow('Permission denied');

    expect(mockUpdateDocument).not.toHaveBeenCalled();
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
        ownerId: 'leadgen-1',
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

  it('allows a lead owner to assign their own lead to any active agent', async () => {
    const documentsById = new Map<string, Record<string, unknown>>([
      ['owner-1', {
        $id: 'owner-1',
        email: 'owner@example.com',
        role: 'agent',
        branchIds: ['branch-1'],
        managerId: null,
        managerIds: [],
        teamLeadId: null,
      }],
      ['lead-1', {
        $id: 'lead-1',
        data: '{}',
        ownerId: 'owner-1',
        assignedToId: null,
        branchId: 'branch-1',
        isClosed: false,
        closedAt: null,
        status: 'Generated',
      }],
      ['agent-2', {
        $id: 'agent-2',
        email: 'agent2@example.com',
        role: 'agent',
        branchIds: ['branch-9'],
        managerId: null,
        managerIds: [],
        teamLeadId: 'tl-9',
        isActive: true,
      }],
    ]);

    mockGetDocument.mockImplementation((_databaseId, _collectionId, documentId: string) => {
      const doc = documentsById.get(documentId);
      if (!doc) throw new Error(`Missing document ${documentId}`);
      return Promise.resolve(doc);
    });
    mockUpdateDocument.mockResolvedValueOnce({
      ...(documentsById.get('lead-1') ?? {}),
      assignedToId: 'agent-2',
    });

    const { assignLeadAction } = await import('@/lib/actions/lead-actions');

    // Agents cannot assign leads, even leads they own. The assignment workflow is
    // controlled by managers, team leads, lead generation, and admins.
    await expect(assignLeadAction('lead-1', 'agent-2', 'owner-1', 'Owner')).rejects.toThrow(
      'Permission denied'
    );
  });

  it('allows lead generation owners to assign their own leads to an active team lead', async () => {
    const documentsById = new Map<string, Record<string, unknown>>([
      ['leadgen-1', {
        $id: 'leadgen-1',
        email: 'leadgen@example.com',
        role: 'lead_generation',
        branchIds: ['branch-1'],
        managerId: null,
        managerIds: [],
        teamLeadId: 'tl-1',
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
      ['tl-1', {
        $id: 'tl-1',
        email: 'tl@example.com',
        role: 'team_lead',
        branchIds: ['branch-1'],
        managerId: null,
        managerIds: [],
        teamLeadId: null,
        isActive: true,
      }],
    ]);

    mockGetDocument.mockImplementation((_databaseId, _collectionId, documentId: string) => {
      const doc = documentsById.get(documentId);
      if (!doc) throw new Error(`Missing document ${documentId}`);
      return Promise.resolve(doc);
    });

    const { assignLeadAction } = await import('@/lib/actions/lead-actions');

    await expect(assignLeadAction('lead-1', 'tl-1', 'leadgen-1', 'Lead Gen')).resolves.toMatchObject({
      success: true,
    });
    expect(mockUpdateDocument).toHaveBeenCalledWith(
      'database',
      'leads',
      'lead-1',
      { assignedToId: 'tl-1' },
      expect.arrayContaining(['read:user:tl-1', 'update:user:tl-1'])
    );
  });

  it('rejects lead generation owners assigning their own leads directly to agents', async () => {
    const documentsById = new Map<string, Record<string, unknown>>([
      ['leadgen-1', {
        $id: 'leadgen-1',
        email: 'leadgen@example.com',
        role: 'lead_generation',
        branchIds: ['branch-1'],
        managerId: null,
        managerIds: [],
        teamLeadId: 'tl-1',
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
      ['agent-2', {
        $id: 'agent-2',
        email: 'agent2@example.com',
        role: 'agent',
        branchIds: ['branch-1'],
        managerId: null,
        managerIds: [],
        teamLeadId: 'tl-1',
        isActive: true,
      }],
    ]);

    mockGetDocument.mockImplementation((_databaseId, _collectionId, documentId: string) => {
      const doc = documentsById.get(documentId);
      if (!doc) throw new Error(`Missing document ${documentId}`);
      return Promise.resolve(doc);
    });

    const { assignLeadAction } = await import('@/lib/actions/lead-actions');

    await expect(assignLeadAction('lead-1', 'agent-2', 'leadgen-1', 'Lead Gen')).rejects.toThrow(
      'Lead generation can only assign leads to team leads.'
    );
    expect(mockUpdateDocument).not.toHaveBeenCalled();
  });

  it('allows a monitor owner to assign their own lead to any active agent', async () => {
    const documentsById = new Map<string, Record<string, unknown>>([
      ['monitor-1', {
        $id: 'monitor-1',
        email: 'monitor@example.com',
        role: 'monitor',
        branchIds: [],
        managerId: null,
        managerIds: [],
        teamLeadId: null,
      }],
      ['lead-1', {
        $id: 'lead-1',
        data: '{}',
        ownerId: 'monitor-1',
        assignedToId: null,
        branchId: 'branch-1',
        isClosed: false,
        closedAt: null,
        status: 'Generated',
      }],
      ['agent-2', {
        $id: 'agent-2',
        email: 'agent2@example.com',
        role: 'agent',
        branchIds: ['branch-9'],
        managerId: null,
        managerIds: [],
        teamLeadId: 'tl-9',
        isActive: true,
      }],
    ]);

    mockGetDocument.mockImplementation((_databaseId, _collectionId, documentId: string) => {
      const doc = documentsById.get(documentId);
      if (!doc) throw new Error(`Missing document ${documentId}`);
      return Promise.resolve(doc);
    });
    mockUpdateDocument.mockResolvedValueOnce({
      ...(documentsById.get('lead-1') ?? {}),
      assignedToId: 'agent-2',
    });

    const { assignLeadAction } = await import('@/lib/actions/lead-actions');

    // Monitors cannot assign leads (per product decision to restrict
    // assignment to managers, team leads, lead generation, and admins).
    await expect(assignLeadAction('lead-1', 'agent-2', 'monitor-1', 'Monitor')).rejects.toThrow(
      'Permission denied'
    );
  });

  it('rejects operations lead assignment even when operations owns the lead', async () => {
    const documentsById = new Map<string, Record<string, unknown>>([
      ['operations-1', {
        $id: 'operations-1',
        email: 'operations@example.com',
        role: 'operations',
        branchIds: [],
        managerId: null,
        managerIds: [],
        teamLeadId: null,
      }],
      ['lead-1', {
        $id: 'lead-1',
        data: '{}',
        ownerId: 'operations-1',
        assignedToId: null,
        branchId: 'branch-1',
        isClosed: false,
        closedAt: null,
        status: 'Generated',
      }],
      ['agent-2', {
        $id: 'agent-2',
        email: 'agent2@example.com',
        role: 'agent',
        branchIds: ['branch-9'],
        managerId: null,
        managerIds: [],
        teamLeadId: 'tl-9',
        isActive: true,
      }],
    ]);

    mockGetDocument.mockImplementation((_databaseId, _collectionId, documentId: string) => {
      const doc = documentsById.get(documentId);
      if (!doc) throw new Error(`Missing document ${documentId}`);
      return Promise.resolve(doc);
    });

    const { assignLeadAction } = await import('@/lib/actions/lead-actions');

    await expect(assignLeadAction('lead-1', 'agent-2', 'operations-1', 'Operations')).rejects.toThrow(
      'Permission denied'
    );
    expect(mockUpdateDocument).not.toHaveBeenCalled();
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
        type: 'LEAD_DUPLICATE_ATTEMPT',
        title: 'Duplicate lead update blocked',
        targetId: 'lead-2',
        targetType: 'LEAD',
      })
    );
  });

  it('allows retrying a duplicate Linkedin URL when the existing lead is not interested', async () => {
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

    mockListDocuments.mockResolvedValueOnce({
      documents: [
        {
          $id: 'lead-2',
          branchId: 'branch-2',
          status: 'Not Interested',
          data: JSON.stringify({
            firstName: 'Existing',
            email: 'other@example.com',
            phone: '5552223333',
            linkedinProfileUrl: 'https://linkedin.com/in/existing',
          }),
        },
      ],
    });
    mockUpdateDocument.mockResolvedValueOnce({
      $id: 'lead-1',
      status: 'Interested',
    });

    const { updateLeadAction } = await import('@/app/actions/lead');
    const { createNotificationsForRecipients } = await import('@/lib/server/notifications');

    await expect(
      updateLeadAction(
        'lead-1',
        { linkedinProfileUrl: 'https://linkedin.com/in/existing' },
        'manager-1',
        'Manager',
      )
    ).resolves.toBeTruthy();

    expect(mockUpdateDocument).toHaveBeenCalled();
    expect(createNotificationsForRecipients).not.toHaveBeenCalled();
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
    mockGetDocument.mockResolvedValueOnce({
      $id: 'manager-1',
      email: 'manager@example.com',
      role: 'manager',
      teamLeadId: null,
    });

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

  it('moves backed out leads to the unassigned owner and clears assignedToId', async () => {
    mockGetDocument
      .mockResolvedValueOnce({
        $id: 'manager-1',
        email: 'manager@example.com',
        role: 'manager',
        managerId: null,
        managerIds: [],
        teamLeadId: null,
        branchIds: ['branch-1'],
      })
      .mockResolvedValueOnce({
        $id: 'lead-1',
        data: JSON.stringify({
          firstName: 'Current',
          lastName: 'Lead',
          status: 'Interested',
        }),
        ownerId: 'owner-1',
        assignedToId: 'agent-1',
        branchId: 'branch-1',
        isClosed: false,
        closedAt: null,
        status: 'Interested',
      })
      .mockResolvedValueOnce({
        $id: 'unassigned-owner',
        managerId: null,
        managerIds: [],
        teamLeadId: null,
      });

    mockUpdateDocument.mockResolvedValueOnce({
      $id: 'lead-1',
      ownerId: 'unassigned-owner',
      assignedToId: null,
      isClosed: true,
      status: 'Backed Out',
    });

    const { backoutLeadAction } = await import('@/lib/actions/lead-actions');

    await expect(backoutLeadAction('lead-1', 'manager-1', 'Manager')).resolves.toMatchObject({
      success: true,
      lead: expect.objectContaining({
        ownerId: 'unassigned-owner',
        assignedToId: null,
      }),
    });

    expect(mockUpdateDocument).toHaveBeenCalledWith(
      'database',
      'leads',
      'lead-1',
      expect.objectContaining({
        ownerId: 'unassigned-owner',
        assignedToId: null,
        status: 'Backed Out',
      }),
      expect.any(Array),
    );
  });

  it('moves not interested leads to the unassigned owner and clears assignedToId', async () => {
    mockGetDocument
      .mockResolvedValueOnce({
        $id: 'manager-1',
        email: 'manager@example.com',
        role: 'manager',
        managerId: null,
        managerIds: [],
        teamLeadId: null,
        branchIds: ['branch-1'],
      })
      .mockResolvedValueOnce({
        $id: 'lead-1',
        data: JSON.stringify({
          firstName: 'Current',
          lastName: 'Lead',
          status: 'Interested',
          linkedinRequestId: 'linkedin-request-1',
        }),
        ownerId: 'owner-1',
        assignedToId: 'agent-1',
        branchId: 'branch-1',
        isClosed: false,
        closedAt: null,
        status: 'Interested',
      })
      .mockResolvedValueOnce({
        $id: 'unassigned-owner',
        managerId: null,
        managerIds: [],
        teamLeadId: null,
      })
      .mockResolvedValueOnce({
        $id: 'linkedin-request-1',
        targetUrl: 'https://linkedin.com/in/test-profile',
        company: 'Acme',
      });

    mockUpdateDocument
      .mockResolvedValueOnce({
        $id: 'lead-1',
        ownerId: 'unassigned-owner',
        assignedToId: null,
        isClosed: true,
        status: 'Not Interested',
      })
      .mockResolvedValueOnce({
        $id: 'linkedin-request-1',
        status: 'sent',
        isActive: true,
        leadId: null,
      });

    const { notInterestedLeadAction } = await import('@/lib/actions/lead-actions');

    await expect(notInterestedLeadAction('lead-1', 'manager-1', 'Manager')).resolves.toMatchObject({
      success: true,
      lead: expect.objectContaining({
        ownerId: 'unassigned-owner',
        assignedToId: null,
      }),
    });

    expect(mockUpdateDocument).toHaveBeenCalledWith(
      'database',
      'leads',
      'lead-1',
      expect.objectContaining({
        ownerId: 'unassigned-owner',
        assignedToId: null,
        status: 'Not Interested',
      }),
      expect.any(Array),
    );
    expect(mockUpdateDocument).toHaveBeenNthCalledWith(
      2,
      'database',
      'linkedin_requests',
      'linkedin-request-1',
      expect.objectContaining({
        status: 'sent',
        isActive: true,
        leadId: null,
        acceptedAt: null,
        withdrawnAt: null,
      }),
    );
  });
});
