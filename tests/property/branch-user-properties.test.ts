import fc from 'fast-check';
import { UserRole } from '@/lib/types';

/**
 * Feature: admin-branch-management
 * Property tests for User Service branch features
 *
 * These tests validate the core business rules of branch-aware user management
 * using pure logic simulation (no Appwrite dependency).
 */

// --- Types ---

interface UserRecord {
  $id: string;
  name: string;
  email: string;
  role: UserRole;
  teamLeadId: string | null;
  branchId: string | null;
}

interface UserStore {
  users: UserRecord[];
}

// --- Simulation helpers ---

function simulateAssignManagerToBranch(store: UserStore, teamLeadId: string, branchId: string): UserStore {
  const updatedUsers = store.users.map(user => {
    if (user.$id === teamLeadId) {
      return { ...user, branchId };
    }
    if (user.role === 'agent' && user.teamLeadId === teamLeadId) {
      return { ...user, branchId };
    }
    return user;
  });
  return { users: updatedUsers };
}

function simulateRemoveManagerFromBranch(store: UserStore, teamLeadId: string): UserStore {
  const updatedUsers = store.users.map(user => {
    if (user.$id === teamLeadId) {
      return { ...user, branchId: null };
    }
    if (user.role === 'agent' && user.teamLeadId === teamLeadId) {
      return { ...user, branchId: null };
    }
    return user;
  });
  return { users: updatedUsers };
}

function simulateGetAgentsByBranch(store: UserStore, branchId: string): UserRecord[] {
  return store.users.filter(u => u.role === 'agent' && u.branchId === branchId);
}

function simulateGetAllAgents(store: UserStore): UserRecord[] {
  return store.users.filter(u => u.role === 'agent');
}

function simulateCreateAgent(
  store: UserStore,
  agentId: string,
  name: string,
  email: string,
  teamLeadId: string,
  branchIdOverride?: string
): UserStore {
  const teamLead = store.users.find(u => u.$id === teamLeadId);
  const branchId = branchIdOverride !== undefined ? branchIdOverride : (teamLead?.branchId || null);
  const newAgent: UserRecord = {
    $id: agentId,
    name,
    email,
    role: 'agent',
    teamLeadId,
    branchId,
  };
  return { users: [...store.users, newAgent] };
}

// --- Arbitraries ---

const branchIdArb = fc.integer({ min: 1, max: 10000 }).map(n => `branch-${n}`);
const userIdArb = fc.integer({ min: 1, max: 10000 }).map(n => `user-${n}`);
const nameArb = fc.string({ minLength: 1, maxLength: 20 }).filter(s => s.trim().length > 0);
const emailArb = fc.tuple(
  fc.string({ minLength: 1, maxLength: 10 }).filter(s => /^[a-z0-9]+$/i.test(s)),
  fc.string({ minLength: 1, maxLength: 8 }).filter(s => /^[a-z0-9]+$/i.test(s)),
  fc.constantFrom('com', 'org', 'net')
).map(([user, domain, tld]) => `${user}@${domain}.${tld}`);

const agentCountArb = fc.integer({ min: 1, max: 5 });

function makeManager(id: string, branchId: string | null): UserRecord {
  return { $id: id, name: `TeamLead ${id}`, email: `${id}@test.com`, role: 'team_lead', teamLeadId: null, branchId };
}

function makeAgent(id: string, teamLeadId: string, branchId: string | null): UserRecord {
  return { $id: id, name: `Agent ${id}`, email: `${id}@test.com`, role: 'agent', teamLeadId, branchId };
}

