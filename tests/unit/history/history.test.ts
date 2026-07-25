import { listLeads, reopenLead } from '@/lib/services/lead-service';
import { databases } from '@/lib/appwrite';
import { Query } from 'appwrite';

jest.mock('@/lib/appwrite', () => ({
  databases: {
    listDocuments: jest.fn(),
    getDocument: jest.fn(),
    updateDocument: jest.fn(),
  },
  DATABASE_ID: 'test-database',
  COLLECTIONS: {
    LEADS: 'test-leads-collection',
    // listLeads resolves the caller with getUserById and, for team leads,
    // reads the team roster out of the users collection, so the mock has to
    // know about that collection too.
    USERS: 'test-users-collection',
  },
}));

const USERS_COLLECTION = 'test-users-collection';

// Roster returned for the users collection: the team lead under test plus the
// one agent reporting to them.
const teamUserDocs = [
  {
    $id: 'agent-1',
    name: 'Agent One',
    email: 'agent-1@test.com',
    role: 'agent',
    teamLeadId: 'teamLead-1',
    branchIds: [],
  },
];

/**
 * Route listDocuments by collection: leads for the leads collection, the team
 * roster for the users collection. A single mockResolvedValue would hand the
 * lead documents back as if they were user documents.
 */
function mockDocuments(leadDocs: unknown[]) {
  (databases.listDocuments as jest.Mock).mockImplementation(
    async (_databaseId: string, collectionId: string) => {
      if (collectionId === USERS_COLLECTION) {
        return { documents: teamUserDocs, total: teamUserDocs.length };
      }
      return { documents: leadDocs, total: leadDocs.length };
    }
  );
}

describe('History Functionality', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    // getUserById (called by listLeads to resolve the acting user) reads a
    // single user document. Without a default the mock resolves undefined and
    // mapDocToUser throws on `doc.$id`.
    (databases.getDocument as jest.Mock).mockImplementation(
      async (_databaseId: string, _collectionId: string, documentId: string) => ({
        $id: documentId,
        name: documentId,
        email: `${documentId}@test.com`,
        role: documentId.startsWith('agent') ? 'agent' : 'team_lead',
        teamLeadId: null,
        branchIds: [],
      })
    );
  });

  describe('Closed Leads Filtering', () => {
    it('should return only closed leads in history', async () => {
      const mockLeads = [
        {
          $id: 'lead-1',
          data: JSON.stringify({ firstName: 'John', lastName: 'Doe' }),
          status: 'Won',
          ownerId: 'teamLead-1',
          assignedToId: 'agent-1',
          isClosed: true,
          closedAt: '2024-01-15T10:00:00.000Z',
          $createdAt: '2024-01-01T10:00:00.000Z',
        },
      ];

      mockDocuments(mockLeads);

      const result = await listLeads({ isClosed: true }, 'teamLead-1', 'team_lead');

      expect(result).toHaveLength(1);
      expect(result.every((lead) => lead.isClosed === true)).toBe(true);
    });
  });

  describe('TeamLead Lead Reopen', () => {
    it('should allow teamLead to reopen a closed lead', async () => {
      const mockClosedLead = {
        $id: 'lead-1',
        data: JSON.stringify({ firstName: 'John', lastName: 'Doe' }),
        status: 'Won',
        ownerId: 'teamLead-1',
        assignedToId: 'agent-1',
        isClosed: true,
        closedAt: '2024-01-15T10:00:00.000Z',
        $createdAt: '2024-01-01T10:00:00.000Z',
      };

      const mockReopenedLead = {
        ...mockClosedLead,
        isClosed: false,
      };

      (databases.getDocument as jest.Mock).mockResolvedValue(mockClosedLead);
      (databases.updateDocument as jest.Mock).mockResolvedValue(mockReopenedLead);

      const result = await reopenLead('lead-1');

      expect(result.isClosed).toBe(false);
      expect(result.closedAt).toBe('2024-01-15T10:00:00.000Z');
    });
  });

  describe('History Filters', () => {
    it('should filter history by status', async () => {
      const mockLeads = [
        {
          $id: 'lead-1',
          data: JSON.stringify({ firstName: 'John', lastName: 'Doe' }),
          status: 'Won',
          ownerId: 'teamLead-1',
          assignedToId: 'agent-1',
          isClosed: true,
          closedAt: '2024-01-15T10:00:00.000Z',
          $createdAt: '2024-01-01T10:00:00.000Z',
        },
      ];

      mockDocuments(mockLeads);

      const result = await listLeads(
        { isClosed: true, status: 'Won' },
        'teamLead-1',
        'team_lead'
      );

      expect(result).toHaveLength(1);
      expect(result[0].status).toBe('Won');
    });

    it('should filter history by agent', async () => {
      const mockLeads = [
        {
          $id: 'lead-1',
          data: JSON.stringify({ firstName: 'John', lastName: 'Doe' }),
          status: 'Won',
          ownerId: 'teamLead-1',
          assignedToId: 'agent-1',
          isClosed: true,
          closedAt: '2024-01-15T10:00:00.000Z',
          $createdAt: '2024-01-01T10:00:00.000Z',
        },
      ];

      mockDocuments(mockLeads);

      const result = await listLeads(
        { isClosed: true, assignedToId: 'agent-1' },
        'teamLead-1',
        'team_lead'
      );

      expect(result).toHaveLength(1);
      expect(result[0].assignedToId).toBe('agent-1');
    });
  });

  describe('Agent History Access', () => {
    it('should show only assigned closed leads to agents', async () => {
      const mockLeads = [
        {
          $id: 'lead-1',
          data: JSON.stringify({ firstName: 'John', lastName: 'Doe' }),
          status: 'Won',
          ownerId: 'teamLead-1',
          assignedToId: 'agent-1',
          isClosed: true,
          closedAt: '2024-01-15T10:00:00.000Z',
          $createdAt: '2024-01-01T10:00:00.000Z',
        },
      ];

      mockDocuments(mockLeads);

      const result = await listLeads({ isClosed: true }, 'agent-1', 'agent');

      expect(result).toHaveLength(1);
      expect(result[0].assignedToId).toBe('agent-1');
    });
  });
});
