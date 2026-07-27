export {};

const mockAssertAuthenticatedUserId = jest.fn();
const mockCreateAdminClient = jest.fn();
const mockListDocuments = jest.fn();
const mockGetDocument = jest.fn();
const mockCreateDocument = jest.fn();
const mockUpdateDocument = jest.fn();
const mockUpsertPendingAmountAction = jest.fn();

jest.mock('@/lib/server/current-user', () => ({
  assertAuthenticatedUserId: (...args: unknown[]) => mockAssertAuthenticatedUserId(...args),
}));

jest.mock('@/lib/server/appwrite', () => ({
  createAdminClient: () => mockCreateAdminClient(),
}));

jest.mock('node-appwrite', () => ({
  ID: {
    unique: jest.fn(() => 'unique-id'),
  },
  Query: {
    equal: jest.fn((key, value) => `equal:${key}:${JSON.stringify(value)}`),
    or: jest.fn((conditions) => `or:${conditions.join('|')}`),
    limit: jest.fn((limit) => `limit:${limit}`),
    select: jest.fn((fields) => `select:${JSON.stringify(fields)}`),
    greaterThanEqual: jest.fn((key, value) => `gte:${key}:${value}`),
    lessThanEqual: jest.fn((key, value) => `lte:${key}:${value}`),
  },
}));

jest.mock('@/lib/server/appwrite-pagination', () => ({
  listAllDocuments: jest.fn(async (args) => {
    const res = await mockListDocuments(args.databaseId, args.collectionId, args.queries);
    return res.documents || [];
  }),
}));

jest.mock('@/app/actions/pending-amounts', () => ({
  upsertPendingAmountAction: (...args: unknown[]) => mockUpsertPendingAmountAction(...args),
}));

