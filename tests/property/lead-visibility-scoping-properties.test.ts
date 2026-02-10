import fc from 'fast-check';
import { UserRole, Lead } from '@/lib/types';

/**
 * Feature: team-lead-role-hierarchy, Property 9: Lead visibility scoping
 *
 * For any set of leads across branches and any querying user:
 * - If the user is Admin, all leads SHALL be returned
 * - If the user is Manager or Team_Lead, only leads whose branchId is in the user's branchIds SHALL be returned
 * - If the user is Agent, only leads whose assignedToId equals the user's ID SHALL be returned
 *
 * **Validates: Requirements 5.1, 5.2, 5.3, 5.4**
 */

interface QueryingUser {
  $id: string;
  role: UserRole;
  branchIds: string[];
}

/**
 * Pure filtering logic matching listLeads role-based visibility behavior.
 * This mirrors the core filtering in lead-service.ts listLeads without Appwrite dependencies.
 */
function filterLeadsByVisibility(
  allLeads: Lead[],
  user: QueryingUser
): Lead[] {
  if (user.role === 'admin') {
    return allLeads;
  }
  if (user.role === 'agent') {
    return allLeads.filter((l) => l.assignedToId === user.$id);
  }
  // Manager or Team_Lead: filter by branchIds overlap
  if (user.branchIds.length > 0) {
    return allLeads.filter((l) => l.branchId !== null && user.branchIds.includes(l.branchId));
  }
  // Manager/Team_Lead without branches sees only their own leads
  return allLeads.filter((l) => l.ownerId === user.$id);
}

// Arbitraries
const branchIdArb = fc.stringMatching(/^[a-z0-9]{4,12}$/);
const userIdArb = fc.integer({ min: 1, max: 10000 }).map((n) => `user-${n}`);
const leadIdArb = fc.uuid();

const leadArb = (branchPool: string[], userIdPool: string[]) =>
  fc.record({
    $id: leadIdArb,
    data: fc.constant('{"name":"Test Lead"}'),
    status: fc.constantFrom('New', 'Contacted', 'Qualified'),
    ownerId: fc.constantFrom(...userIdPool),
    assignedToId: fc.oneof(fc.constantFrom(...userIdPool), fc.constant(null as string | null)),
    branchId: fc.oneof(fc.constantFrom(...branchPool), fc.constant(null as string | null)),
    isClosed: fc.constant(false),
    closedAt: fc.constant(null as string | null),
  });

