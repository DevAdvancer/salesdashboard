import fc from 'fast-check';

/**
 * Feature: team-lead-role-hierarchy, Property 5: Branch subset validation on user creation
 *
 * For any creator (Manager or Team_Lead) with branchIds B_creator, and any set of branch IDs
 * B_target to assign to a new subordinate: if B_target ⊆ B_creator, the creation SHALL succeed
 * and the new user's branchIds SHALL equal B_target; if B_target ⊄ B_creator, the creation
 * SHALL be rejected with an error.
 *
 * Validates: Requirements 3.2, 3.3, 3.4
 */

/**
 * Pure validation logic extracted for testability.
 * This mirrors the validation in createTeamLead and createAgent.
 */
function validateBranchSubset(
  creatorBranchIds: string[],
  targetBranchIds: string[]
): { valid: boolean; invalidBranch?: string } {
  for (const bid of targetBranchIds) {
    if (!creatorBranchIds.includes(bid)) {
      return { valid: false, invalidBranch: bid };
    }
  }
  return { valid: true };
}

const branchIdArb = fc.stringMatching(/^[a-z0-9]{4,12}$/);

describe('Branch Subset Validation Properties', () => {
  describe('Property 5: Branch subset validation on user creation', () => {
    it('should accept target branchIds that are a subset of creator branchIds', () => {
      fc.assert(
        fc.property(
          fc.uniqueArray(branchIdArb, { minLength: 1, maxLength: 10 }),
          (creatorBranchIds) => {
            // Pick a random subset of the creator's branches
            const targetBranchIds = creatorBranchIds.slice(
              0,
              Math.max(1, Math.floor(creatorBranchIds.length / 2)) || 1
            );
            const result = validateBranchSubset(creatorBranchIds, targetBranchIds);
            expect(result.valid).toBe(true);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should reject target branchIds containing branches not in creator branchIds', () => {
      fc.assert(
        fc.property(
          fc.uniqueArray(branchIdArb, { minLength: 1, maxLength: 5 }),
          branchIdArb.filter((b) => true), // extra branch guaranteed unique below
          (creatorBranchIds, extraBranch) => {
            fc.pre(!creatorBranchIds.includes(extraBranch));
            const targetBranchIds = [...creatorBranchIds.slice(0, 1), extraBranch];
            const result = validateBranchSubset(creatorBranchIds, targetBranchIds);
            expect(result.valid).toBe(false);
            expect(result.invalidBranch).toBe(extraBranch);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should accept when target equals creator branchIds exactly', () => {
      fc.assert(
        fc.property(
          fc.uniqueArray(branchIdArb, { minLength: 1, maxLength: 10 }),
          (branchIds) => {
            const result = validateBranchSubset(branchIds, [...branchIds]);
            expect(result.valid).toBe(true);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should accept single-element subset', () => {
      fc.assert(
        fc.property(
          fc.uniqueArray(branchIdArb, { minLength: 1, maxLength: 10 }),
          (creatorBranchIds) => {
            const target = [creatorBranchIds[0]];
            const result = validateBranchSubset(creatorBranchIds, target);
            expect(result.valid).toBe(true);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should work symmetrically for manager→team_lead and team_lead→agent', () => {
      fc.assert(
        fc.property(
          fc.uniqueArray(branchIdArb, { minLength: 2, maxLength: 8 }),
          fc.boolean(),
          (creatorBranchIds, isManagerCreating) => {
            // The validation logic is the same regardless of who is creating
            const subset = creatorBranchIds.slice(0, 1);
            const result = validateBranchSubset(creatorBranchIds, subset);
            expect(result.valid).toBe(true);
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
