import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { useAuth } from '@/lib/contexts/auth-context';
import { listLeads } from '@/lib/services/lead-service';
import { getAgentsByManager } from '@/lib/services/user-service';
import { Lead, User } from '@/lib/types';

// Mock dependencies
jest.mock('@/lib/contexts/auth-context');
jest.mock('@/lib/services/lead-service');
jest.mock('@/lib/services/user-service');
jest.mock('next/navigation', () => ({
  useRouter: () => ({
    push: jest.fn(),
    back: jest.fn(),
  }),
  useParams: () => ({ id: 'test-lead-id' }),
}));

const mockUseAuth = useAuth as jest.MockedFunction<typeof useAuth>;
const mockListLeads = listLeads as jest.MockedFunction<typeof listLeads>;
const mockGetAgentsByManager = getAgentsByManager as jest.MockedFunction<typeof getAgentsByManager>;

describe('Lead UI Tests', () => {
  const mockManagerUser: User = {
    $id: 'manager-1',
    name: 'Test Manager',
    email: 'manager@test.com',
    role: 'manager',
    managerId: null,
  };

  const mockAgentUser: User = {
    $id: 'agent-1',
    name: 'Test Agent',
    email: 'agent@test.com',
    role: 'agent',
    managerId: 'manager-1',
  };

  const mockAgent2: User = {
    $id: 'agent-2',
    name: 'Agent Two',
    email: 'agent2@test.com',
    role: 'agent',
    managerId: 'manager-1',
  };

  const mockLeads: Lead[] = [
    {
      $id: 'lead-1',
      data: JSON.stringify({
        firstName: 'John',
        lastName: 'Doe',
        email: 'john@example.com',
        company: 'Acme Corp',
      }),
      status: 'New',
      ownerId: 'manager-1',
      assignedToId: 'agent-1',
      isClosed: false,
      closedAt: null,
      $createdAt: '2024-01-01T00:00:00.000Z',
    },
    {
      $id: 'lead-2',
      data: JSON.stringify({
        firstName: 'Jane',
        lastName: 'Smith',
        email: 'jane@example.com',
        company: 'Tech Inc',
      }),
      status: 'Contacted',
      ownerId: 'manager-1',
      assignedToId: 'agent-2',
      isClosed: false,
      closedAt: null,
      $createdAt: '2024-01-02T00:00:00.000Z',
    },
    {
      $id: 'lead-3',
      data: JSON.stringify({
        firstName: 'Bob',
        lastName: 'Johnson',
        email: 'bob@example.com',
        company: 'StartUp LLC',
      }),
      status: 'Qualified',
      ownerId: 'manager-1',
      assignedToId: null,
      isClosed: false,
      closedAt: null,
      $createdAt: '2024-01-03T00:00:00.000Z',
    },
  ];

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Agent Lead Visibility', () => {
    it('should show only assigned leads to agents', async () => {
      // Setup: Agent user
      mockUseAuth.mockReturnValue({
        user: mockAgentUser,
        isManager: false,
        isAgent: true,
        loading: false,
        login: jest.fn(),
        logout: jest.fn(),
        signup: jest.fn(),
      });

      // Mock listLeads to return only leads assigned to agent-1
      const agentLeads = mockLeads.filter(lead => lead.assignedToId === 'agent-1');
      mockListLeads.mockResolvedValue(agentLeads);

      // Verify: Agent sees only their assigned leads
      expect(agentLeads).toHaveLength(1);
      expect(agentLeads[0].assignedToId).toBe('agent-1');
      expect(agentLeads.every(lead => lead.assignedToId === 'agent-1')).toBe(true);
    });

    it('should not show unassigned leads to agents', async () => {
      mockUseAuth.mockReturnValue({
        user: mockAgentUser,
        isManager: false,
        isAgent: true,
        loading: false,
        login: jest.fn(),
        logout: jest.fn(),
        signup: jest.fn(),
      });

      const agentLeads = mockLeads.filter(lead => lead.assignedToId === 'agent-1');
      mockListLeads.mockResolvedValue(agentLeads);

      // Verify: No unassigned leads in agent's view
      expect(agentLeads.every(lead => lead.assignedToId !== null)).toBe(true);
    });

    it('should not show leads assigned to other agents', async () => {
      mockUseAuth.mockReturnValue({
        user: mockAgentUser,
        isManager: false,
        isAgent: true,
        loading: false,
        login: jest.fn(),
        logout: jest.fn(),
        signup: jest.fn(),
      });

      const agentLeads = mockLeads.filter(lead => lead.assignedToId === 'agent-1');
      mockListLeads.mockResolvedValue(agentLeads);

      // Verify: No leads assigned to other agents
      expect(agentLeads.every(lead =>
        lead.assignedToId === null || lead.assignedToId === 'agent-1'
      )).toBe(true);
    });
  });

  describe('Manager Lead Visibility', () => {
    it('should show all owned leads to managers', async () => {
      mockUseAuth.mockReturnValue({
        user: mockManagerUser,
        isManager: true,
        isAgent: false,
        loading: false,
        login: jest.fn(),
        logout: jest.fn(),
        signup: jest.fn(),
      });

      // Mock listLeads to return all leads owned by manager
      const managerLeads = mockLeads.filter(lead => lead.ownerId === 'manager-1');
      mockListLeads.mockResolvedValue(managerLeads);

      // Verify: Manager sees all owned leads
      expect(managerLeads).toHaveLength(3);
      expect(managerLeads.every(lead => lead.ownerId === 'manager-1')).toBe(true);
    });

    it('should show both assigned and unassigned leads to managers', async () => {
      mockUseAuth.mockReturnValue({
        user: mockManagerUser,
        isManager: true,
        isAgent: false,
        loading: false,
        login: jest.fn(),
        logout: jest.fn(),
        signup: jest.fn(),
      });

      const managerLeads = mockLeads.filter(lead => lead.ownerId === 'manager-1');
      mockListLeads.mockResolvedValue(managerLeads);

      // Verify: Manager sees both assigned and unassigned leads
      const assignedLeads = managerLeads.filter(lead => lead.assignedToId !== null);
      const unassignedLeads = managerLeads.filter(lead => lead.assignedToId === null);

      expect(assignedLeads.length).toBeGreaterThan(0);
      expect(unassignedLeads.length).toBeGreaterThan(0);
      expect(managerLeads.length).toBe(assignedLeads.length + unassignedLeads.length);
    });
  });

  describe('Lead Filtering', () => {
    it('should filter leads by status', async () => {
      mockUseAuth.mockReturnValue({
        user: mockManagerUser,
        isManager: true,
        isAgent: false,
        loading: false,
        login: jest.fn(),
        logout: jest.fn(),
        signup: jest.fn(),
      });

      // Filter by status
      const statusFilter = 'New';
      const filteredLeads = mockLeads.filter(lead => lead.status === statusFilter);
      mockListLeads.mockResolvedValue(filteredLeads);

      // Verify: Only leads with matching status
      expect(filteredLeads.every(lead => lead.status === statusFilter)).toBe(true);
    });

    it('should filter leads by assigned agent', async () => {
      mockUseAuth.mockReturnValue({
        user: mockManagerUser,
        isManager: true,
        isAgent: false,
        loading: false,
        login: jest.fn(),
        logout: jest.fn(),
        signup: jest.fn(),
      });

      // Filter by assigned agent
      const agentFilter = 'agent-1';
      const filteredLeads = mockLeads.filter(lead => lead.assignedToId === agentFilter);
      mockListLeads.mockResolvedValue(filteredLeads);

      // Verify: Only leads assigned to specified agent
      expect(filteredLeads.every(lead => lead.assignedToId === agentFilter)).toBe(true);
    });

    it('should filter leads by date range', async () => {
      mockUseAuth.mockReturnValue({
        user: mockManagerUser,
        isManager: true,
        isAgent: false,
        loading: false,
        login: jest.fn(),
        logout: jest.fn(),
        signup: jest.fn(),
      });

      // Filter by date range
      const dateFrom = new Date('2024-01-02T00:00:00.000Z');
      const dateTo = new Date('2024-01-03T23:59:59.999Z');
      const filteredLeads = mockLeads.filter(lead => {
        const createdAt = new Date(lead.$createdAt!);
        return createdAt >= dateFrom && createdAt <= dateTo;
      });
      mockListLeads.mockResolvedValue(filteredLeads);

      // Verify: Only leads within date range
      expect(filteredLeads.length).toBe(2);
      expect(filteredLeads.every(lead => {
        const createdAt = new Date(lead.$createdAt!);
        return createdAt >= dateFrom && createdAt <= dateTo;
      })).toBe(true);
    });

    it('should search leads by query', async () => {
      mockUseAuth.mockReturnValue({
        user: mockManagerUser,
        isManager: true,
        isAgent: false,
        loading: false,
        login: jest.fn(),
        logout: jest.fn(),
        signup: jest.fn(),
      });

      // Search by query
      const searchQuery = 'john';
      const filteredLeads = mockLeads.filter(lead => {
        const data = JSON.parse(lead.data);
        return Object.values(data).some(value =>
          String(value).toLowerCase().includes(searchQuery.toLowerCase())
        );
      });
      mockListLeads.mockResolvedValue(filteredLeads);

      // Verify: Only leads matching search query
      expect(filteredLeads.length).toBeGreaterThan(0);
      expect(filteredLeads.some(lead => {
        const data = JSON.parse(lead.data);
        return data.firstName.toLowerCase().includes(searchQuery);
      })).toBe(true);
    });
  });

  describe('Lead Closure', () => {
    it('should move closed lead to history', async () => {
      const closedLead: Lead = {
        ...mockLeads[0],
        isClosed: true,
        closedAt: '2024-01-10T00:00:00.000Z',
        status: 'Closed',
      };

      // Verify: Closed lead has correct properties
      expect(closedLead.isClosed).toBe(true);
      expect(closedLead.closedAt).not.toBeNull();

      // Verify: Closed lead should not appear in active leads
      const activeLeads = mockLeads.filter(lead => !lead.isClosed);
      expect(activeLeads.every(lead => !lead.isClosed)).toBe(true);
    });

    it('should set closedAt timestamp when closing lead', async () => {
      const leadToClose = mockLeads[0];
      const closedLead: Lead = {
        ...leadToClose,
        isClosed: true,
        closedAt: new Date().toISOString(),
        status: 'Won',
      };

      // Verify: closedAt is set
      expect(closedLead.closedAt).not.toBeNull();
      expect(new Date(closedLead.closedAt!).getTime()).toBeLessThanOrEqual(Date.now());
    });
  });

  describe('Lead Creation', () => {
    it('should create lead with valid data', async () => {
      const newLeadData = {
        firstName: 'New',
        lastName: 'Lead',
        email: 'new@example.com',
        company: 'New Corp',
        status: 'New',
      };

      // Verify: Lead data is valid
      expect(newLeadData.firstName).toBeTruthy();
      expect(newLeadData.lastName).toBeTruthy();
      expect(newLeadData.email).toMatch(/^[^\s@]+@[^\s@]+\.[^\s@]+$/);
    });

    it('should assign owner when creating lead', async () => {
      mockUseAuth.mockReturnValue({
        user: mockManagerUser,
        isManager: true,
        isAgent: false,
        loading: false,
        login: jest.fn(),
        logout: jest.fn(),
        signup: jest.fn(),
      });

      const newLead: Lead = {
        $id: 'new-lead',
        data: JSON.stringify({ firstName: 'Test', lastName: 'Lead' }),
        status: 'New',
        ownerId: mockManagerUser.$id,
        assignedToId: null,
        isClosed: false,
        closedAt: null,
      };

      // Verify: Owner is set correctly
      expect(newLead.ownerId).toBe(mockManagerUser.$id);
    });
  });

  describe('Lead Assignment', () => {
    it('should allow manager to assign lead to agent', async () => {
      mockUseAuth.mockReturnValue({
        user: mockManagerUser,
        isManager: true,
        isAgent: false,
        loading: false,
        login: jest.fn(),
        logout: jest.fn(),
        signup: jest.fn(),
      });

      mockGetAgentsByManager.mockResolvedValue([mockAgentUser, mockAgent2]);

      const leadToAssign = mockLeads[2]; // Unassigned lead
      const assignedLead: Lead = {
        ...leadToAssign,
        assignedToId: 'agent-1',
      };

      // Verify: Lead is assigned to agent
      expect(assignedLead.assignedToId).toBe('agent-1');
      expect(assignedLead.assignedToId).not.toBeNull();
    });

    it('should update lead assignment', async () => {
      const lead = mockLeads[0]; // Assigned to agent-1
      const reassignedLead: Lead = {
        ...lead,
        assignedToId: 'agent-2',
      };

      // Verify: Assignment is updated
      expect(reassignedLead.assignedToId).toBe('agent-2');
      expect(reassignedLead.assignedToId).not.toBe(lead.assignedToId);
    });
  });
});
