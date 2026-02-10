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
  managerId: string | null;
  branchId: string | null;
}

interface UserStore {
  users: UserRecord[];
}

// --- Simulation helpers ---

function simulateAssignManagerToBranch(store: UserStore, managerId: string, branchId: string): UserStore {
  const updatedUsers = store.users.map(user => {
    if (user.$id === managerId) {
      return { ...user, branchId };
    }
    if (user.role === 'agent' && user.managerId === managerId) {
      return { ...user, branchId };
    }
    return user;
  });
  return { users: updatedUsers };
}

function simulateRemoveManagerFromBranch(store: UserStore, managerId: string): UserStore {
  const updatedUsers = store.users.map(user => {
    if (user.$id === managerId) {
      return { ...user, branchId: null };
    }
    if (user.role === 'agent' && user.managerId === managerId) {
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
  managerId: string,
  branchIdOverride?: string
): UserStore {
  const manager = store.users.find(u => u.$id === managerId);
  const branchId = branchIdOverride !== undefined ? branchIdOverride : (manager?.branchId || null);
  const newAgent: UserRecord = {
    $id: agentId,
    name,
    email,
    role: 'agent',
    managerId,
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
  return { $id: id, name: `Manager ${id}`, email: `${id}@test.com`, role: 'manager', managerId: null, branchId };
}

function makeAgent(id: string, managerId: string, branchId: string | null): UserRecord {
  return { $id: id, name: `Agent ${id}`, email: `${id}@test.com`, role: 'agent', managerId, branchId };
}

describe('User Service Branch Properties', () => {
  /**
   * Feature: admin-branch-management, Property 8: Manager-to-branch assignment cascades to agents
   *
   * For any manager with linked agents, assigning or reassigning the manager to a branch
   * updates the manager's branchId to the target branch AND updates all linked agents'
   * branchId to the same target branch.
   *
   * **Validates: Requirements 3.1, 3.2**
   */
  describe('Property 8: Manager-to-branch assignment cascades to agents', () => {
    it('should cascade branchId to all linked agents when manager is assigned to a branch', () => {
      fc.assert(
        fc.property(
          userIdArb,
          branchIdArb,
          branchIdArb,
          agentCountArb,
          (managerId, oldBranch, newBranch, agentCount) => {
            const manager = makeManager(managerId, oldBranch);
            const agents = Array.from({ length: agentCount }, (_, i) =>
              makeAgent(`agent-${managerId}-${i}`, managerId, oldBranch)
            );
            const store: UserStore = { users: [manager, ...agents] };

            const result = simulateAssignManagerToBranch(store, managerId, newBranch);

            const updatedManager = result.users.find(u => u.$id === managerId)!;
            const updatedAgents = result.users.filter(u => u.role === 'agent' && u.managerId === managerId);

            return (
              updatedManager.branchId === newBranch &&
              updatedAgents.every(a => a.branchId === newBranch)
            );
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should not affect agents linked to other managers', () => {
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
   * Feature: admin-branch-management, Property 10: Manager removal cascades to agents
   *
   * For any manager with linked agents who is removed from a branch, the manager's
   * branchId is set to null AND all linked agents' branchId is set to null.
   *
   * **Validates: Requirements 3.4**
   */
  describe('Property 10: Manager removal cascades to agents', () => {
    it('should clear branchId for manager and all linked agents', () => {
      fc.assert(
        fc.property(
          userIdArb,
          branchIdArb,
          agentCountArb,
          (managerId, branchId, agentCount) => {
            const manager = makeManager(managerId, branchId);
            const agents = Array.from({ length: agentCount }, (_, i) =>
              makeAgent(`agent-${managerId}-${i}`, managerId, branchId)
            );
            const store: UserStore = { users: [manager, ...agents] };

            const result = simulateRemoveManagerFromBranch(store, managerId);

            const updatedManager = result.users.find(u => u.$id === managerId)!;
            const updatedAgents = result.users.filter(u => u.role === 'agent' && u.managerId === managerId);

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
   * Feature: admin-branch-management, Property 12: Manager sees only branch agents
   *
   * For any set of agents across multiple branches, when a manager lists agents,
   * the returned agents all have a branchId matching the manager's branchId,
   * and no agents from other branches are included.
   *
   * **Validates: Requirements 4.2**
   */
  describe('Property 12: Manager sees only branch agents', () => {
    it('should return only agents from the manager branch', () => {
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
   * Feature: admin-branch-management, Property 19: Admin can specify manager and branch on agent creation
   *
   * For any admin user creating an agent with a specified managerId and branchId,
   * the resulting agent document has those exact values.
   *
   * **Validates: Requirements 6.2**
   */
  describe('Property 19: Admin can specify manager and branch on agent creation', () => {
    it('should create agent with specified managerId and branchId', () => {
      fc.assert(
        fc.property(
          userIdArb,
          userIdArb,
          branchIdArb,
          branchIdArb,
          nameArb,
          emailArb,
          (agentId, managerId, managerBranch, specifiedBranch, name, email) => {
            fc.pre(agentId !== managerId);

            const manager = makeManager(managerId, managerBranch);
            const store: UserStore = { users: [manager] };

            // Admin specifies a different branch than the manager's
            const result = simulateCreateAgent(store, agentId, name, email, managerId, specifiedBranch);
            const createdAgent = result.users.find(u => u.$id === agentId)!;

            return (
              createdAgent.managerId === managerId &&
              createdAgent.branchId === specifiedBranch &&
              createdAgent.role === 'agent'
            );
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should inherit manager branchId when no override is specified', () => {
      fc.assert(
        fc.property(
          userIdArb,
          userIdArb,
          branchIdArb,
          nameArb,
          emailArb,
          (agentId, managerId, managerBranch, name, email) => {
            fc.pre(agentId !== managerId);

            const manager = makeManager(managerId, managerBranch);
            const store: UserStore = { users: [manager] };

            // No branchId override — should inherit from manager
            const result = simulateCreateAgent(store, agentId, name, email, managerId);
            const createdAgent = result.users.find(u => u.$id === agentId)!;

            return (
              createdAgent.managerId === managerId &&
              createdAgent.branchId === managerBranch
            );
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
