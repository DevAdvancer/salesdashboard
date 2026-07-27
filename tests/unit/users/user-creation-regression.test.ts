/**
 * Unit Test: User Creation Regression Tests
 *
 * Tests team lead and agent creation flows to ensure no regressions
 * after changes to createTeamLeadAction.
 *
 * Requirements: 4.1, 4.2
 */

import { createTeamLead, createAgent } from '@/lib/services/user-service';
import { databases, account, DATABASE_ID } from '@/lib/appwrite';

// user-service captures the users collection id from the environment at import
// time, so the assertions below have to use the same value jest.env.js supplies
// rather than a literal.
const USERS_COLLECTION_ID = process.env.NEXT_PUBLIC_APPWRITE_USERS_COLLECTION_ID as string;

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

// Note on the fixtures below: `team_lead` replaced the retired `manager` role,
// so a team lead sits at the top of the hierarchy and has no parent of its own
// (`CreateTeamLeadInput` carries no parent id, and `createTeamLead` writes
// `teamLeadId: null`). Agents are the ones that carry a `teamLeadId`.
describe('User Creation Regression Tests', () => {
  const mockTeamLeadId = 'teamlead-456';

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Team Lead Creation Flow', () => {
    it('should create a top-level team lead with valid data', async () => {
      const mockTeamLeadInput = {
        name: 'Test Team Lead',
        email: 'teamlead@example.com',
        password: 'securePassword123',
        branchIds: ['branch-1', 'branch-2'],
      };

      const mockCreatedTeamLead = {
        $id: mockTeamLeadId,
        name: mockTeamLeadInput.name,
        email: mockTeamLeadInput.email,
        role: 'team_lead',
        teamLeadId: null,
        branchIds: mockTeamLeadInput.branchIds,
        $createdAt: '2024-01-01T00:00:00.000Z',
        $updatedAt: '2024-01-01T00:00:00.000Z',
      };

      (account.create as jest.Mock).mockResolvedValue({ $id: mockTeamLeadId });
      (databases.createDocument as jest.Mock).mockResolvedValue(mockCreatedTeamLead);

      const result = await createTeamLead(mockTeamLeadInput);

      // Verify success
      expect(result.role).toBe('team_lead');
      expect(result.name).toBe(mockTeamLeadInput.name);
      expect(result.email).toBe(mockTeamLeadInput.email);
      // A team lead is the top of the hierarchy, so it has no parent.
      expect(result.teamLeadId).toBeNull();

      // No parent document to look up for a top-level role
      expect(databases.getDocument).not.toHaveBeenCalled();

      // Verify user was created in auth system
      expect(account.create).toHaveBeenCalledWith(
        expect.any(String),
        mockTeamLeadInput.email,
        mockTeamLeadInput.password,
        mockTeamLeadInput.name
      );

      // Verify team lead document was created with correct data
      expect(databases.createDocument).toHaveBeenCalledWith(
        DATABASE_ID,
        USERS_COLLECTION_ID,
        expect.any(String),
        expect.objectContaining({
          name: mockTeamLeadInput.name,
          email: mockTeamLeadInput.email,
          role: 'team_lead',
          teamLeadId: null,
          branchIds: mockTeamLeadInput.branchIds,
        }),
        expect.any(Array)
      );
    });

    it('should assign exactly the requested branches without a parent subset check', async () => {
      // Team leads are created by admins/developers (see createTeamLeadAction),
      // so their branches are not narrowed against a parent's branch list. The
      // subset rule applies one level down, when a team lead creates an agent.
      const mockTeamLeadInput = {
        name: 'Test Team Lead',
        email: 'teamlead@example.com',
        password: 'securePassword123',
        branchIds: ['branch-1', 'branch-99'],
      };

      (account.create as jest.Mock).mockResolvedValue({ $id: mockTeamLeadId });
      (databases.createDocument as jest.Mock).mockResolvedValue({
        $id: mockTeamLeadId,
        name: mockTeamLeadInput.name,
        email: mockTeamLeadInput.email,
        role: 'team_lead',
        teamLeadId: null,
        branchIds: mockTeamLeadInput.branchIds,
        $createdAt: '2024-01-01T00:00:00.000Z',
        $updatedAt: '2024-01-01T00:00:00.000Z',
      });

      const result = await createTeamLead(mockTeamLeadInput);

      expect(result.branchIds).toEqual(['branch-1', 'branch-99']);
      expect(databases.getDocument).not.toHaveBeenCalled();
      expect(databases.createDocument).toHaveBeenCalledWith(
        DATABASE_ID,
        USERS_COLLECTION_ID,
        expect.any(String),
        expect.objectContaining({ branchIds: ['branch-1', 'branch-99'] }),
        expect.any(Array)
      );
    });

    it('should handle duplicate email during team lead creation', async () => {
      const mockTeamLeadInput = {
        name: 'Test Team Lead',
        email: 'existing@example.com',
        password: 'securePassword123',
        branchIds: ['branch-1'],
      };

      const duplicateError: any = new Error('User already exists');
      duplicateError.code = 409;

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
        teamLeadId: null,
        branchIds: ['branch-1', 'branch-2'],
      };

      const mockAgentId = 'agent-789';

      const mockCreatedAgent = {
        $id: mockAgentId,
        name: mockAgentInput.name,
        email: mockAgentInput.email,
        role: 'agent',
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
      expect(result.teamLeadId).toBe(mockTeamLeadId);

      // Verify team lead document was retrieved
      expect(databases.getDocument).toHaveBeenCalledWith(
        DATABASE_ID,
        USERS_COLLECTION_ID,
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
        DATABASE_ID,
        USERS_COLLECTION_ID,
        expect.any(String),
        expect.objectContaining({
          name: mockAgentInput.name,
          email: mockAgentInput.email,
          role: 'agent',
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

    it('should correctly set teamLeadId from team lead document', async () => {
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
        teamLeadId: null,
        branchIds: ['branch-1', 'branch-2'],
      };

      const mockAgentId = 'agent-789';

      const mockCreatedAgent = {
        $id: mockAgentId,
        name: mockAgentInput.name,
        email: mockAgentInput.email,
        role: 'agent',
        teamLeadId: mockTeamLeadId,
        branchIds: mockAgentInput.branchIds,
        $createdAt: '2024-01-01T00:00:00.000Z',
        $updatedAt: '2024-01-01T00:00:00.000Z',
      };

      (databases.getDocument as jest.Mock).mockResolvedValue(mockTeamLeadDoc);
      (account.create as jest.Mock).mockResolvedValue({ $id: mockAgentId });
      (databases.createDocument as jest.Mock).mockResolvedValue(mockCreatedAgent);

      const result = await createAgent(mockAgentInput);

      // Verify agent was created with correct teamLeadId from team lead
      expect(result.teamLeadId).toBe(mockTeamLeadId);
      expect(databases.createDocument).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        expect.any(String),
        expect.objectContaining({
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
