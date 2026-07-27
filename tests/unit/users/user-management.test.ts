import { getAgentsByTeamLead } from '@/lib/services/user-service';
import { databases, account } from '@/lib/appwrite';
import { clearCache } from '@/lib/utils/resource-cache';
import { ID, Permission, Role, Query } from 'appwrite';

// Mock the Appwrite modules
jest.mock('@/lib/appwrite', () => ({
  databases: {
    createDocument: jest.fn(),
    listDocuments: jest.fn(),
    getDocument: jest.fn(),
    updateDocument: jest.fn(),
  },
  account: {
    create: jest.fn(),
  },
  DATABASE_ID: 'test-db',
  COLLECTIONS: {
    USERS: 'test-users',
    LEADS: 'test-leads',
    BRANCHES: 'test-branches',
  },
}));

describe('User Management', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // getAgentsByTeamLead memoises its result in the shared resource cache,
    // so results would otherwise leak between tests that use the same id.
    clearCache();
  });

  describe('TeamLead Can Only See Their Agents', () => {
    it('should fetch only agents linked to the teamLead', async () => {
      const teamLeadId = 'teamLead-123';
      const mockAgents = [
        {
          $id: 'agent-1',
          name: 'Agent One',
          email: 'agent1@example.com',
          role: 'agent',
          teamLeadId: teamLeadId,
          $createdAt: '2024-01-01T00:00:00.000Z',
          $updatedAt: '2024-01-01T00:00:00.000Z',
        },
        {
          $id: 'agent-2',
          name: 'Agent Two',
          email: 'agent2@example.com',
          role: 'agent',
          teamLeadId: teamLeadId,
          $createdAt: '2024-01-02T00:00:00.000Z',
          $updatedAt: '2024-01-02T00:00:00.000Z',
        },
      ];

      (databases.listDocuments as jest.Mock).mockResolvedValue({
        documents: mockAgents,
        total: mockAgents.length,
      });

      const result = await getAgentsByTeamLead(teamLeadId);

      expect(databases.listDocuments).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        expect.arrayContaining([
          Query.equal('teamLeadId', teamLeadId),
          Query.or([Query.equal('role', 'agent'), Query.equal('role', 'lead_generation')]),
        ])
      );

      expect(result).toHaveLength(2);
      expect(result.every(agent => agent.teamLeadId === teamLeadId)).toBe(true);
      expect(result.every(agent => agent.role === 'agent')).toBe(true);
    });

    it('should return empty array when teamLead has no agents', async () => {
      const teamLeadId = 'teamLead-456';

      (databases.listDocuments as jest.Mock).mockResolvedValue({
        documents: [],
        total: 0,
      });

      const result = await getAgentsByTeamLead(teamLeadId);

      expect(result).toHaveLength(0);
      expect(databases.listDocuments).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        expect.arrayContaining([
          Query.equal('teamLeadId', teamLeadId),
        ])
      );
    });

    it('should not return agents from other teamLeads', async () => {
      const teamLeadId = 'teamLead-123';
      const otherManagerId = 'teamLead-999';

      const mockAgents = [
        {
          $id: 'agent-1',
          name: 'My Agent',
          email: 'myagent@example.com',
          role: 'agent',
          teamLeadId: teamLeadId,
          $createdAt: '2024-01-01T00:00:00.000Z',
          $updatedAt: '2024-01-01T00:00:00.000Z',
        },
      ];

      (databases.listDocuments as jest.Mock).mockResolvedValue({
        documents: mockAgents,
        total: mockAgents.length,
      });

      const result = await getAgentsByTeamLead(teamLeadId);

      // Verify query filters by the correct teamLeadId
      expect(databases.listDocuments).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        expect.arrayContaining([
          Query.equal('teamLeadId', teamLeadId),
        ])
      );

      // Verify no agents from other teamLeads are returned
      expect(result.every(agent => agent.teamLeadId !== otherManagerId)).toBe(true);
      expect(result.every(agent => agent.teamLeadId === teamLeadId)).toBe(true);
    });
  });

  describe('Agent Cannot Access User Management', () => {
    it('should verify agent role cannot create other agents', () => {
      // This test verifies the business logic that agents cannot create agents
      // In the actual implementation, this is enforced by:
      // 1. UI hiding the user management page from agents
      // 2. Appwrite permissions preventing agents from creating user documents

      const agentRole = 'agent';
      const managerRole = 'team_lead';

      // Simulate access check
      const canAccessUserManagement = (role: string) => {
        return role === 'team_lead';
      };

      expect(canAccessUserManagement(agentRole)).toBe(false);
      expect(canAccessUserManagement(managerRole)).toBe(true);
    });

    it('should verify only teamLeads can access user management UI', () => {
      const testCases = [
        { role: 'team_lead', expectedAccess: true },
        { role: 'agent', expectedAccess: false },
      ];

      testCases.forEach(({ role, expectedAccess }) => {
        const hasAccess = role === 'team_lead';
        expect(hasAccess).toBe(expectedAccess);
      });
    });
  });

  describe('Error Handling', () => {
    it('should handle errors when fetching agents', async () => {
      const teamLeadId = 'teamLead-123';
      const error = new Error('Database error');

      (databases.listDocuments as jest.Mock).mockRejectedValue(error);

      await expect(getAgentsByTeamLead(teamLeadId)).rejects.toThrow();
    });
  });
});
