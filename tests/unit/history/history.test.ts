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
  },
}));

describe('History Functionality', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Closed Leads Filtering', () => {
    it('should return only closed leads in history', async () => {
      const mockLeads = [
        {
          $id: 'lead-1',
          data: JSON.stringify({ firstName: 'John', lastName: 'Doe' }),
          status: 'Won',
          ownerId: 'manager-1',
          assignedToId: 'agent-1',
          isClosed: true,
          closedAt: '2024-01-15T10:00:00.000Z',
          $createdAt: '2024-01-01T10:00:00.000Z',
        },
      ];

      (databases.listDocuments as jest.Mock).mockResolvedValue({
        documents: mockLeads,
        total: 1,
      });

      const result = await listLeads({ isClosed: true }, 'manager-1', 'manager');

      expect(result).toHaveLength(1);
      expect(result.every((lead) => lead.isClosed === true)).toBe(true);
    });
  });

  describe('Manager Lead Reopen', () => {
    it('should allow manager to reopen a closed lead', async () => {
      const mockClosedLead = {
        $id: 'lead-1',
        data: JSON.stringify({ firstName: 'John', lastName: 'Doe' }),
        status: 'Won',
        ownerId: 'manager-1',
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
          ownerId: 'manager-1',
          assignedToId: 'agent-1',
          isClosed: true,
          closedAt: '2024-01-15T10:00:00.000Z',
          $createdAt: '2024-01-01T10:00:00.000Z',
        },
      ];

      (databases.listDocuments as jest.Mock).mockResolvedValue({
        documents: mockLeads,
        total: 1,
      });

      const result = await listLeads(
        { isClosed: true, status: 'Won' },
        'manager-1',
        'manager'
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
          ownerId: 'manager-1',
          assignedToId: 'agent-1',
          isClosed: true,
          closedAt: '2024-01-15T10:00:00.000Z',
          $createdAt: '2024-01-01T10:00:00.000Z',
        },
      ];

      (databases.listDocuments as jest.Mock).mockResolvedValue({
        documents: mockLeads,
        total: 1,
      });

      const result = await listLeads(
        { isClosed: true, assignedToId: 'agent-1' },
        'manager-1',
        'manager'
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
          ownerId: 'manager-1',
          assignedToId: 'agent-1',
          isClosed: true,
          closedAt: '2024-01-15T10:00:00.000Z',
          $createdAt: '2024-01-01T10:00:00.000Z',
        },
      ];

      (databases.listDocuments as jest.Mock).mockResolvedValue({
        documents: mockLeads,
        total: 1,
      });

      const result = await listLeads({ isClosed: true }, 'agent-1', 'agent');

      expect(result).toHaveLength(1);
      expect(result[0].assignedToId).toBe('agent-1');
    });
  });
});