describe('Lead Visibility Scoping Properties', () => {
  describe('Property 9: Lead visibility scoping', () => {
    it('admin should see all leads regardless of branch', () => {
      fc.assert(
        fc.property(
          fc.uniqueArray(branchIdArb, { minLength: 2, maxLength: 6 }).chain((branchPool) =>
            fc.uniqueArray(userIdArb, { minLength: 2, maxLength: 5 }).chain((userPool) =>
              fc.record({
                leads: fc.array(leadArb(branchPool, userPool), { minLength: 1, maxLength: 15 }),
                adminId: fc.constantFrom(...userPool),
              })
            )
          ),
          ({ leads, adminId }) => {
            const admin: QueryingUser = {
              $id: adminId,
              role: 'admin',
              branchIds: [],
            };

            const result = filterLeadsByVisibility(leads, admin);
            expect(result).toHaveLength(leads.length);
            expect(result).toEqual(leads);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('manager should see only leads whose branchId is in their branchIds', () => {
      fc.assert(
        fc.property(
          fc.uniqueArray(branchIdArb, { minLength: 2, maxLength: 6 }).chain((branchPool) =>
            fc.uniqueArray(userIdArb, { minLength: 2, maxLength: 5 }).chain((userPool) =>
              fc.record({
                managerBranchIds: fc.subarray(branchPool, { minLength: 1 }),
                leads: fc.array(leadArb(branchPool, userPool), { minLength: 1, maxLength: 15 }),
                managerId: fc.constantFrom(...userPool),
              })
            )
          ),
          ({ managerBranchIds, leads, managerId }) => {
            const manager: QueryingUser = {
              $id: managerId,
              role: 'manager',
              branchIds: managerBranchIds,
            };

            const result = filterLeadsByVisibility(leads, manager);

            // Every returned lead must have a branchId in the manager's branchIds
            for (const lead of result) {
              expect(lead.branchId).not.toBeNull();
              expect(managerBranchIds).toContain(lead.branchId);
            }

            // No eligible lead should be missing
            const expected = leads.filter(
              (l) => l.branchId !== null && managerBranchIds.includes(l.branchId)
            );
            expect(result).toHaveLength(expected.length);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('team_lead should see only leads whose branchId is in their branchIds', () => {
      fc.assert(
        fc.property(
          fc.uniqueArray(branchIdArb, { minLength: 2, maxLength: 6 }).chain((branchPool) =>
            fc.uniqueArray(userIdArb, { minLength: 2, maxLength: 5 }).chain((userPool) =>
              fc.record({
                teamLeadBranchIds: fc.subarray(branchPool, { minLength: 1 }),
                leads: fc.array(leadArb(branchPool, userPool), { minLength: 1, maxLength: 15 }),
                teamLeadId: fc.constantFrom(...userPool),
              })
            )
          ),
          ({ teamLeadBranchIds, leads, teamLeadId }) => {
            const teamLead: QueryingUser = {
              $id: teamLeadId,
              role: 'team_lead',
              branchIds: teamLeadBranchIds,
            };

            const result = filterLeadsByVisibility(leads, teamLead);

            // Every returned lead must have a branchId in the team lead's branchIds
            for (const lead of result) {
              expect(lead.branchId).not.toBeNull();
              expect(teamLeadBranchIds).toContain(lead.branchId);
            }

            // No eligible lead should be missing
            const expected = leads.filter(
              (l) => l.branchId !== null && teamLeadBranchIds.includes(l.branchId)
            );
            expect(result).toHaveLength(expected.length);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('agent should see only leads assigned to them', () => {
      fc.assert(
        fc.property(
          fc.uniqueArray(branchIdArb, { minLength: 1, maxLength: 4 }).chain((branchPool) =>
            fc.uniqueArray(userIdArb, { minLength: 2, maxLength: 5 }).chain((userPool) =>
              fc.record({
                leads: fc.array(leadArb(branchPool, userPool), { minLength: 1, maxLength: 15 }),
                agentId: fc.constantFrom(...userPool),
              })
            )
          ),
          ({ leads, agentId }) => {
            const agent: QueryingUser = {
              $id: agentId,
              role: 'agent',
              branchIds: [],
            };

            const result = filterLeadsByVisibility(leads, agent);

            // Every returned lead must be assigned to the agent
            for (const lead of result) {
              expect(lead.assignedToId).toBe(agentId);
            }

            // No eligible lead should be missing
            const expected = leads.filter((l) => l.assignedToId === agentId);
            expect(result).toHaveLength(expected.length);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('manager/team_lead with empty branchIds should see only their own leads', () => {
      fc.assert(
        fc.property(
          fc.constantFrom<UserRole>('manager', 'team_lead'),
          fc.uniqueArray(branchIdArb, { minLength: 1, maxLength: 4 }).chain((branchPool) =>
            fc.uniqueArray(userIdArb, { minLength: 2, maxLength: 5 }).chain((userPool) =>
              fc.record({
                leads: fc.array(leadArb(branchPool, userPool), { minLength: 1, maxLength: 15 }),
                userId: fc.constantFrom(...userPool),
              })
            )
          ),
          (role, { leads, userId }) => {
            const user: QueryingUser = {
              $id: userId,
              role,
              branchIds: [],
            };

            const result = filterLeadsByVisibility(leads, user);

            // Every returned lead must be owned by the user
            for (const lead of result) {
              expect(lead.ownerId).toBe(userId);
            }

            // No eligible lead should be missing
            const expected = leads.filter((l) => l.ownerId === userId);
            expect(result).toHaveLength(expected.length);
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
