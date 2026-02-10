import {
  createLead,
  updateLead,
  deleteLead,
  getLead,
  listLeads,
  closeLead,
  reopenLead,
  assignLead,
} from '@/lib/services/lead-service';
import { databases } from '@/lib/appwrite';
import { Lead, CreateLeadInput, LeadData } from '@/lib/types';
import { Permission, Role } from 'appwrite';

// Mock the Appwrite modules
jest.mock('@/lib/appwrite', () => ({
  databases: {
    createDocument: jest.fn(),
    getDocument: jest.fn(),
    updateDocument: jest.fn(),
    deleteDocument: jest.fn(),
    listDocuments: jest.fn(),
  },
  DATABASE_ID: 'test-database',
  COLLECTIONS: {
    LEADS: 'test-leads-collection',
  },
}));

describe('Lead Service', () => {
  const mockManagerId = 'manager-123';
  const mockAgentId = 'agent-456';
  const mockLeadData: LeadData = {
    firstName: 'John',
    lastName: 'Doe',
    email: 'john@example.com',
    phone: '+1234567890',
    company: 'Acme Corp',
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('createLead', () => {
    it('should create a lead with valid data', async () => {
      const input: CreateLeadInput = {
        data: mockLeadData,
        ownerId: mockManagerId,
        assignedToId: mockAgentId,
        status: 'New',
      };

      const mockCreatedLead: Lead = {
        $id: 'lead-123',
        data: JSON.stringify(mockLeadData),
        status: 'New',
        ownerId: mockManagerId,
        assignedToId: mockAgentId,
        isClosed: false,
        closedAt: null,
      };

      (databases.createDocument as jest.Mock).mockResolvedValue(mockCreatedLead);

      const result = await createLead(input);

      expect(result).toEqual(mockCreatedLead);
      expect(databases.createDocument).toHaveBeenCalledWith(
        'test-database',
        'test-leads-collection',
        'unique()',
        {
          data: JSON.stringify(mockLeadData),
          status: 'New',
          ownerId: mockManagerId,
          assignedToId: mockAgentId,
          isClosed: false,
          closedAt: null,
        },
        expect.arrayContaining([
          Permission.read(Role.user(mockManagerId)),
          Permission.update(Role.user(mockManagerId)),
          Permission.delete(Role.user(mockManagerId)),
          Permission.read(Role.user(mockAgentId)),
          Permission.update(Role.user(mockAgentId)),
        ])
      );
    });

    it('should create a lead without assigned agent', async () => {
      const input: CreateLeadInput = {
        data: mockLeadData,
        ownerId: mockManagerId,
        status: 'New',
      };

      const mockCreatedLead: Lead = {
        $id: 'lead-124',
        data: JSON.stringify(mockLeadData),
        status: 'New',
        ownerId: mockManagerId,
        assignedToId: null,
        isClosed: false,
        closedAt: null,
      };

      (databases.createDocument as jest.Mock).mockResolvedValue(mockCreatedLead);

      const result = await createLead(input);

      expect(result.assignedToId).toBeNull();
      expect(databases.createDocument).toHaveBeenCalledWith(
        'test-database',
        'test-leads-collection',
        'unique()',
        expect.objectContaining({
          assignedToId: null,
        }),
        expect.arrayContaining([
          Permission.read(Role.user(mockManagerId)),
          Permission.update(Role.user(mockManagerId)),
          Permission.delete(Role.user(mockManagerId)),
        ])
      );
    });

    it('should use default status "New" if not provided', async () => {
      const input: CreateLeadInput = {
        data: mockLeadData,
        ownerId: mockManagerId,
        status: '',
      };

      const mockCreatedLead: Lead = {
        $id: 'lead-125',
        data: JSON.stringify(mockLeadData),
        status: 'New',
        ownerId: mockManagerId,
        assignedToId: null,
        isClosed: false,
        closedAt: null,
      };

      (databases.createDocument as jest.Mock).mockResolvedValue(mockCreatedLead);

      await createLead(input);

      expect(databases.createDocument).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        expect.any(String),
        expect.objectContaining({
          status: 'New',
        }),
        expect.any(Array)
      );
    });

    it('should throw error when creation fails', async () => {
      const input: CreateLeadInput = {
        data: mockLeadData,
        ownerId: mockManagerId,
        status: 'New',
      };

      (databases.createDocument as jest.Mock).mockRejectedValue({
        message: 'Database error',
      });

      await expect(createLead(input)).rejects.toThrow('Database error');
    });
  });

  describe('updateLead', () => {
    it('should update lead with new data', async () => {
      const leadId = 'lead-123';
      const currentLead: Lead = {
        $id: leadId,
        data: JSON.stringify(mockLeadData),
        status: 'New',
        ownerId: mockManagerId,
        assignedToId: mockAgentId,
        isClosed: false,
        closedAt: null,
      };

      const updatedData: Partial<LeadData> = {
        status: 'Contacted',
        phone: '+9876543210',
      };

      const expectedMergedData = {
        ...mockLeadData,
        ...updatedData,
      };

      (databases.getDocument as jest.Mock).mockResolvedValue(currentLead);
      (databases.updateDocument as jest.Mock).mockResolvedValue({
        ...currentLead,
        data: JSON.stringify(expectedMergedData),
        status: 'Contacted',
      });

      const result = await updateLead(leadId, updatedData);

      expect(databases.updateDocument).toHaveBeenCalledWith(
        'test-database',
        'test-leads-collection',
        leadId,
        {
          data: JSON.stringify(expectedMergedData),
          status: 'Contacted',
        }
      );
    });

    it('should merge updated data with existing data', async () => {
      const leadId = 'lead-123';
      const currentLead: Lead = {
        $id: leadId,
        data: JSON.stringify(mockLeadData),
        status: 'New',
        ownerId: mockManagerId,
        assignedToId: mockAgentId,
        isClosed: false,
        closedAt: null,
      };

      const partialUpdate: Partial<LeadData> = {
        company: 'New Company Inc',
      };

      (databases.getDocument as jest.Mock).mockResolvedValue(currentLead);
      (databases.updateDocument as jest.Mock).mockResolvedValue(currentLead);

      await updateLead(leadId, partialUpdate);

      const callArgs = (databases.updateDocument as jest.Mock).mock.calls[0];
      const updatedDataJson = callArgs[3].data;
      const updatedData = JSON.parse(updatedDataJson);

      expect(updatedData.firstName).toBe('John');
      expect(updatedData.lastName).toBe('Doe');
      expect(updatedData.company).toBe('New Company Inc');
    });

    it('should throw error when lead not found', async () => {
      (databases.getDocument as jest.Mock).mockRejectedValue({
        message: 'Lead not found',
      });

      await expect(updateLead('invalid-id', {})).rejects.toThrow('Lead not found');
    });
  });

  describe('deleteLead', () => {
    it('should delete a lead by ID', async () => {
      const leadId = 'lead-123';

      (databases.deleteDocument as jest.Mock).mockResolvedValue(undefined);

      await deleteLead(leadId);

      expect(databases.deleteDocument).toHaveBeenCalledWith(
        'test-database',
        'test-leads-collection',
        leadId
      );
    });

    it('should throw error when deletion fails', async () => {
      const leadId = 'lead-123';

      (databases.deleteDocument as jest.Mock).mockRejectedValue({
        message: 'Permission denied',
      });

      await expect(deleteLead(leadId)).rejects.toThrow('Permission denied');
    });
  });

  describe('getLead', () => {
    it('should fetch a lead by ID', async () => {
      const leadId = 'lead-123';
      const mockLead: Lead = {
        $id: leadId,
        data: JSON.stringify(mockLeadData),
        status: 'New',
        ownerId: mockManagerId,
        assignedToId: mockAgentId,
        isClosed: false,
        closedAt: null,
      };

      (databases.getDocument as jest.Mock).mockResolvedValue(mockLead);

      const result = await getLead(leadId);

      expect(result).toEqual(mockLead);
      expect(databases.getDocument).toHaveBeenCalledWith(
        'test-database',
        'test-leads-collection',
        leadId
      );
    });

    it('should throw error when lead not found', async () => {
      (databases.getDocument as jest.Mock).mockRejectedValue({
        message: 'Lead not found',
      });

      await expect(getLead('invalid-id')).rejects.toThrow('Lead not found');
    });
  });

  describe('listLeads', () => {
    const mockLeads: Lead[] = [
      {
        $id: 'lead-1',
        data: JSON.stringify({ firstName: 'John', lastName: 'Doe' }),
        status: 'New',
        ownerId: mockManagerId,
        assignedToId: mockAgentId,
        isClosed: false,
        closedAt: null,
      },
      {
        $id: 'lead-2',
        data: JSON.stringify({ firstName: 'Jane', lastName: 'Smith' }),
        status: 'Contacted',
        ownerId: mockManagerId,
        assignedToId: mockAgentId,
        isClosed: false,
        closedAt: null,
      },
    ];

    it('should list leads for manager (all owned leads)', async () => {
      (databases.listDocuments as jest.Mock).mockResolvedValue({
        documents: mockLeads,
      });

      const result = await listLeads({}, mockManagerId, 'manager');

      expect(result).toEqual(mockLeads);
      expect(databases.listDocuments).toHaveBeenCalled();
    });

    it('should list leads for agent (only assigned leads)', async () => {
      (databases.listDocuments as jest.Mock).mockResolvedValue({
        documents: mockLeads,
      });

      const result = await listLeads({}, mockAgentId, 'agent');

      expect(result).toEqual(mockLeads);
      expect(databases.listDocuments).toHaveBeenCalled();
    });

    it('should filter leads by status', async () => {
      const filteredLeads = [mockLeads[0]];
      (databases.listDocuments as jest.Mock).mockResolvedValue({
        documents: filteredLeads,
      });

      const result = await listLeads({ status: 'New' }, mockManagerId, 'manager');

      expect(result).toEqual(filteredLeads);
    });

    it('should filter leads by search query', async () => {
      (databases.listDocuments as jest.Mock).mockResolvedValue({
        documents: mockLeads,
      });

      const result = await listLeads({ searchQuery: 'John' }, mockManagerId, 'manager');

      expect(result).toHaveLength(1);
      expect(result[0].$id).toBe('lead-1');
    });

    it('should filter leads by date range', async () => {
      (databases.listDocuments as jest.Mock).mockResolvedValue({
        documents: mockLeads,
      });

      await listLeads(
        {
          dateFrom: '2024-01-01',
          dateTo: '2024-12-31',
        },
        mockManagerId,
        'manager'
      );

      expect(databases.listDocuments).toHaveBeenCalled();
    });

    it('should throw error when listing fails', async () => {
      (databases.listDocuments as jest.Mock).mockRejectedValue({
        message: 'Database error',
      });

      await expect(listLeads({}, mockManagerId, 'manager')).rejects.toThrow('Database error');
    });
  });

  describe('closeLead', () => {
    it('should close a lead and set correct fields', async () => {
      const leadId = 'lead-123';
      const currentLead: Lead = {
        $id: leadId,
        data: JSON.stringify(mockLeadData),
        status: 'Qualified',
        ownerId: mockManagerId,
        assignedToId: mockAgentId,
        isClosed: false,
        closedAt: null,
      };

      const closedLead: Lead = {
        ...currentLead,
        isClosed: true,
        closedAt: '2024-01-15T10:00:00.000Z',
        status: 'Won',
      };

      (databases.getDocument as jest.Mock).mockResolvedValue(currentLead);
      (databases.updateDocument as jest.Mock).mockResolvedValue(closedLead);

      const result = await closeLead(leadId, 'Won');

      expect(result.isClosed).toBe(true);
      expect(result.closedAt).toBeTruthy();
      expect(result.status).toBe('Won');
      expect(databases.updateDocument).toHaveBeenCalledWith(
        'test-database',
        'test-leads-collection',
        leadId,
        expect.objectContaining({
          isClosed: true,
          status: 'Won',
        }),
        expect.arrayContaining([
          Permission.read(Role.user(mockManagerId)),
          Permission.update(Role.user(mockManagerId)),
          Permission.delete(Role.user(mockManagerId)),
          Permission.read(Role.user(mockAgentId)),
        ])
      );
    });

    it('should set agent permissions to read-only when closing', async () => {
      const leadId = 'lead-123';
      const currentLead: Lead = {
        $id: leadId,
        data: JSON.stringify(mockLeadData),
        status: 'Qualified',
        ownerId: mockManagerId,
        assignedToId: mockAgentId,
        isClosed: false,
        closedAt: null,
      };

      (databases.getDocument as jest.Mock).mockResolvedValue(currentLead);
      (databases.updateDocument as jest.Mock).mockResolvedValue({
        ...currentLead,
        isClosed: true,
      });

      await closeLead(leadId, 'Closed');

      const callArgs = (databases.updateDocument as jest.Mock).mock.calls[0];
      const permissions = callArgs[4];

      // Agent should only have read permission
      const agentReadPermission = permissions.find((p: string) =>
        p.includes(mockAgentId) && p.includes('read')
      );
      const agentUpdatePermission = permissions.find((p: string) =>
        p.includes(mockAgentId) && p.includes('update')
      );

      expect(agentReadPermission).toBeDefined();
      expect(agentUpdatePermission).toBeUndefined();
    });

    it('should handle closing lead without assigned agent', async () => {
      const leadId = 'lead-123';
      const currentLead: Lead = {
        $id: leadId,
        data: JSON.stringify(mockLeadData),
        status: 'New',
        ownerId: mockManagerId,
        assignedToId: null,
        isClosed: false,
        closedAt: null,
      };

      (databases.getDocument as jest.Mock).mockResolvedValue(currentLead);
      (databases.updateDocument as jest.Mock).mockResolvedValue({
        ...currentLead,
        isClosed: true,
      });

      await closeLead(leadId, 'Closed');

      expect(databases.updateDocument).toHaveBeenCalled();
    });

    it('should throw error when closing fails', async () => {
      (databases.getDocument as jest.Mock).mockRejectedValue({
        message: 'Lead not found',
      });

      await expect(closeLead('invalid-id', 'Closed')).rejects.toThrow('Lead not found');
    });
  });

  describe('reopenLead', () => {
    it('should reopen a closed lead', async () => {
      const leadId = 'lead-123';
      const closedLead: Lead = {
        $id: leadId,
        data: JSON.stringify(mockLeadData),
        status: 'Won',
        ownerId: mockManagerId,
        assignedToId: mockAgentId,
        isClosed: true,
        closedAt: '2024-01-15T10:00:00.000Z',
      };

      const reopenedLead: Lead = {
        ...closedLead,
        isClosed: false,
      };

      (databases.getDocument as jest.Mock).mockResolvedValue(closedLead);
      (databases.updateDocument as jest.Mock).mockResolvedValue(reopenedLead);

      const result = await reopenLead(leadId);

      expect(result.isClosed).toBe(false);
      expect(result.closedAt).toBe('2024-01-15T10:00:00.000Z'); // Preserved
      expect(databases.updateDocument).toHaveBeenCalledWith(
        'test-database',
        'test-leads-collection',
        leadId,
        {
          isClosed: false,
        },
        expect.arrayContaining([
          Permission.read(Role.user(mockManagerId)),
          Permission.update(Role.user(mockManagerId)),
          Permission.delete(Role.user(mockManagerId)),
          Permission.read(Role.user(mockAgentId)),
          Permission.update(Role.user(mockAgentId)),
        ])
      );
    });

    it('should preserve closedAt timestamp when reopening', async () => {
      const leadId = 'lead-123';
      const originalClosedAt = '2024-01-15T10:00:00.000Z';
      const closedLead: Lead = {
        $id: leadId,
        data: JSON.stringify(mockLeadData),
        status: 'Won',
        ownerId: mockManagerId,
        assignedToId: mockAgentId,
        isClosed: true,
        closedAt: originalClosedAt,
      };

      (databases.getDocument as jest.Mock).mockResolvedValue(closedLead);
      (databases.updateDocument as jest.Mock).mockResolvedValue({
        ...closedLead,
        isClosed: false,
      });

      await reopenLead(leadId);

      const callArgs = (databases.updateDocument as jest.Mock).mock.calls[0];
      const updateData = callArgs[3];

      // closedAt should not be in the update (preserved)
      expect(updateData.closedAt).toBeUndefined();
      expect(updateData.isClosed).toBe(false);
    });

    it('should restore agent update permissions when reopening', async () => {
      const leadId = 'lead-123';
      const closedLead: Lead = {
        $id: leadId,
        data: JSON.stringify(mockLeadData),
        status: 'Won',
        ownerId: mockManagerId,
        assignedToId: mockAgentId,
        isClosed: true,
        closedAt: '2024-01-15T10:00:00.000Z',
      };

      (databases.getDocument as jest.Mock).mockResolvedValue(closedLead);
      (databases.updateDocument as jest.Mock).mockResolvedValue({
        ...closedLead,
        isClosed: false,
      });

      await reopenLead(leadId);

      const callArgs = (databases.updateDocument as jest.Mock).mock.calls[0];
      const permissions = callArgs[4];

      // Agent should have both read and update permissions
      const agentReadPermission = permissions.find((p: string) =>
        p.includes(mockAgentId) && p.includes('read')
      );
      const agentUpdatePermission = permissions.find((p: string) =>
        p.includes(mockAgentId) && p.includes('update')
      );

      expect(agentReadPermission).toBeDefined();
      expect(agentUpdatePermission).toBeDefined();
    });

    it('should handle reopening lead without assigned agent', async () => {
      const leadId = 'lead-123';
      const closedLead: Lead = {
        $id: leadId,
        data: JSON.stringify(mockLeadData),
        status: 'Closed',
        ownerId: mockManagerId,
        assignedToId: null,
        isClosed: true,
        closedAt: '2024-01-15T10:00:00.000Z',
      };

      (databases.getDocument as jest.Mock).mockResolvedValue(closedLead);
      (databases.updateDocument as jest.Mock).mockResolvedValue({
        ...closedLead,
        isClosed: false,
      });

      await reopenLead(leadId);

      expect(databases.updateDocument).toHaveBeenCalled();
    });

    it('should throw error when reopening fails', async () => {
      (databases.getDocument as jest.Mock).mockRejectedValue({
        message: 'Lead not found',
      });

      await expect(reopenLead('invalid-id')).rejects.toThrow('Lead not found');
    });
  });

  describe('assignLead', () => {
    it('should assign lead to a new agent', async () => {
      const leadId = 'lead-123';
      const newAgentId = 'agent-789';
      const currentLead: Lead = {
        $id: leadId,
        data: JSON.stringify(mockLeadData),
        status: 'New',
        ownerId: mockManagerId,
        assignedToId: mockAgentId,
        isClosed: false,
        closedAt: null,
      };

      const assignedLead: Lead = {
        ...currentLead,
        assignedToId: newAgentId,
      };

      (databases.getDocument as jest.Mock).mockResolvedValue(currentLead);
      (databases.updateDocument as jest.Mock).mockResolvedValue(assignedLead);

      const result = await assignLead(leadId, newAgentId);

      expect(result.assignedToId).toBe(newAgentId);
      expect(databases.updateDocument).toHaveBeenCalledWith(
        'test-database',
        'test-leads-collection',
        leadId,
        {
          assignedToId: newAgentId,
        },
        expect.arrayContaining([
          Permission.read(Role.user(mockManagerId)),
          Permission.update(Role.user(mockManagerId)),
          Permission.delete(Role.user(mockManagerId)),
          Permission.read(Role.user(newAgentId)),
          Permission.update(Role.user(newAgentId)),
        ])
      );
    });

    it('should grant new agent read and update permissions for active leads', async () => {
      const leadId = 'lead-123';
      const newAgentId = 'agent-789';
      const currentLead: Lead = {
        $id: leadId,
        data: JSON.stringify(mockLeadData),
        status: 'New',
        ownerId: mockManagerId,
        assignedToId: mockAgentId,
        isClosed: false,
        closedAt: null,
      };

      (databases.getDocument as jest.Mock).mockResolvedValue(currentLead);
      (databases.updateDocument as jest.Mock).mockResolvedValue({
        ...currentLead,
        assignedToId: newAgentId,
      });

      await assignLead(leadId, newAgentId);

      const callArgs = (databases.updateDocument as jest.Mock).mock.calls[0];
      const permissions = callArgs[4];

      const newAgentReadPermission = permissions.find((p: string) =>
        p.includes(newAgentId) && p.includes('read')
      );
      const newAgentUpdatePermission = permissions.find((p: string) =>
        p.includes(newAgentId) && p.includes('update')
      );

      expect(newAgentReadPermission).toBeDefined();
      expect(newAgentUpdatePermission).toBeDefined();
    });

    it('should grant only read permission to new agent for closed leads', async () => {
      const leadId = 'lead-123';
      const newAgentId = 'agent-789';
      const closedLead: Lead = {
        $id: leadId,
        data: JSON.stringify(mockLeadData),
        status: 'Won',
        ownerId: mockManagerId,
        assignedToId: mockAgentId,
        isClosed: true,
        closedAt: '2024-01-15T10:00:00.000Z',
      };

      (databases.getDocument as jest.Mock).mockResolvedValue(closedLead);
      (databases.updateDocument as jest.Mock).mockResolvedValue({
        ...closedLead,
        assignedToId: newAgentId,
      });

      await assignLead(leadId, newAgentId);

      const callArgs = (databases.updateDocument as jest.Mock).mock.calls[0];
      const permissions = callArgs[4];

      const newAgentReadPermission = permissions.find((p: string) =>
        p.includes(newAgentId) && p.includes('read')
      );
      const newAgentUpdatePermission = permissions.find((p: string) =>
        p.includes(newAgentId) && p.includes('update')
      );

      expect(newAgentReadPermission).toBeDefined();
      expect(newAgentUpdatePermission).toBeUndefined();
    });

    it('should remove old agent from permissions', async () => {
      const leadId = 'lead-123';
      const newAgentId = 'agent-789';
      const currentLead: Lead = {
        $id: leadId,
        data: JSON.stringify(mockLeadData),
        status: 'New',
        ownerId: mockManagerId,
        assignedToId: mockAgentId,
        isClosed: false,
        closedAt: null,
      };

      (databases.getDocument as jest.Mock).mockResolvedValue(currentLead);
      (databases.updateDocument as jest.Mock).mockResolvedValue({
        ...currentLead,
        assignedToId: newAgentId,
      });

      await assignLead(leadId, newAgentId);

      const callArgs = (databases.updateDocument as jest.Mock).mock.calls[0];
      const permissions = callArgs[4];

      // Old agent should not have any permissions
      const oldAgentPermissions = permissions.filter((p: string) =>
        p.includes(mockAgentId)
      );

      expect(oldAgentPermissions).toHaveLength(0);
    });

    it('should maintain owner permissions during assignment', async () => {
      const leadId = 'lead-123';
      const newAgentId = 'agent-789';
      const currentLead: Lead = {
        $id: leadId,
        data: JSON.stringify(mockLeadData),
        status: 'New',
        ownerId: mockManagerId,
        assignedToId: mockAgentId,
        isClosed: false,
        closedAt: null,
      };

      (databases.getDocument as jest.Mock).mockResolvedValue(currentLead);
      (databases.updateDocument as jest.Mock).mockResolvedValue({
        ...currentLead,
        assignedToId: newAgentId,
      });

      await assignLead(leadId, newAgentId);

      const callArgs = (databases.updateDocument as jest.Mock).mock.calls[0];
      const permissions = callArgs[4];

      const ownerReadPermission = permissions.find((p: string) =>
        p.includes(mockManagerId) && p.includes('read')
      );
      const ownerUpdatePermission = permissions.find((p: string) =>
        p.includes(mockManagerId) && p.includes('update')
      );
      const ownerDeletePermission = permissions.find((p: string) =>
        p.includes(mockManagerId) && p.includes('delete')
      );

      expect(ownerReadPermission).toBeDefined();
      expect(ownerUpdatePermission).toBeDefined();
      expect(ownerDeletePermission).toBeDefined();
    });

    it('should throw error when assignment fails', async () => {
      (databases.getDocument as jest.Mock).mockRejectedValue({
        message: 'Lead not found',
      });

      await expect(assignLead('invalid-id', 'agent-789')).rejects.toThrow('Lead not found');
    });
  });
});
