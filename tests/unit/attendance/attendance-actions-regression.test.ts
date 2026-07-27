export {};

const mockAssertAuthenticatedUserId = jest.fn();
const mockGetAuthenticatedUserDoc = jest.fn();
const mockCreateAdminClient = jest.fn();
const mockListDocuments = jest.fn();
const mockGetDocument = jest.fn();
const mockCreateDocument = jest.fn();
const mockUpdateDocument = jest.fn();

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
    contains: jest.fn((key, values) => `contains:${key}:${JSON.stringify(values)}`),
    equal: jest.fn((key, value) => `equal:${key}:${JSON.stringify(value)}`),
    notEqual: jest.fn((key, value) => `notEqual:${key}:${JSON.stringify(value)}`),
    limit: jest.fn((limit) => `limit:${limit}`),
    offset: jest.fn((offset) => `offset:${offset}`),
  },
  Role: {
    user: jest.fn((userId) => `user:${userId}`),
    label: jest.fn((label) => `label:${label}`),
  },
}));

describe('attendance server actions', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    process.env.NEXT_PUBLIC_APPWRITE_DATABASE_ID = 'database';
    
    mockAssertAuthenticatedUserId.mockResolvedValue(undefined);
    mockCreateAdminClient.mockResolvedValue({
      databases: {
        listDocuments: mockListDocuments,
        getDocument: mockGetDocument,
        updateDocument: mockUpdateDocument,
        createDocument: mockCreateDocument,
      },
    });

    mockListDocuments.mockResolvedValue({ documents: [] });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('markMyselfPresentAction', () => {
    it('throws if user is not agent, team_lead, or lead_generation', async () => {
      mockGetAuthenticatedUserDoc.mockResolvedValue({
        $id: 'admin-1',
        role: 'admin',
      });
      const { markMyselfPresentAction } = await import('@/app/actions/attendance/mark');
      await expect(markMyselfPresentAction({ currentUserId: 'admin-1' })).rejects.toThrow('Unauthorized');
    });

    it('throws if outside of 9-10 ET window', async () => {
      jest.useFakeTimers();
      // July 27, 2026, 11:00 AM EDT -> 15:00:00Z
      jest.setSystemTime(new Date('2026-07-27T15:00:00Z'));
      
      mockGetAuthenticatedUserDoc.mockResolvedValue({
        $id: 'agent-1',
        role: 'agent',
      });
      const { markMyselfPresentAction } = await import('@/app/actions/attendance/mark');
      await expect(markMyselfPresentAction({ currentUserId: 'agent-1' })).rejects.toThrow('You can only mark present between 9-10 ET');
    });

    it('allows marking present between 9-10 ET', async () => {
      jest.useFakeTimers();
      // July 27, 2026, 09:30 AM EDT -> 13:30:00Z
      jest.setSystemTime(new Date('2026-07-27T13:30:00Z'));
      
      mockGetAuthenticatedUserDoc.mockResolvedValue({
        $id: 'agent-1',
        role: 'agent',
        teamLeadId: 'tl-1',
        name: 'Agent 1',
      });
      
      mockCreateDocument.mockResolvedValue({
        $id: 'new-attendance-id',
        present: true,
      });

      const { markMyselfPresentAction } = await import('@/app/actions/attendance/mark');
      const result = await markMyselfPresentAction({ currentUserId: 'agent-1' });
      
      expect(result).toMatchObject({ present: true });
      expect(mockCreateDocument).toHaveBeenCalled();
    });
  });

  describe('listMyTeamAttendanceAction', () => {
    it('allows team lead to see their own team', async () => {
      mockGetAuthenticatedUserDoc.mockResolvedValue({
        $id: 'tl-1',
        role: 'team_lead',
        name: 'TL 1',
      });
      mockGetDocument.mockResolvedValueOnce({
        $id: 'tl-1',
        role: 'team_lead',
        name: 'TL 1',
      });
      mockListDocuments.mockResolvedValueOnce({
        documents: [{ $id: 'agent-1', name: 'Agent 1', isActive: true, role: 'agent' }]
      });
      mockListDocuments.mockResolvedValueOnce({
        documents: [{ userId: 'agent-1', present: true }]
      });
      mockListDocuments.mockResolvedValueOnce({
        documents: [] // linkedin accounts
      });

      const { listMyTeamAttendanceAction } = await import('@/app/actions/attendance/list');
      const result = await listMyTeamAttendanceAction({ currentUserId: 'tl-1' });
      
      expect(result.teamLead.userId).toBe('tl-1');
      expect(result.rows[0].userId).toBe('agent-1');
      expect(result.rows[0].present).toBe(true);
    });

    it('allows admin to see any team lead', async () => {
      mockGetAuthenticatedUserDoc.mockResolvedValue({
        $id: 'admin-1',
        role: 'admin',
      });
      mockGetDocument.mockResolvedValueOnce({
        $id: 'tl-2',
        role: 'team_lead',
        name: 'TL 2',
      });
      mockListDocuments.mockResolvedValueOnce({
        documents: [{ $id: 'agent-2', name: 'Agent 2', isActive: true, role: 'agent' }]
      });
      mockListDocuments.mockResolvedValueOnce({
        documents: [{ userId: 'agent-2', present: false }]
      });
      mockListDocuments.mockResolvedValueOnce({
        documents: [] // linkedin accounts
      });

      const { listMyTeamAttendanceAction } = await import('@/app/actions/attendance/list');
      const result = await listMyTeamAttendanceAction({ currentUserId: 'admin-1', teamLeadId: 'tl-2' });
      
      expect(result.teamLead.userId).toBe('tl-2');
      expect(result.rows[0].userId).toBe('agent-2');
      expect(result.rows[0].present).toBe(false);
    });

    it('throws if non-admin tries to see another team lead', async () => {
      mockGetAuthenticatedUserDoc.mockResolvedValue({
        $id: 'agent-1',
        role: 'agent',
      });
      const { listMyTeamAttendanceAction } = await import('@/app/actions/attendance/list');
      await expect(listMyTeamAttendanceAction({ currentUserId: 'agent-1', teamLeadId: 'tl-2' })).rejects.toThrow('Unauthorized');
    });
  });
});
