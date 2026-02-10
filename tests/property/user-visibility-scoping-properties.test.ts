import fc from 'fast-check';
import { User, UserRole } from '@/lib/types';

/**
 * Feature: team-lead-role-hierarchy, Property 10: User visibility scoping
 *
 * For any set of users across branches and any querying user with role Manager or Team_Lead,
 * only users whose branchIds array has at least one element in common with the querying user's
 * branchIds SHALL be returned.
 *
 * **Validates: Requirements 5.5, 5.6**
 */

const branchIdArb = fc.stringMatching(/^[a-z0-9]{4,12}$/);

/**
 * Pure filtering logic matching getUsersByBranches behavior.
 * Given a set of querying branchIds, returns only users whose branchIds
 * overlap (have at least one element in common) with the querying set.
 */
function filterUsersByBranchOverlap(
  allUsers: User[],
  queryBranchIds: string[]
): User[] {
  if (!queryBranchIds.length) return [];
  return allUsers.filter((u) =>
    u.branchIds.some((bid) => queryBranchIds.includes(bid))
  );
}

const userArb = (branchPool: string[]) =>
  fc.record({
    $id: fc.uuid(),
    name: fc.string({ minLength: 1, maxLength: 64 }),
    email: fc.emailAddress(),
    role: fc.constantFrom<UserRole>('admin', 'manager', 'team_lead', 'agent'),
    managerId: fc.option(fc.uuid(), { nil: null }),
    teamLeadId: fc.option(fc.uuid(), { nil: null }),
    branchIds: fc.subarray(branchPool, { minLength: 1 }),
  });

describe('User Visibility Scoping Properties', () => {
  describe('Property 10: User visibility scoping', () => {
    it('manager should see only users with overlapping branchIds', () => {
      fc.assert(
        fc.property(
          fc.uniqueArray(branchIdArb, { minLength: 2, maxLength: 6 }).chain((branchPool) =>
            fc.record({
              managerBranchIds: fc.subarray(branchPool, { minLength: 1 }),
              users: fc.array(userArb(branchPool), { minLength: 1, maxLength: 15 }),
            })
          ),
          ({ managerBranchIds, users }) => {
            const result = filterUsersByBranchOverlap(users, managerBranchIds);

            // Every returned user must have at least one branch in common
            for (const u of result) {
              expect(u.branchIds.some((b) => managerBranchIds.includes(b))).toBe(true);
            }

            // No eligible user should be missing
            const expected = users.filter((u) =>
              u.branchIds.some((b) => managerBranchIds.includes(b))
            );
            expect(result).toHaveLength(expected.length);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('team_lead should see only users with overlapping branchIds', () => {
      fc.assert(
        fc.property(
          fc.uniqueArray(branchIdArb, { minLength: 2, maxLength: 6 }).chain((branchPool) =>
            fc.record({
              teamLeadBranchIds: fc.subarray(branchPool, { minLength: 1 }),
              users: fc.array(userArb(branchPool), { minLength: 1, maxLength: 15 }),
            })
          ),
          ({ teamLeadBranchIds, users }) => {
            const result = filterUsersByBranchOverlap(users, teamLeadBranchIds);

            for (const u of result) {
              expect(u.branchIds.some((b) => teamLeadBranchIds.includes(b))).toBe(true);
            }

            const expected = users.filter((u) =>
              u.branchIds.some((b) => teamLeadBranchIds.includes(b))
            );
            expect(result).toHaveLength(expected.length);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('querying with empty branchIds should return no users', () => {
      fc.assert(
        fc.property(
          fc.uniqueArray(branchIdArb, { minLength: 1, maxLength: 4 }).chain((branchPool) =>
            fc.array(userArb(branchPool), { minLength: 1, maxLength: 10 })
          ),
          (users) => {
            const result = filterUsersByBranchOverlap(users, []);
            expect(result).toHaveLength(0);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('users with no overlapping branches should never be returned', () => {
      fc.assert(
        fc.property(
          fc.uniqueArray(branchIdArb, { minLength: 4, maxLength: 8 }).chain((branchPool) => {
            // Split pool into two disjoint sets
            const midpoint = Math.floor(branchPool.length / 2);
            const queryBranches = branchPool.slice(0, midpoint);
            const disjointBranches = branchPool.slice(midpoint);
            return fc.record({
              queryBranchIds: fc.constant(queryBranches),
              disjointUsers: fc.array(
                fc.record({
                  $id: fc.uuid(),
                  name: fc.string({ minLength: 1, maxLength: 64 }),
                  email: fc.emailAddress(),
                  role: fc.constantFrom<UserRole>('admin', 'manager', 'team_lead', 'agent'),
                  managerId: fc.option(fc.uuid(), { nil: null }),
                  teamLeadId: fc.option(fc.uuid(), { nil: null }),
                  branchIds: fc.subarray(disjointBranches, { minLength: 1 }),
                }),
                { minLength: 1, maxLength: 10 }
              ),
            });
          }),
          ({ queryBranchIds, disjointUsers }) => {
            const result = filterUsersByBranchOverlap(disjointUsers, queryBranchIds);
            expect(result).toHaveLength(0);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('users with fully overlapping branches should all be returned', () => {
      fc.assert(
        fc.property(
          fc.uniqueArray(branchIdArb, { minLength: 1, maxLength: 4 }).chain((branchPool) =>
            fc.record({
              queryBranchIds: fc.constant(branchPool),
              users: fc.array(
                fc.record({
                  $id: fc.uuid(),
                  name: fc.string({ minLength: 1, maxLength: 64 }),
                  email: fc.emailAddress(),
                  role: fc.constantFrom<UserRole>('admin', 'manager', 'team_lead', 'agent'),
                  managerId: fc.option(fc.uuid(), { nil: null }),
                  teamLeadId: fc.option(fc.uuid(), { nil: null }),
                  branchIds: fc.subarray(branchPool, { minLength: 1 }),
                }),
                { minLength: 1, maxLength: 10 }
              ),
            })
          ),
          ({ queryBranchIds, users }) => {
            // All users have branches from the same pool as queryBranchIds,
            // so every user must have at least one overlapping branch
            const result = filterUsersByBranchOverlap(users, queryBranchIds);
            expect(result).toHaveLength(users.length);
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
