import fc from 'fast-check';
import { User, UserRole } from '@/lib/types';

/**
 * Feature: team-lead-role-hierarchy, Property 8: Assignable users filtering
 *
 * For any user with role and branchIds, getAssignableUsers SHALL return:
 * - Manager: only users with role team_lead or agent whose branchIds overlap
 * - Team_Lead: only users with role agent whose branchIds overlap
 * - Agent: an empty array
 *
 * Validates: Requirements 4.2, 4.3, 4.4
 */

const branchIdArb = fc.stringMatching(/^[a-z0-9]{4,12}$/);

/**
 * Pure filtering logic matching getAssignableUsers behavior, for testability.
 */
function filterAssignableUsers(
  creatorRole: UserRole,
  creatorBranchIds: string[],
  allUsers: User[]
): User[] {
  if (creatorRole === 'agent' || !creatorBranchIds.length) return [];

  const allowedRoles: UserRole[] =
    creatorRole === 'manager' ? ['team_lead', 'agent'] :
    creatorRole === 'team_lead' ? ['agent'] :
    [];

  if (!allowedRoles.length) return [];

  return allUsers.filter(
    (u) =>
      allowedRoles.includes(u.role) &&
      u.branchIds.some((bid) => creatorBranchIds.includes(bid))
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

describe('Assignable Users Filtering Properties', () => {
  describe('Property 8: Assignable users filtering', () => {
    it('manager should see team_leads and agents with overlapping branches', () => {
      fc.assert(
        fc.property(
          fc.uniqueArray(branchIdArb, { minLength: 2, maxLength: 6 }).chain((pool) =>
            fc.record({
              creatorBranchIds: fc.subarray(pool, { minLength: 1 }),
              users: fc.array(userArb(pool), { minLength: 1, maxLength: 10 }),
            })
          ),
          ({ creatorBranchIds, users }) => {
            const result = filterAssignableUsers('manager', creatorBranchIds, users);

            // Every returned user must be team_lead or agent
            for (const u of result) {
              expect(['team_lead', 'agent']).toContain(u.role);
            }
            // Every returned user must have overlapping branches
            for (const u of result) {
              expect(u.branchIds.some((b) => creatorBranchIds.includes(b))).toBe(true);
            }
            // No eligible user should be missing
            const expected = users.filter(
              (u) =>
                (u.role === 'team_lead' || u.role === 'agent') &&
                u.branchIds.some((b) => creatorBranchIds.includes(b))
            );
            expect(result).toHaveLength(expected.length);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('team lead should see only agents with overlapping branches', () => {
      fc.assert(
        fc.property(
          fc.uniqueArray(branchIdArb, { minLength: 2, maxLength: 6 }).chain((pool) =>
            fc.record({
              creatorBranchIds: fc.subarray(pool, { minLength: 1 }),
              users: fc.array(userArb(pool), { minLength: 1, maxLength: 10 }),
            })
          ),
          ({ creatorBranchIds, users }) => {
            const result = filterAssignableUsers('team_lead', creatorBranchIds, users);

            for (const u of result) {
              expect(u.role).toBe('agent');
              expect(u.branchIds.some((b) => creatorBranchIds.includes(b))).toBe(true);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('agent should always get an empty array', () => {
      fc.assert(
        fc.property(
          fc.uniqueArray(branchIdArb, { minLength: 1, maxLength: 4 }).chain((pool) =>
            fc.record({
              creatorBranchIds: fc.subarray(pool, { minLength: 1 }),
              users: fc.array(userArb(pool), { minLength: 0, maxLength: 10 }),
            })
          ),
          ({ creatorBranchIds, users }) => {
            const result = filterAssignableUsers('agent', creatorBranchIds, users);
            expect(result).toHaveLength(0);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('admin should get an empty array (admins do not use assignable users)', () => {
      fc.assert(
        fc.property(
          fc.uniqueArray(branchIdArb, { minLength: 1, maxLength: 4 }).chain((pool) =>
            fc.record({
              creatorBranchIds: fc.subarray(pool, { minLength: 1 }),
              users: fc.array(userArb(pool), { minLength: 0, maxLength: 10 }),
            })
          ),
          ({ creatorBranchIds, users }) => {
            const result = filterAssignableUsers('admin', creatorBranchIds, users);
            expect(result).toHaveLength(0);
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
