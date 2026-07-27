export {};

const mockAssertAuthenticatedUserId = jest.fn();
const mockCreateAdminClient = jest.fn();
const mockListDocuments = jest.fn();
const mockGetDocument = jest.fn();
const mockCreateDocument = jest.fn();
const mockUpdateDocument = jest.fn();
const mockGetAuthenticatedUserDoc = jest.fn();

jest.mock('@/lib/server/current-user', () => ({
  assertAuthenticatedUserId: (...args: unknown[]) => mockAssertAuthenticatedUserId(...args),
  getAuthenticatedUserDoc: (...args: unknown[]) => mockGetAuthenticatedUserDoc(...args),
}));

jest.mock('@/lib/server/appwrite', () => ({
  createAdminClient: () => mockCreateAdminClient(),
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
    greaterThanEqual: jest.fn((key, value) => `gte:${key}:${value}`),
    lessThanEqual: jest.fn((key, value) => `lte:${key}:${value}`),
    limit: jest.fn((limit) => `limit(${limit})`),
    select: jest.fn((fields) => `select(${fields.join(',')})`),
    orderDesc: jest.fn((attr) => `orderDesc(${attr})`),
    orderAsc: jest.fn((key) => `orderAsc:${key}`),
  },
  Role: {
    user: jest.fn((userId) => `user:${userId}`),
    label: jest.fn((label) => `label:${label}`),
  },
}));