describe('User Service Branch Properties', () => {
  /**
   * Feature: admin-branch-management, Property 8: TeamLead-to-branch assignment cascades to agents
   *
   * For any teamLead with linked agents, assigning or reassigning the teamLead to a branch
   * updates the teamLead's branchId to the target branch AND updates all linked agents'
   * branchId to the same target branch.
   *
   * **Validates: Requirements 3.1, 3.2**
   */
  describe('Property 8: TeamLead-to-branch assignment cascades to agents', () => {
    it('should cascade branchId to all linked agents when teamLead is assigned to a branch', () => {
      fc.assert(
        fc.property(
          userIdArb,
          branchIdArb,
          branchIdArb,
          agentCountArb,
          (teamLeadId, oldBranch, newBranch, agentCount) => {
            const teamLead = makeManager(teamLeadId, oldBranch);
            const agents = Array.from({ length: agentCount }, (_, i) =>
              makeAgent(`agent-${teamLeadId}-${i}`, teamLeadId, oldBranch)
            );
            const store: UserStore = { users: [teamLead, ...agents] };

            const result = simulateAssignManagerToBranch(store, teamLeadId, newBranch);

            const updatedManager = result.users.find(u => u.$id === teamLeadId)!;
            const updatedAgents = result.users.filter(u => u.role === 'agent' && u.teamLeadId === teamLeadId);

            return (
              updatedManager.branchId === newBranch &&
              updatedAgents.every(a => a.branchId === newBranch)
            );
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should not affect agents linked to other teamLeads', () => {
      fc.assert(
        fc.property(
          userIdArb,
          userIdArb,
          branchIdArb,
          branchIdArb,
          branchIdArb,
          (managerA, managerB, branchA, branchB, newBranch) => {
            fc.pre(managerA !== managerB);

            const mgrA = makeManager(managerA, branchA);
            const mgrB = makeManager(managerB, branchB);
            const agentA = makeAgent(`agent-a`, managerA, branchA);
            const agentB = makeAgent(`agent-b`, managerB, branchB);
            const store: UserStore = { users: [mgrA, mgrB, agentA, agentB] };

            const result = simulateAssignManagerToBranch(store, managerA, newBranch);

            const updatedAgentB = result.users.find(u => u.$id === 'agent-b')!;
            return updatedAgentB.branchId === branchB;
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  /**
   * Feature: admin-branch-management, Property 10: TeamLead removal cascades to agents
   *
   * For any teamLead with linked agents who is removed from a branch, the teamLead's
   * branchId is set to null AND all linked agents' branchId is set to null.
   *
   * **Validates: Requirements 3.4**
   */
  describe('Property 10: TeamLead removal cascades to agents', () => {
    it('should clear branchId for teamLead and all linked agents', () => {
      fc.assert(
        fc.property(
          userIdArb,
          branchIdArb,
          agentCountArb,
          (teamLeadId, branchId, agentCount) => {
            const teamLead = makeManager(teamLeadId, branchId);
            const agents = Array.from({ length: agentCount }, (_, i) =>
              makeAgent(`agent-${teamLeadId}-${i}`, teamLeadId, branchId)
            );
            const store: UserStore = { users: [teamLead, ...agents] };

            const result = simulateRemoveManagerFromBranch(store, teamLeadId);

            const updatedManager = result.users.find(u => u.$id === teamLeadId)!;
            const updatedAgents = result.users.filter(u => u.role === 'agent' && u.teamLeadId === teamLeadId);

            return (
              updatedManager.branchId === null &&
              updatedAgents.every(a => a.branchId === null)
            );
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  /**
   * Feature: admin-branch-management, Property 12: TeamLead sees only branch agents
   *
   * For any set of agents across multiple branches, when a teamLead lists agents,
   * the returned agents all have a branchId matching the teamLead's branchId,
   * and no agents from other branches are included.
   *
   * **Validates: Requirements 4.2**
   */
  describe('Property 12: TeamLead sees only branch agents', () => {
    it('should return only agents from the teamLead branch', () => {
      fc.assert(
        fc.property(
          branchIdArb,
          branchIdArb,
          (branchA, branchB) => {
            fc.pre(branchA !== branchB);

            const store: UserStore = {
              users: [
                makeAgent('a1', 'mgr-a', branchA),
                makeAgent('a2', 'mgr-a', branchA),
                makeAgent('b1', 'mgr-b', branchB),
                makeAgent('b2', 'mgr-b', branchB),
              ],
            };

            const result = simulateGetAgentsByBranch(store, branchA);

            return (
              result.length === 2 &&
              result.every(a => a.branchId === branchA) &&
              result.every(a => a.branchId !== branchB)
            );
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  /**
   * Feature: admin-branch-management, Property 14: Admin sees all agents across branches
   *
   * For any set of agents across multiple branches, when an admin lists agents,
   * the returned set includes agents from every branch.
   *
   * **Validates: Requirements 4.4**
   */
  describe('Property 14: Admin sees all agents across branches', () => {
    it('should return agents from all branches for admin', () => {
      fc.assert(
        fc.property(
          branchIdArb,
          branchIdArb,
          (branchA, branchB) => {
            fc.pre(branchA !== branchB);

            const store: UserStore = {
              users: [
                makeAgent('a1', 'mgr-a', branchA),
                makeAgent('a2', 'mgr-a', branchA),
                makeAgent('b1', 'mgr-b', branchB),
              ],
            };

            const allAgents = simulateGetAllAgents(store);
            const branchIds = new Set(allAgents.map(a => a.branchId));

            return (
              allAgents.length === 3 &&
              branchIds.has(branchA) &&
              branchIds.has(branchB)
            );
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  /**
   * Feature: admin-branch-management, Property 19: Admin can specify teamLead and branch on agent creation
   *
   * For any admin user creating an agent with a specified teamLeadId and branchId,
   * the resulting agent document has those exact values.
   *
   * **Validates: Requirements 6.2**
   */
  describe('Property 19: Admin can specify teamLead and branch on agent creation', () => {
    it('should create agent with specified teamLeadId and branchId', () => {
      fc.assert(
        fc.property(
          userIdArb,
          userIdArb,
          branchIdArb,
          branchIdArb,
          nameArb,
          emailArb,
          (agentId, teamLeadId, managerBranch, specifiedBranch, name, email) => {
            fc.pre(agentId !== teamLeadId);

            const teamLead = makeManager(teamLeadId, managerBranch);
            const store: UserStore = { users: [teamLead] };

            // Admin specifies a different branch than the teamLead's
            const result = simulateCreateAgent(store, agentId, name, email, teamLeadId, specifiedBranch);
            const createdAgent = result.users.find(u => u.$id === agentId)!;

            return (
              createdAgent.teamLeadId === teamLeadId &&
              createdAgent.branchId === specifiedBranch &&
              createdAgent.role === 'agent'
            );
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should inherit teamLead branchId when no override is specified', () => {
      fc.assert(
        fc.property(
          userIdArb,
          userIdArb,
          branchIdArb,
          nameArb,
          emailArb,
          (agentId, teamLeadId, managerBranch, name, email) => {
            fc.pre(agentId !== teamLeadId);

            const teamLead = makeManager(teamLeadId, managerBranch);
            const store: UserStore = { users: [teamLead] };

            // No branchId override — should inherit from teamLead
            const result = simulateCreateAgent(store, agentId, name, email, teamLeadId);
            const createdAgent = result.users.find(u => u.$id === agentId)!;

            return (
              createdAgent.teamLeadId === teamLeadId &&
              createdAgent.branchId === managerBranch
            );
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
