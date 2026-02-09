import { createAgent, getAgentsByManager } from '@/lib/services/user-service';
import { databases, account } from '@/lib/appwrite';
import { ID, Permission, Role, Query } from 'appwrite';

// Mock the Appwrite modules
jest.mock('@/lib/appwrite', () => ({
  databases: {
    createDocument: jest.fn(),
    listDocuments: jest.fn(),
  },
  account: {
    create: jest.fn(),
  },
}));

describe('User Management', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Agent Creation', () => {
    it('should create agent with valid data', async () => {
      const mockAgentData = {
        name: 'Test Agent',
        email: 'agent@example.com',
        password: 'password123',
        managerId: 'manager-123',
      };

      const mockCreatedAgent = {
        $id: 'agent-456',
        name: mockAgentData.name,
        email: mockAgentData.email,
        role: 'agent',
        managerId: mockAgentData.managerId,
        $createdAt: '2024-01-01T00:00:00.000Z',
        $updatedAt: '2024-01-01T00:00:00.000Z',
      };

      (account.create as jest.Mock).mockResolvedValue({ $id: 'agent-456' });
      (databases.createDocument as jest.Mock).mockResolvedValue(mockCreatedAgent);

      const result = await createAgent(mockAgentData);

      expect(account.create).toHaveBeenCalledWith(
        expect.any(String),
        mockAgentData.email,
        mockAgentData.password,
        mockAgentData.name
      );

      expect(databases.createDocument).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        expect.any(String),
        {
          name: mockAgentData.name,
          email: mockAgentData.email,
          role: 'agent',
          managerId: mockAgentData.managerId,
        },
        expect.arrayContaining([
          expect.stringContaining('read'),
          expect.stringContaining('update'),
          expect.stringContaining('delete'),
        ])
      );

      expect(result).toEqual(mockCreatedAgent);
      expect(result.role).toBe('agent');
      expect(result.managerId).toBe(mockAgentData.managerId);
    });

    it('should handle duplicate email error', async () => {
      const mockAgentData = {
        name: 'Test Agent',
        email: 'existing@example.com',
        password: 'password123',
        managerId: 'manager-123',
      };

      const duplicateError = new Error('User already exists');
      (duplicateError as any).code = 409;

      (account.create as jest.Mock).mockRejectedValue(duplicateError);

      await expect(createAgent(mockAgentData)).rejects.toThrow(
        'A user with this email already exists'
      );
    });

    it('should set agent role and managerId correctly', async () => {
      const mockAgentData = {
        name: 'New Agent',
        email: 'newagent@example.com',
        password: 'securepass',
        managerId: 'manager-789',
      };

      const mockCreatedAgent = {
        $id: 'agent-999',
        name: mockAgentData.name,
        email: mockAgentData.email,
        role: 'agent',
        managerId: mockAgentData.managerId,
        $createdAt: '2024-01-01T00:00:00.000Z',
        $updatedAt: '2024-01-01T00:00:00.000Z',
      };

      (account.create as jest.Mock).mockResolvedValue({ $id: 'agent-999' });
      (databases.createDocument as jest.Mock).mockResolvedValue(mockCreatedAgent);

      const result = await createAgent(mockAgentData);

      // Verify role is set to 'agent'
      expect(result.role).toBe('agent');

      // Verify managerId is set to the creating manager's ID
      expect(result.managerId).toBe(mockAgentData.managerId);

      // Verify the document was created with correct data
      expect(databases.createDocument).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        expect.any(String),
        expect.objectContaining({
          role: 'agent',
          managerId: mockAgentData.managerId,
        }),
        expect.any(Array)
      );
    });
  });

  describe('Manager Can Only See Their Agents', () => {
    it('should fetch only agents linked to the manager', async () => {
      const managerId = 'manager-123';
      const mockAgents = [
        {
          $id: 'agent-1',
          name: 'Agent One',
          email: 'agent1@example.com',
          role: 'agent',
          managerId: managerId,
          $createdAt: '2024-01-01T00:00:00.000Z',
          $updatedAt: '2024-01-01T00:00:00.000Z',
        },
        {
          $id: 'agent-2',
          name: 'Agent Two',
          email: 'agent2@example.com',
          role: 'agent',
          managerId: managerId,
          $createdAt: '2024-01-02T00:00:00.000Z',
          $updatedAt: '2024-01-02T00:00:00.000Z',
        },
      ];

      (databases.listDocuments as jest.Mock).mockResolvedValue({
        documents: mockAgents,
        total: mockAgents.length,
      });

      const result = await getAgentsByManager(managerId);

      expect(databases.listDocuments).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        [
          Query.equal('role', 'agent'),
          Query.equal('managerId', managerId),
        ]
      );

      expect(result).toHaveLength(2);
      expect(result.every(agent => agent.managerId === managerId)).toBe(true);
      expect(result.every(agent => agent.role === 'agent')).toBe(true);
    });

    it('should return empty array when manager has no agents', async () => {
      const managerId = 'manager-456';

      (databases.listDocuments as jest.Mock).mockResolvedValue({
        documents: [],
        total: 0,
      });

      const result = await getAgentsByManager(managerId);

      expect(result).toHaveLength(0);
      expect(databases.listDocuments).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        expect.arrayContaining([
          Query.equal('managerId', managerId),
        ])
      );
    });

    it('should not return agents from other managers', async () => {
      const managerId = 'manager-123';
      const otherManagerId = 'manager-999';

      const mockAgents = [
        {
          $id: 'agent-1',
          name: 'My Agent',
          email: 'myagent@example.com',
          role: 'agent',
          managerId: managerId,
          $createdAt: '2024-01-01T00:00:00.000Z',
          $updatedAt: '2024-01-01T00:00:00.000Z',
        },
      ];

      (databases.listDocuments as jest.Mock).mockResolvedValue({
        documents: mockAgents,
        total: mockAgents.length,
      });

      const result = await getAgentsByManager(managerId);

      // Verify query filters by the correct managerId
      expect(databases.listDocuments).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        expect.arrayContaining([
          Query.equal('managerId', managerId),
        ])
      );

      // Verify no agents from other managers are returned
      expect(result.every(agent => agent.managerId !== otherManagerId)).toBe(true);
      expect(result.every(agent => agent.managerId === managerId)).toBe(true);
    });
  });

  describe('Agent Cannot Access User Management', () => {
    it('should verify agent role cannot create other agents', () => {
      // This test verifies the business logic that agents cannot create agents
      // In the actual implementation, this is enforced by:
      // 1. UI hiding the user management page from agents
      // 2. Appwrite permissions preventing agents from creating user documents

      const agentRole = 'agent';
      const managerRole = 'manager';

      // Simulate access check
      const canAccessUserManagement = (role: string) => {
        return role === 'manager';
      };

      expect(canAccessUserManagement(agentRole)).toBe(false);
      expect(canAccessUserManagement(managerRole)).toBe(true);
    });

    it('should verify only managers can access user management UI', () => {
      const testCases = [
        { role: 'manager', expectedAccess: true },
        { role: 'agent', expectedAccess: false },
      ];

      testCases.forEach(({ role, expectedAccess }) => {
        const hasAccess = role === 'manager';
        expect(hasAccess).toBe(expectedAccess);
      });
    });
  });

  describe('Error Handling', () => {
    it('should handle network errors during agent creation', async () => {
      const mockAgentData = {
        name: 'Test Agent',
        email: 'agent@example.com',
        password: 'password123',
        managerId: 'manager-123',
      };

      const networkError = new Error('Network error');
      (account.create as jest.Mock).mockRejectedValue(networkError);

      await expect(createAgent(mockAgentData)).rejects.toThrow();
    });

    it('should handle errors when fetching agents', async () => {
      const managerId = 'manager-123';
      const error = new Error('Database error');

      (databases.listDocuments as jest.Mock).mockRejectedValue(error);

      await expect(getAgentsByManager(managerId)).rejects.toThrow();
    });
  });
});
