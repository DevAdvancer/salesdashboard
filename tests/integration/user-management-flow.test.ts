/**
 * Integration Test: User Management Flow
 *
 * Tests the complete user management flow:
 * signup → create agent → agent login → agent sees assigned leads
 *
 * Requirements: 1.1-1.5, 5.4, 8.1-8.6, 12.1-12.4
 */

import { createAgent, getAgentsByManager, getUserById } from '@/lib/services/user-service';
import { listLeads } from '@/lib/services/lead-service';
import { databases, account } from '@/lib/appwrite';
import { Permission, Role } from 'appwrite';
import { User, Lead } from '@/lib/types';

jest.mock('@/lib/appwrite', () => ({
  account: {
    create: jest.fn(),
    createEmailPasswordSession: jest.fn(),
    get: jest.fn(),
    deleteSession: jest.fn(),
  },
  databases: {
    createDocument: jest.fn(),
    getDocument: jest.fn(),
    updateDocument: jest.fn(),
    deleteDocument: jest.fn(),
    listDocuments: jest.fn(),
  },
  DATABASE_ID: 'test-database',
  COLLECTIONS: {
    USERS: 'test-users-collection',
    LEADS: 'test-leads-collection',
  },
}));

// Mock the lead validator to always return valid by default
jest.mock('@/lib/services/lead-validator', () => ({
  validateLeadUniqueness: jest.fn().mockResolvedValue({ isValid: true }),
}));

describe('Integration: User Management Flow', () => {
  const managerId = 'manager-signup-001';
  const agentId = 'agent-created-001';

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should complete the user management flow: signup → create agent → agent sees assigned leads', async () => {
    // Step 1: Manager signs up (simulated by creating user doc with manager role)
    // Step 2: Team Lead creates an agent

    const teamLeadId = 'teamlead-001';

    const agentDoc = {
      $id: agentId,
      name: 'Test Agent',
      email: 'agent@example.com',
      role: 'agent',
      managerId: managerId,
      teamLeadId: teamLeadId,
      branchIds: ['branch-1'],
      $createdAt: new Date().toISOString(),
      $updatedAt: new Date().toISOString(),
    };

    // Mock team lead document lookup (createAgent fetches team lead)
    const teamLeadDoc = {
      $id: teamLeadId,
      name: 'Test Team Lead',
      email: 'tl@example.com',
      role: 'team_lead',
      managerId: managerId,
      branchIds: ['branch-1', 'branch-2'],
      $createdAt: new Date().toISOString(),
      $updatedAt: new Date().toISOString(),
    };
    (databases.getDocument as jest.Mock).mockResolvedValue(teamLeadDoc);
    (account.create as jest.Mock).mockResolvedValue({ $id: agentId });
    (databases.createDocument as jest.Mock).mockResolvedValue(agentDoc);

    const createdAgent = await createAgent({
      name: 'Test Agent',
      email: 'agent@example.com',
      password: 'securePassword123',
      teamLeadId: teamLeadId,
      branchIds: ['branch-1'],
    });

    // Verify agent has correct role and managerId
    expect(createdAgent.role).toBe('agent');
    expect(createdAgent.managerId).toBe(managerId);
    expect(createdAgent.teamLeadId).toBe(teamLeadId);
    expect(createdAgent.name).toBe('Test Agent');

    // Verify Appwrite account was created
    expect(account.create).toHaveBeenCalledWith(
      expect.any(String),
      'agent@example.com',
      'securePassword123',
      'Test Agent'
    );

    // Verify document was created with correct data
    expect(databases.createDocument).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      expect.any(String),
      expect.objectContaining({
        role: 'agent',
        managerId: managerId,
        teamLeadId: teamLeadId,
        branchIds: ['branch-1'],
      }),
      expect.arrayContaining([
        Permission.read(Role.user(teamLeadId)),
        Permission.update(Role.user(teamLeadId)),
      ])
    );

    // Step 3: Manager can see their agents
    (databases.listDocuments as jest.Mock).mockResolvedValue({
      documents: [agentDoc],
    });

    const agents = await getAgentsByManager(managerId);
    expect(agents).toHaveLength(1);
    expect(agents[0].$id).toBe(agentId);
    expect(agents[0].managerId).toBe(managerId);

    // Step 4: Agent can only see assigned leads
    const assignedLead: Lead = {
      $id: 'lead-for-agent',
      data: JSON.stringify({ firstName: 'Test', lastName: 'Lead' }),
      status: 'New',
      ownerId: managerId,
      assignedToId: agentId,
      isClosed: false,
      closedAt: null,
    };

    (databases.listDocuments as jest.Mock).mockResolvedValue({
      documents: [assignedLead],
    });

    const agentLeads = await listLeads({}, agentId, 'agent');
    expect(agentLeads).toHaveLength(1);
    expect(agentLeads[0].assignedToId).toBe(agentId);
  });

  it('should handle duplicate email during agent creation', async () => {
    const teamLeadId = 'teamlead-001';

    // Mock team lead document lookup
    const teamLeadDoc = {
      $id: teamLeadId,
      name: 'Test Team Lead',
      email: 'tl@example.com',
      role: 'team_lead',
      managerId: managerId,
      branchIds: ['branch-1'],
    };
    (databases.getDocument as jest.Mock).mockResolvedValue(teamLeadDoc);
    (account.create as jest.Mock).mockRejectedValue({
      code: 409,
      message: 'A user with the same id, email, or phone already exists',
    });

    await expect(
      createAgent({
        name: 'Duplicate Agent',
        email: 'existing@example.com',
        password: 'password123',
        teamLeadId: teamLeadId,
        branchIds: ['branch-1'],
      })
    ).rejects.toThrow('A user with this email already exists');
  });

  it('should filter agents by manager ID', async () => {
    const otherManagerId = 'manager-other';

    const myAgents = [
      {
        $id: 'agent-1',
        name: 'My Agent 1',
        email: 'agent1@example.com',
        role: 'agent',
        managerId: managerId,
        $createdAt: new Date().toISOString(),
        $updatedAt: new Date().toISOString(),
      },
    ];

    (databases.listDocuments as jest.Mock).mockResolvedValue({
      documents: myAgents,
    });

    const agents = await getAgentsByManager(managerId);
    expect(agents).toHaveLength(1);
    expect(agents.every((a) => a.managerId === managerId)).toBe(true);
  });

  it('should get user by ID for session restoration', async () => {
    const userDoc = {
      $id: managerId,
      name: 'Test Manager',
      email: 'manager@example.com',
      role: 'manager',
      managerId: null,
      $createdAt: new Date().toISOString(),
      $updatedAt: new Date().toISOString(),
    };

    (databases.getDocument as jest.Mock).mockResolvedValue(userDoc);

    const user = await getUserById(managerId);
    expect(user.role).toBe('manager');
    expect(user.managerId).toBeNull();
  });
});