describe('LinkedIn Server Actions Regression', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockListDocuments.mockReset();
    mockGetDocument.mockReset();
    mockCreateDocument.mockReset();
    mockUpdateDocument.mockReset();
    mockGetAuthenticatedUserDoc.mockReset();

    process.env.NEXT_PUBLIC_APPWRITE_DATABASE_ID = 'database';
    process.env.NEXT_PUBLIC_APPWRITE_LINKEDIN_REQUESTS_COLLECTION_ID = 'linkedin_requests';
    process.env.NEXT_PUBLIC_APPWRITE_LINKEDIN_ACCOUNTS_COLLECTION_ID = 'linkedin_accounts';
    process.env.NEXT_PUBLIC_APPWRITE_ATTENDANCE_COLLECTION_ID = 'attendance';
    process.env.NEXT_PUBLIC_APPWRITE_AUDIT_LOGS_COLLECTION_ID = 'audit_logs';

    mockAssertAuthenticatedUserId.mockResolvedValue({ $id: 'viewer-1' });
    mockCreateAdminClient.mockResolvedValue({
      databases: {
        listDocuments: mockListDocuments,
        getDocument: mockGetDocument,
        createDocument: mockCreateDocument,
        updateDocument: mockUpdateDocument,
      },
    });
  });

  describe('listMyLinkedinRequestsAction', () => {
    it('scopes queries to the authenticated user ID (and delegated IDs)', async () => {
      mockGetAuthenticatedUserDoc.mockResolvedValueOnce({
        $id: 'agent-1',
        role: 'agent',
      });
      mockListDocuments.mockResolvedValue({ documents: [] });

      const { listMyLinkedinRequestsAction } = await import('@/app/actions/linkedin/requests');
      const { Query } = await import('node-appwrite');

      await listMyLinkedinRequestsAction({ currentUserId: 'agent-1' });

      expect(Query.equal).toHaveBeenCalledWith('agentId', ['agent-1']);
    });
  });

  describe('listLinkedinRequestsForAdminAction', () => {
    it('allows admin to see all requests without team lead scope', async () => {
      mockGetAuthenticatedUserDoc.mockResolvedValueOnce({
        $id: 'admin-1',
        role: 'admin',
      });
      mockListDocuments.mockResolvedValue({ documents: [] });

      const { listLinkedinRequestsForAdminAction } = await import('@/app/actions/linkedin/requests');
      const { Query } = await import('node-appwrite');

      await listLinkedinRequestsForAdminAction({
        currentUserId: 'admin-1',
        startDate: '2026-07-01',
        endDate: '2026-07-31',
      });

      expect(Query.equal).not.toHaveBeenCalledWith('teamLeadId', expect.anything());
    });

    it('forces team lead scope for a team lead role', async () => {
      mockGetAuthenticatedUserDoc.mockResolvedValueOnce({
        $id: 'tl-1',
        role: 'team_lead',
      });
      mockListDocuments.mockResolvedValue({ documents: [] });

      const { listLinkedinRequestsForAdminAction } = await import('@/app/actions/linkedin/requests');
      const { Query } = await import('node-appwrite');

      await listLinkedinRequestsForAdminAction({
        currentUserId: 'tl-1',
        startDate: '2026-07-01',
        endDate: '2026-07-31',
      });

      expect(Query.equal).toHaveBeenCalledWith('teamLeadId', 'tl-1');
    });

    it('silently scopes a team lead to their own scope when they try to query another team lead', async () => {
      mockGetAuthenticatedUserDoc.mockResolvedValueOnce({
        $id: 'tl-1',
        role: 'team_lead',
      });
      mockListDocuments.mockResolvedValue({ documents: [] });

      const { listLinkedinRequestsForAdminAction } = await import('@/app/actions/linkedin/requests');
      const { Query } = await import('node-appwrite');

      await listLinkedinRequestsForAdminAction({
        currentUserId: 'tl-1',
        teamLeadId: 'tl-2',
        startDate: '2026-07-01',
        endDate: '2026-07-31',
      });

      expect(Query.equal).toHaveBeenCalledWith('teamLeadId', 'tl-1');
    });

    it('denies an agent from seeing reports', async () => {
      mockGetAuthenticatedUserDoc.mockResolvedValueOnce({
        $id: 'agent-1',
        role: 'agent',
      });

      const { listLinkedinRequestsForAdminAction } = await import('@/app/actions/linkedin/requests');

      await expect(listLinkedinRequestsForAdminAction({
        currentUserId: 'agent-1',
        startDate: '2026-07-01',
        endDate: '2026-07-31',
      })).rejects.toThrow('Unauthorized');
    });
  });

  describe('createLinkedinRequestAction', () => {
    it('creates a request and correctly applies user permissions', async () => {
      mockGetAuthenticatedUserDoc.mockResolvedValueOnce({
        $id: 'agent-1',
        role: 'agent',
        name: 'Test Agent',
        teamLeadId: 'tl-1',
      });

      // 1. Get Linkedin Account (assignedUserId match)
      mockGetDocument.mockResolvedValueOnce({
        $id: 'acc-1',
        assignedUserId: 'agent-1',
        isActive: true,
        company: 'Test Company',
        connectionLimit: 100,
      });

      mockListDocuments
        .mockResolvedValueOnce({ documents: [] }) // Delegate fallback check? (only done if assignedUserId mismatches, but the code may not call it if match) Wait, assertAccessibleLinkedinAccount calls getLinkedinAccountDoc and checks assignedUserId.
        .mockResolvedValueOnce({ documents: [] }) // existing by company
        .mockResolvedValueOnce({ documents: [] }); // already sent count

      mockCreateDocument.mockResolvedValueOnce({
        $id: 'req-1',
        accountId: 'acc-1',
        agentId: 'agent-1',
      });

      const { createLinkedinRequestAction } = await import('@/app/actions/linkedin/requests');

      await createLinkedinRequestAction({
        currentUserId: 'agent-1',
        accountId: 'acc-1',
        dateSent: '2026-07-27',
        targetUrl: 'https://linkedin.com/in/test',
      });

      expect(mockCreateDocument).toHaveBeenCalledWith(
        'database',
        'linkedin_requests',
        'unique-id',
        expect.objectContaining({
          accountId: 'acc-1',
          agentId: 'agent-1',
          teamLeadId: 'tl-1',
          status: 'sent',
          targetUrl: 'https://linkedin.com/in/test',
        }),
        expect.arrayContaining([
          'read:user:agent-1',
          'update:user:agent-1',
          'delete:user:agent-1',
          'read:label:admin'
        ])
      );
    });

    it('denies creation if the linkedin account is not assigned to the user', async () => {
      mockGetAuthenticatedUserDoc.mockResolvedValueOnce({
        $id: 'agent-1',
        role: 'agent',
        name: 'Test Agent',
        teamLeadId: 'tl-1',
      });

      mockGetDocument.mockResolvedValueOnce({
        $id: 'acc-1',
        assignedUserId: 'agent-2',
        isActive: true,
        company: 'Test Company',
        connectionLimit: 100,
      });
      // Delegate fallback
      mockListDocuments.mockResolvedValueOnce({ documents: [] });

      const { createLinkedinRequestAction } = await import('@/app/actions/linkedin/requests');

      await expect(createLinkedinRequestAction({
        currentUserId: 'agent-1',
        accountId: 'acc-1',
        dateSent: '2026-07-27',
        targetUrl: 'https://linkedin.com/in/test',
      })).rejects.toThrow('Unauthorized');
    });
  });
});
