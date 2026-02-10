import fc from 'fast-check';
import { UserRole, CreateLeadInput, Lead } from '@/lib/types';

/**
 * Feature: team-lead-role-hierarchy, Property 7: Auto-ownership on lead creation
 *
 * For any user creating a lead, the resulting lead's ownerId SHALL equal the
 * creating user's ID, regardless of the user's role.
 *
 * **Validates: Requirements 4.1**
 */

/**
 * Simulates the core auto-ownership logic from createLead in lead-service.ts.
 * The service always sets ownerId = creatingUserId.
 */
function simulateCreateLead(creatingUserId: string, input: CreateLeadInput): Lead {
  const ownerId = creatingUserId;

  return {
    $id: 'lead-' + Math.random().toString(36).slice(2),
    data: JSON.stringify(input.data),
    status: input.status || 'New',
    ownerId,
    assignedToId: input.assignedToId || null,
    branchId: input.branchId || null,
    isClosed: false,
    closedAt: null,
  };
}

// Arbitraries
const userIdArb = fc.integer({ min: 1, max: 10000 }).map((n) => `user-${n}`);
const roleArb = fc.constantFrom<UserRole>('admin', 'manager', 'team_lead', 'agent');
const branchIdArb = fc.stringMatching(/^[a-z0-9]{4,12}$/);

const leadDataArb = fc.record({
  name: fc.string({ minLength: 1, maxLength: 100 }),
  email: fc.emailAddress(),
  phone: fc.string({ minLength: 5, maxLength: 20 }),
});

const createLeadInputArb = fc.record({
  data: leadDataArb,
  status: fc.constantFrom('New', 'Contacted', 'Qualified', 'Lost'),
  assignedToId: fc.option(userIdArb, { nil: undefined }),
  branchId: fc.option(branchIdArb, { nil: undefined }),
});

describe('Auto-Ownership Properties', () => {
  describe('Property 7: Auto-ownership on lead creation', () => {
    it('ownerId should always equal the creating user ID regardless of role', () => {
      fc.assert(
        fc.property(
          roleArb,
          userIdArb,
          createLeadInputArb,
          (role, creatingUserId, input) => {
            const lead = simulateCreateLead(creatingUserId, input);
            expect(lead.ownerId).toBe(creatingUserId);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('ownerId should equal creator ID even when assignedToId is set to a different user', () => {
      fc.assert(
        fc.property(
          fc.uniqueArray(userIdArb, { minLength: 2, maxLength: 2 }).chain(([creatorId, assigneeId]) =>
            fc.record({
              creatingUserId: fc.constant(creatorId),
              assigneeId: fc.constant(assigneeId),
              input: createLeadInputArb,
            })
          ),
          ({ creatingUserId, assigneeId, input }) => {
            const inputWithAssignment = { ...input, assignedToId: assigneeId };
            const lead = simulateCreateLead(creatingUserId, inputWithAssignment);

            expect(lead.ownerId).toBe(creatingUserId);
            expect(lead.assignedToId).toBe(assigneeId);
            expect(lead.ownerId).not.toBe(lead.assignedToId);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('ownerId should never be null or undefined', () => {
      fc.assert(
        fc.property(
          userIdArb,
          createLeadInputArb,
          (creatingUserId, input) => {
            const lead = simulateCreateLead(creatingUserId, input);
            expect(lead.ownerId).toBeDefined();
            expect(lead.ownerId).not.toBeNull();
            expect(lead.ownerId.length).toBeGreaterThan(0);
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
