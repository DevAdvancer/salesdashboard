/**
 * Unit Test: User Creation Regression Tests
 *
 * Tests team lead and agent creation flows to ensure no regressions
 * after changes to createManagerAction.
 *
 * Requirements: 4.1, 4.2
 */

import { createTeamLead, createAgent } from '@/lib/services/user-service';
import { databases, account } from '@/lib/appwrite';

// Mock the Appwrite modules
jest.mock('@/lib/appwrite', () => ({
  databases: {
    createDocument: jest.fn(),
    getDocument: jest.fn(),
    listDocuments: jest.fn(),
  },
  account: {
    create: jest.fn(),
  },
  DATABASE_ID: 'test-database',
  COLLECTIONS: {
    USERS: 'test-users-collection',
    LEADS: 'test-leads-collection',
    BRANCHES: 'test-branches-collection',
  },
}));

describe('User Creation Regression Tests', () => {
  const mockManagerId = 'manager-123';
  const mockTeamLeadId = 'teamlead-456';

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.NEXT_PUBLIC_APPWRITE_DATABASE_ID = 'test-database';
    process.env.NEXT_PUBLIC_APPWRITE_USERS_COLLECTION_ID = 'users';
    process.env.NEXT_PUBLIC_APPWRITE_BRANCHES_COLLECTION_ID = 'test-branches';
  });

  describe('Team Lead Creation Flow', () => {
    it('should allow manager to create team lead with valid data', async () => {
      const mockTeamLeadInput = {
        name: 'Test Team Lead',
        email: 'teamlead@example.com',
        password: 'securePassword123',
        managerId: mockManagerId,
        branchIds: ['branch-1', 'branch-2'],
      };

      const mockManagerDoc = {
        $id: mockManagerId,
        name: 'Test Manager',
        email: 'manager@example.com',
        role: 'manager',
        managerId: null,
        teamLeadId: null,
        branchIds: ['branch-1', 'branch-2', 'branch-3'],
      };

      const mockCreatedTeamLead = {
        $id: mockTeamLeadId,
        name: mockTeamLeadInput.name,
        email: mockTeamLeadInput.email,
        role: 'team_lead',
        managerId: mockManagerId,
        teamLeadId: null,
        branchIds: mockTeamLeadInput.branchIds,
        $createdAt: '2024-01-01T00:00:00.000Z',
        $updatedAt: '2024-01-01T00:00:00.000Z',
      };

      (databases.getDocument as jest.Mock).mockResolvedValue(mockManagerDoc);
      (account.create as jest.Mock).mockResolvedValue({ $id: mockTeamLeadId });
      (databases.createDocument as jest.Mock).mockResolvedValue(mockCreatedTeamLead);

      const result = await createTeamLead(mockTeamLeadInput);

      // Verify success
      expect(result.role).toBe('team_lead');
      expect(result.name).toBe(mockTeamLeadInput.name);
      expect(result.email).toBe(mockTeamLeadInput.email);
      expect(result.managerId).toBe(mockManagerId);

      // Verify manager document was retrieved
      expect(databases.getDocument).toHaveBeenCalledWith(
        'test-database',
        'users',
        mockManagerId
      );

      // Verify user was created in auth system
      expect(account.create).toHaveBeenCalledWith(
        expect.any(String),
        mockTeamLeadInput.email,
        mockTeamLeadInput.password,
        mockTeamLeadInput.name
      );

      // Verify team lead document was created with correct data
      expect(databases.createDocument).toHaveBeenCalledWith(
        'test-database',
        'users',
        expect.any(String),
        expect.objectContaining({
          name: mockTeamLeadInput.name,
          email: mockTeamLeadInput.email,
          role: 'team_lead',
          managerId: mockManagerId,
          branchIds: mockTeamLeadInput.branchIds,
        }),
        expect.any(Array)
      );
    });

    it('should validate branch assignment for team lead creation', async () => {
      const mockTeamLeadInput = {
        name: 'Test Team Lead',
        email: 'teamlead@example.com',
        password: 'securePassword123',
        managerId: mockManagerId,
        branchIds: ['branch-1', 'branch-99'], // branch-99 not in manager's branches
      };

      const mockManagerDoc = {
        $id: mockManagerId,
        name: 'Test Manager',
        email: 'manager@example.com',
        role: 'manager',
        managerId: null,
        teamLeadId: null,
        branchIds: ['branch-1', 'branch-2'],
      };

      (databases.getDocument as jest.Mock).mockResolvedValue(mockManagerDoc);

      await expect(createTeamLead(mockTeamLeadInput)).rejects.toThrow(
        'Branch branch-99 is not in your assigned branches'
      );
    });

    it('should handle duplicate email during team lead creation', async () => {
      const mockTeamLeadInput = {
        name: 'Test Team Lead',
        email: 'existing@example.com',
        password: 'securePassword123',
        managerId: mockManagerId,
        branchIds: ['branch-1'],
      };

      const mockManagerDoc = {
        $id: mockManagerId,
        name: 'Test Manager',
        email: 'manager@example.com',
        role: 'manager',
        managerId: null,
        teamLeadId: null,
        branchIds: ['branch-1', 'branch-2'],
      };

      const duplicateError: any = new Error('User already exists');
      duplicateError.code = 409;

      (databases.getDocument as jest.Mock).mockResolvedValue(mockManagerDoc);
      (account.create as jest.Mock).mockRejectedValue(duplicateError);

      await expect(createTeamLead(mockTeamLeadInput)).rejects.toThrow(
        'A user with this email already exists'
      );
    });

    it('should reject team lead creation with no branches', async () => {
      const mockTeamLeadInput = {
        name: 'Test Team Lead',
        email: 'teamlead@example.com',
        password: 'securePassword123',
        managerId: mockManagerId,
        branchIds: [],
      };

      await expect(createTeamLead(mockTeamLeadInput)).rejects.toThrow(
        'At least one branch must be assigned'
      );

      // Verify no database calls were made
      expect(databases.getDocument).not.toHaveBeenCalled();
      expect(account.create).not.toHaveBeenCalled();
    });
  });

  describe('Agent Creation Flow', () => {
    it('should allow team lead to create agent with valid data', async () => {
      const mockAgentInput = {
        name: 'Test Agent',
        email: 'agent@example.com',
        password: 'securePassword123',
        teamLeadId: mockTeamLeadId,
        branchIds: ['branch-1'],
      };

      const mockTeamLeadDoc = {
        $id: mockTeamLeadId,
        name: 'Test Team Lead',
        email: 'teamlead@example.com',
        role: 'team_lead',
        managerId: mockManagerId,
        teamLeadId: null,
        branchIds: ['branch-1', 'branch-2'],
      };

      const mockAgentId = 'agent-789';

      const mockCreatedAgent = {
        $id: mockAgentId,
        name: mockAgentInput.name,
        email: mockAgentInput.email,
        role: 'agent',
        managerId: mockManagerId,
        teamLeadId: mockTeamLeadId,
        branchIds: mockAgentInput.branchIds,
        $createdAt: '2024-01-01T00:00:00.000Z',
        $updatedAt: '2024-01-01T00:00:00.000Z',
      };

      (databases.getDocument as jest.Mock).mockResolvedValue(mockTeamLeadDoc);
      (account.create as jest.Mock).mockResolvedValue({ $id: mockAgentId });
      (databases.createDocument as jest.Mock).mockResolvedValue(mockCreatedAgent);

      const result = await createAgent(mockAgentInput);

      // Verify success
      expect(result.role).toBe('agent');
      expect(result.name).toBe(mockAgentInput.name);
      expect(result.email).toBe(mockAgentInput.email);
      expect(result.managerId).toBe(mockManagerId);
      expect(result.teamLeadId).toBe(mockTeamLeadId);

      // Verify team lead document was retrieved
      expect(databases.getDocument).toHaveBeenCalledWith(
        'test-database',
        'users',
        mockTeamLeadId
      );

      // Verify user was created in auth system
      expect(account.create).toHaveBeenCalledWith(
        expect.any(String),
        mockAgentInput.email,
        mockAgentInput.password,
        mockAgentInput.name
      );

      // Verify agent document was created with correct data
      expect(databases.createDocument).toHaveBeenCalledWith(
        'test-database',
        'users',
        expect.any(String),
        expect.objectContaining({
          name: mockAgentInput.name,
          email: mockAgentInput.email,
          role: 'agent',
          managerId: mockManagerId,
          teamLeadId: mockTeamLeadId,
          branchIds: mockAgentInput.branchIds,
        }),
        expect.any(Array)
      );
    });

    it('should validate branch assignment for agent creation', async () => {
      const mockAgentInput = {
        name: 'Test Agent',
        email: 'agent@example.com',
        password: 'securePassword123',
        teamLeadId: mockTeamLeadId,
        branchIds: ['branch-1', 'branch-99'], // branch-99 not in team lead's branches
      };

      const mockTeamLeadDoc = {
        $id: mockTeamLeadId,
        name: 'Test Team Lead',
        email: 'teamlead@example.com',
        role: 'team_lead',
        managerId: mockManagerId,
        teamLeadId: null,
        branchIds: ['branch-1', 'branch-2'],
      };

      (databases.getDocument as jest.Mock).mockResolvedValue(mockTeamLeadDoc);

      await expect(createAgent(mockAgentInput)).rejects.toThrow(
        'Branch branch-99 is not in your assigned branches'
      );
    });

    it('should handle duplicate email during agent creation', async () => {
      const mockAgentInput = {
        name: 'Test Agent',
        email: 'existing@example.com',
        password: 'securePassword123',
        teamLeadId: mockTeamLeadId,
        branchIds: ['branch-1'],
      };

      const mockTeamLeadDoc = {
        $id: mockTeamLeadId,
        name: 'Test Team Lead',
        email: 'teamlead@example.com',
        role: 'team_lead',
        managerId: mockManagerId,
        teamLeadId: null,
        branchIds: ['branch-1', 'branch-2'],
      };

      const duplicateError: any = new Error('User already exists');
      duplicateError.code = 409;

      (databases.getDocument as jest.Mock).mockResolvedValue(mockTeamLeadDoc);
      (account.create as jest.Mock).mockRejectedValue(duplicateError);

      await expect(createAgent(mockAgentInput)).rejects.toThrow(
        'A user with this email already exists'
      );
    });

    it('should correctly set managerId from team lead document', async () => {
      const mockAgentInput = {
        name: 'Test Agent',
        email: 'agent@example.com',
        password: 'securePassword123',
        teamLeadId: mockTeamLeadId,
        branchIds: ['branch-1'],
      };

      const mockTeamLeadDoc = {
        $id: mockTeamLeadId,
        name: 'Test Team Lead',
        email: 'teamlead@example.com',
        role: 'team_lead',
        managerId: mockManagerId,
        teamLeadId: null,
        branchIds: ['branch-1', 'branch-2'],
      };

      const mockAgentId = 'agent-789';

      const mockCreatedAgent = {
        $id: mockAgentId,
        name: mockAgentInput.name,
        email: mockAgentInput.email,
        role: 'agent',
        managerId: mockManagerId,
        teamLeadId: mockTeamLeadId,
        branchIds: mockAgentInput.branchIds,
        $createdAt: '2024-01-01T00:00:00.000Z',
        $updatedAt: '2024-01-01T00:00:00.000Z',
      };

      (databases.getDocument as jest.Mock).mockResolvedValue(mockTeamLeadDoc);
      (account.create as jest.Mock).mockResolvedValue({ $id: mockAgentId });
      (databases.createDocument as jest.Mock).mockResolvedValue(mockCreatedAgent);

      const result = await createAgent(mockAgentInput);

      // Verify agent was created with correct managerId from team lead
      expect(result.managerId).toBe(mockManagerId);
      expect(result.teamLeadId).toBe(mockTeamLeadId);
      expect(databases.createDocument).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        expect.any(String),
        expect.objectContaining({
          managerId: mockManagerId,
          teamLeadId: mockTeamLeadId,
        }),
        expect.any(Array)
      );
    });

    it('should reject agent creation with no branches', async () => {
      const mockAgentInput = {
        name: 'Test Agent',
        email: 'agent@example.com',
        password: 'securePassword123',
        teamLeadId: mockTeamLeadId,
        branchIds: [],
      };

      await expect(createAgent(mockAgentInput)).rejects.toThrow(
        'At least one branch must be assigned'
      );

      // Verify no database calls were made
      expect(databases.getDocument).not.toHaveBeenCalled();
      expect(account.create).not.toHaveBeenCalled();
    });
  });
});