describe('client payments server action authorization', () => {
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    process.env.NEXT_PUBLIC_APPWRITE_DATABASE_ID = 'database';
    process.env.NEXT_PUBLIC_APPWRITE_USERS_COLLECTION_ID = 'users';
    process.env.NEXT_PUBLIC_APPWRITE_LEADS_COLLECTION_ID = 'leads';
    process.env.NEXT_PUBLIC_APPWRITE_CLIENT_PAYMENTS_COLLECTION_ID = 'client_payments';

    mockAssertAuthenticatedUserId.mockResolvedValue({ $id: 'viewer-1' });
    mockCreateAdminClient.mockResolvedValue({
      databases: {
        listDocuments: mockListDocuments,
        getDocument: mockGetDocument,
        updateDocument: mockUpdateDocument,
        createDocument: mockCreateDocument,
      },
    });
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  describe('listClientPaymentSummariesAction', () => {
    it('allows admins to see all requested leads', async () => {
      mockGetDocument.mockResolvedValueOnce({
        $id: 'admin-1',
        email: 'admin@example.com',
        role: 'admin',
        branchIds: [],
      });

      mockListDocuments.mockResolvedValueOnce({
        documents: [
          { $id: 'lead-1', ownerId: 'other-1', branchId: 'branch-2' },
          { $id: 'lead-2', ownerId: 'other-2', branchId: 'branch-3' }
        ]
      });

      mockListDocuments.mockResolvedValueOnce({
        documents: [
          { $id: 'payment-1', leadId: 'lead-1', status: 'partially_paid' },
          { $id: 'payment-2', leadId: 'lead-2', status: 'fully_paid' }
        ]
      });

      const { listClientPaymentSummariesAction } = await import('@/app/actions/client-payments/list');

      const result = await listClientPaymentSummariesAction({
        actorId: 'admin-1',
        leadIds: ['lead-1', 'lead-2']
      });

      expect(result).toHaveLength(2);
      expect(result.map(r => r.leadId)).toEqual(['lead-1', 'lead-2']);
    });

    it('restricts agents to their own leads', async () => {
      mockGetDocument.mockResolvedValueOnce({
        $id: 'agent-1',
        email: 'agent@example.com',
        role: 'agent',
        branchIds: ['branch-1'],
      });

      // return both leads
      mockListDocuments.mockResolvedValueOnce({
        documents: [
          { $id: 'lead-1', ownerId: 'agent-1', branchId: 'branch-1' }, // Agent's lead
          { $id: 'lead-2', ownerId: 'other-1', branchId: 'branch-1' }  // Not agent's lead
        ]
      });

      // only lead-1's payment is fetched
      mockListDocuments.mockResolvedValueOnce({
        documents: [
          { $id: 'payment-1', leadId: 'lead-1', status: 'partially_paid' }
        ]
      });

      const { listClientPaymentSummariesAction } = await import('@/app/actions/client-payments/list');

      const result = await listClientPaymentSummariesAction({
        actorId: 'agent-1',
        leadIds: ['lead-1', 'lead-2']
      });

      expect(result).toHaveLength(1);
      expect(result[0].leadId).toBe('lead-1');
    });

    it('allows team leads to see their agents leads', async () => {
      mockGetDocument.mockResolvedValueOnce({
        $id: 'tl-1',
        email: 'tl@example.com',
        role: 'team_lead',
        branchIds: ['branch-1'],
      });

      mockListDocuments.mockResolvedValueOnce({
        documents: [
          { $id: 'lead-1', ownerId: 'agent-1', branchId: 'branch-1' }, // In team lead branch
          { $id: 'lead-2', ownerId: 'other-1', branchId: 'branch-2' }  // Out of branch, not team's
        ]
      });

      // Agents under this team lead
      mockListDocuments.mockResolvedValueOnce({
        documents: [
          { $id: 'agent-1' }
        ]
      });

      mockListDocuments.mockResolvedValueOnce({
        documents: [
          { $id: 'payment-1', leadId: 'lead-1', status: 'partially_paid' }
        ]
      });

      const { listClientPaymentSummariesAction } = await import('@/app/actions/client-payments/list');

      const result = await listClientPaymentSummariesAction({
        actorId: 'tl-1',
        leadIds: ['lead-1', 'lead-2']
      });

      expect(result).toHaveLength(1);
      expect(result[0].leadId).toBe('lead-1');
    });
  });

  describe('addClientPaymentUpdateAction', () => {
    it('allows admins to add an update', async () => {
      mockGetDocument.mockImplementation(async (db, col, id) => {
        if (id === 'admin-1') {
          return {
            $id: 'admin-1',
            name: 'Admin User',
            email: 'admin@example.com',
            role: 'admin',
            branchIds: [],
          };
        }
        if (id === 'lead-1') {
          return {
            $id: 'lead-1',
            ownerId: 'other-1',
            branchId: 'branch-1',
          };
        }
        throw new Error('Not found');
      });

      mockListDocuments.mockResolvedValueOnce({
        documents: [
          { 
            $id: 'payment-1', 
            leadId: 'lead-1', 
            updates: '[]', 
            status: 'not_paid' 
          }
        ]
      });

      mockUpdateDocument.mockResolvedValueOnce({
        $id: 'payment-1',
        leadId: 'lead-1',
        updates: '[{}]',
        status: 'partially_paid'
      });

      const { addClientPaymentUpdateAction } = await import('@/app/actions/client-payments/record');

      const result = await addClientPaymentUpdateAction({
        actorId: 'admin-1',
        leadId: 'lead-1',
        status: 'partially_paid',
        amount: 500,
      });

      expect(result.$id).toBe('payment-1');
      expect(mockUpdateDocument).toHaveBeenCalled();
    });

    it('rejects operations users from mutating client payments', async () => {
      mockGetDocument.mockResolvedValueOnce({
        $id: 'ops-1',
        name: 'Ops User',
        email: 'ops@example.com',
        role: 'operations',
        branchIds: [],
      });

      const { addClientPaymentUpdateAction } = await import('@/app/actions/client-payments/record');

      await expect(addClientPaymentUpdateAction({
        actorId: 'ops-1',
        leadId: 'lead-1',
        status: 'partially_paid',
        amount: 500,
      })).rejects.toThrow('Not authorized');

      expect(mockUpdateDocument).not.toHaveBeenCalled();
    });

    it('rejects agents trying to mutate leads they do not own', async () => {
      mockGetDocument.mockImplementation(async (db, col, id) => {
        if (id === 'agent-1') {
          return {
            $id: 'agent-1',
            name: 'Agent User',
            email: 'agent@example.com',
            role: 'agent',
            branchIds: ['branch-1'],
          };
        }
        if (id === 'lead-1') {
          return {
            $id: 'lead-1',
            ownerId: 'other-1', // Not the agent
            branchId: 'branch-1',
          };
        }
        throw new Error('Not found');
      });

      const { addClientPaymentUpdateAction } = await import('@/app/actions/client-payments/record');

      await expect(addClientPaymentUpdateAction({
        actorId: 'agent-1',
        leadId: 'lead-1',
        status: 'partially_paid',
        amount: 500,
      })).rejects.toThrow('Not authorized');

      expect(mockUpdateDocument).not.toHaveBeenCalled();
    });
  });
});
