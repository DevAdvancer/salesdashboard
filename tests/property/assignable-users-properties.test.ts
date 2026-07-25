import fc from 'fast-check';
import { User, UserRole } from '@/lib/types';

/**
 * Feature: team-lead-role-hierarchy, Property 8: Assignable users filtering
 *
 * For any user with role and branchIds, getAssignableUsers SHALL return:
 * - Admin / developer / monitor / operations: every active user in the roster,
 *   across all branches, excluding themselves
 * - Team lead: only active agents on their own team (teamLeadId === their id)
 *   whose branchIds overlap their own, and an empty array when they hold no
 *   branches
 * - Agent / lead_generation: an empty array
 *
 * The old 'manager' tier this file was written against no longer exists, which
 * left the model below with an unreachable `creatorRole === 'team_lead'` branch
 * and two tests making contradictory claims about the same role.
 *
 * Validates: Requirements 4.2, 4.3, 4.4
 */

const branchIdArb = fc.stringMatching(/^[a-z0-9]{4,12}$/);

const LEADERSHIP_ROLES: UserRole[] = ['admin', 'developer', 'monitor', 'operations'];

/**
 * Pure filtering logic matching getAssignableUsers behavior
 * (lib/services/user-service.ts), for testability. The real implementation
 * pushes the role and branch predicates into Appwrite queries, so they are
 * restated here.
 */
function filterAssignableUsers(
  creatorRole: UserRole,
  creatorBranchIds: string[],
  allUsers: User[],
  creatorId?: string
): User[] {
  if (creatorRole === 'agent' || creatorRole === 'lead_generation') return [];

  const isLeadership = LEADERSHIP_ROLES.includes(creatorRole);

  // Only branch-scoped roles are short-circuited by an empty branch list
  if (!isLeadership && !creatorBranchIds.length) return [];

  const allowedRoles: UserRole[] = isLeadership
    ? ['admin', 'developer', 'team_lead', 'agent', 'operations', 'monitor']
    : creatorRole === 'team_lead'
      ? ['agent']
      : [];

  if (!allowedRoles.length) return [];

  return allUsers.filter((u) => {
    if (!allowedRoles.includes(u.role)) return false;
    if (u.isActive === false) return false;
    if (creatorId && u.$id === creatorId) return false;
    if (isLeadership) return true;
    // Team lead: own team only, and only where branches overlap
    if (!u.branchIds.some((bid) => creatorBranchIds.includes(bid))) return false;
    if (creatorId && u.teamLeadId !== creatorId) return false;
    return true;
  });
}

const userArb = (branchPool: string[], teamLeadIdPool: string[]) =>
  fc.record({
    $id: fc.uuid(),
    name: fc.string({ minLength: 1, maxLength: 64 }),
    email: fc.emailAddress(),
    role: fc.constantFrom<UserRole>(
      'admin',
      'developer',
      'team_lead',
      'agent',
      'lead_generation',
      'monitor',
      'operations'
    ),
    teamLeadId: fc.option(fc.constantFrom(...teamLeadIdPool), { nil: null }),
    branchIds: fc.subarray(branchPool, { minLength: 1 }),
    isActive: fc.boolean(),
  }) as fc.Arbitrary<User>;

const CREATOR_ID = 'creator-001';
const teamLeadIdPool = [CREATOR_ID, 'other-team-lead'];

const rosterArb = (minBranches: number, maxBranches: number) =>
  fc.uniqueArray(branchIdArb, { minLength: minBranches, maxLength: maxBranches }).chain((pool) =>
    fc.record({
      creatorBranchIds: fc.subarray(pool, { minLength: 1 }),
      users: fc.array(userArb(pool, teamLeadIdPool), { minLength: 1, maxLength: 10 }),
    })
  );

describe('Assignable Users Filtering Properties', () => {
  describe('Property 8: Assignable users filtering', () => {
    it('leadership roles should see every active user regardless of branch overlap', () => {
      fc.assert(
        fc.property(
          fc.constantFrom(...LEADERSHIP_ROLES),
          rosterArb(2, 6),
          (creatorRole, { creatorBranchIds, users }) => {
            const result = filterAssignableUsers(creatorRole, creatorBranchIds, users, CREATOR_ID);

            // lead_generation is the one role leadership cannot assign leads to
            for (const u of result) {
              expect(u.role).not.toBe('lead_generation');
              expect(u.isActive).not.toBe(false);
            }

            // Branch overlap must not narrow the result for leadership
            const expected = users.filter(
              (u) => u.role !== 'lead_generation' && u.isActive !== false && u.$id !== CREATOR_ID
            );
            expect(result).toHaveLength(expected.length);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('team lead should see only their own active agents with overlapping branches', () => {
      fc.assert(
        fc.property(rosterArb(2, 6), ({ creatorBranchIds, users }) => {
          const result = filterAssignableUsers('team_lead', creatorBranchIds, users, CREATOR_ID);

          for (const u of result) {
            expect(u.role).toBe('agent');
            expect(u.isActive).not.toBe(false);
            expect(u.teamLeadId).toBe(CREATOR_ID);
            expect(u.branchIds.some((b) => creatorBranchIds.includes(b))).toBe(true);
          }

          // No eligible user should be missing
          const expected = users.filter(
            (u) =>
              u.role === 'agent' &&
              u.isActive !== false &&
              u.teamLeadId === CREATOR_ID &&
              u.$id !== CREATOR_ID &&
              u.branchIds.some((b) => creatorBranchIds.includes(b))
          );
          expect(result).toHaveLength(expected.length);
        }),
        { numRuns: 100 }
      );
    });

    it('agent should always get an empty array', () => {
      fc.assert(
        fc.property(rosterArb(1, 4), ({ creatorBranchIds, users }) => {
          const result = filterAssignableUsers('agent', creatorBranchIds, users, CREATOR_ID);
          expect(result).toHaveLength(0);
        }),
        { numRuns: 100 }
      );
    });

    it('lead generation should always get an empty array', () => {
      fc.assert(
        fc.property(rosterArb(1, 4), ({ creatorBranchIds, users }) => {
          const result = filterAssignableUsers('lead_generation', creatorBranchIds, users, CREATOR_ID);
          expect(result).toHaveLength(0);
        }),
        { numRuns: 100 }
      );
    });

    it('a team lead holding no branches should get an empty array', () => {
      fc.assert(
        fc.property(rosterArb(1, 4), ({ users }) => {
          const result = filterAssignableUsers('team_lead', [], users, CREATOR_ID);
          expect(result).toHaveLength(0);
        }),
        { numRuns: 100 }
      );
    });
  });
});
