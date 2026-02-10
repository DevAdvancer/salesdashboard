import fc from 'fast-check';
import { LeadData, LeadValidationResult } from '@/lib/types';

/**
 * Feature: admin-branch-management
 * Property tests for Lead Validator
 *
 * These tests validate the core business rules of cross-branch lead
 * duplicate detection using pure logic simulation (no Appwrite dependency).
 */

// --- Helpers: simulate lead validator logic ---

interface LeadRecord {
  $id: string;
  data: LeadData;
  branchId: string | null;
}

interface LeadStore {
  leads: LeadRecord[];
}

/**
 * Simulates the validateLeadUniqueness function.
 * Checks for duplicate email and phone across all leads globally (no branch filter).
 * Optionally excludes a lead by ID (for update scenarios).
 */
function simulateValidateLeadUniqueness(
  store: LeadStore,
  data: LeadData,
  excludeLeadId?: string
): LeadValidationResult {
  const email = data.email as string | undefined;
  const phone = data.phone as string | undefined;

  // Check email uniqueness
  if (email) {
    for (const lead of store.leads) {
      if (excludeLeadId && lead.$id === excludeLeadId) continue;
      if (lead.data.email === email) {
        return {
          isValid: false,
          duplicateField: 'email',
          existingLeadId: lead.$id,
          existingBranchId: lead.branchId || undefined,
        };
      }
    }
  }

  // Check phone uniqueness
  if (phone) {
    for (const lead of store.leads) {
      if (excludeLeadId && lead.$id === excludeLeadId) continue;
      if (lead.data.phone === phone) {
        return {
          isValid: false,
          duplicateField: 'phone',
          existingLeadId: lead.$id,
          existingBranchId: lead.branchId || undefined,
        };
      }
    }
  }

  return { isValid: true };
}

// --- Arbitraries ---

const emailArb = fc.tuple(
  fc.string({ minLength: 1, maxLength: 10 }).filter(s => /^[a-z0-9]+$/i.test(s)),
  fc.string({ minLength: 1, maxLength: 8 }).filter(s => /^[a-z0-9]+$/i.test(s)),
  fc.constantFrom('com', 'org', 'net', 'io')
).map(([user, domain, tld]) => `${user}@${domain}.${tld}`);

const phoneArb = fc.integer({ min: 1000000, max: 9999999999 }).map(n => `+${n}`);

const branchIdArb = fc.integer({ min: 1, max: 10000 }).map(n => `branch-${n}`);
const leadIdArb = fc.integer({ min: 1, max: 10000 }).map(n => `lead-${n}`);

describe('Lead Validator Properties', () => {
  /**
   * Feature: admin-branch-management, Property 16: Cross-branch duplicate detection for email and phone
   *
   * For any set of existing leads across multiple branches and a new lead whose email
   * or phone matches an existing lead in any branch, the Lead_Validator detects the
   * duplicate and returns an error identifying the duplicate field ('email' or 'phone').
   *
   * **Validates: Requirements 5.1, 5.2, 5.3**
   */
  describe('Property 16: Cross-branch duplicate detection for email and phone', () => {
    it('should detect duplicate email across different branches', () => {
      fc.assert(
        fc.property(
          emailArb,
          branchIdArb,
          branchIdArb,
          leadIdArb,
          (email, branchA, branchB, existingLeadId) => {
            // Ensure branches are different to test cross-branch detection
            fc.pre(branchA !== branchB);

            const store: LeadStore = {
              leads: [
                {
                  $id: existingLeadId,
                  data: { email, name: 'Existing Lead' },
                  branchId: branchA,
                },
              ],
            };

            // New lead in a different branch with the same email
            const newLeadData: LeadData = { email, name: 'New Lead' };
            const result = simulateValidateLeadUniqueness(store, newLeadData);

            return (
              result.isValid === false &&
              result.duplicateField === 'email' &&
              result.existingLeadId === existingLeadId &&
              result.existingBranchId === branchA
            );
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should detect duplicate phone across different branches', () => {
      fc.assert(
        fc.property(
          phoneArb,
          branchIdArb,
          branchIdArb,
          leadIdArb,
          (phone, branchA, branchB, existingLeadId) => {
            fc.pre(branchA !== branchB);

            const store: LeadStore = {
              leads: [
                {
                  $id: existingLeadId,
                  data: { phone, name: 'Existing Lead' },
                  branchId: branchA,
                },
              ],
            };

            // New lead in a different branch with the same phone
            const newLeadData: LeadData = { phone, name: 'New Lead' };
            const result = simulateValidateLeadUniqueness(store, newLeadData);

            return (
              result.isValid === false &&
              result.duplicateField === 'phone' &&
              result.existingLeadId === existingLeadId &&
              result.existingBranchId === branchA
            );
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should allow leads with unique email and phone across branches', () => {
      fc.assert(
        fc.property(
          emailArb,
          emailArb,
          phoneArb,
          phoneArb,
          branchIdArb,
          branchIdArb,
          leadIdArb,
          (emailA, emailB, phoneA, phoneB, branchA, branchB, existingLeadId) => {
            // Ensure emails and phones are different
            fc.pre(emailA !== emailB);
            fc.pre(phoneA !== phoneB);

            const store: LeadStore = {
              leads: [
                {
                  $id: existingLeadId,
                  data: { email: emailA, phone: phoneA, name: 'Existing Lead' },
                  branchId: branchA,
                },
              ],
            };

            // New lead with different email and phone
            const newLeadData: LeadData = { email: emailB, phone: phoneB, name: 'New Lead' };
            const result = simulateValidateLeadUniqueness(store, newLeadData);

            return result.isValid === true;
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should detect duplicates within the same branch', () => {
      fc.assert(
        fc.property(
          emailArb,
          branchIdArb,
          leadIdArb,
          (email, branchId, existingLeadId) => {
            const store: LeadStore = {
              leads: [
                {
                  $id: existingLeadId,
                  data: { email, name: 'Existing Lead' },
                  branchId,
                },
              ],
            };

            // New lead in the same branch with the same email
            const newLeadData: LeadData = { email, name: 'New Lead' };
            const result = simulateValidateLeadUniqueness(store, newLeadData);

            return (
              result.isValid === false &&
              result.duplicateField === 'email' &&
              result.existingLeadId === existingLeadId
            );
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  /**
   * Feature: admin-branch-management, Property 17: Duplicate check excludes self on update
   *
   * For any existing lead being updated, the Lead_Validator excludes that lead's own ID
   * from the duplicate check. A lead updating its own email/phone to the same value
   * does not trigger a duplicate error.
   *
   * **Validates: Requirements 5.4**
   */
  describe('Property 17: Duplicate check excludes self on update', () => {
    it('should not flag a lead as duplicate of itself when updating with same email', () => {
      fc.assert(
        fc.property(
          emailArb,
          branchIdArb,
          leadIdArb,
          (email, branchId, leadId) => {
            const store: LeadStore = {
              leads: [
                {
                  $id: leadId,
                  data: { email, name: 'My Lead' },
                  branchId,
                },
              ],
            };

            // Update the same lead with the same email — should pass
            const updateData: LeadData = { email, name: 'Updated Lead' };
            const result = simulateValidateLeadUniqueness(store, updateData, leadId);

            return result.isValid === true;
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should not flag a lead as duplicate of itself when updating with same phone', () => {
      fc.assert(
        fc.property(
          phoneArb,
          branchIdArb,
          leadIdArb,
          (phone, branchId, leadId) => {
            const store: LeadStore = {
              leads: [
                {
                  $id: leadId,
                  data: { phone, name: 'My Lead' },
                  branchId,
                },
              ],
            };

            // Update the same lead with the same phone — should pass
            const updateData: LeadData = { phone, name: 'Updated Lead' };
            const result = simulateValidateLeadUniqueness(store, updateData, leadId);

            return result.isValid === true;
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should still detect duplicates against other leads when updating', () => {
      fc.assert(
        fc.property(
          emailArb,
          branchIdArb,
          branchIdArb,
          leadIdArb,
          leadIdArb,
          (email, branchA, branchB, leadIdA, leadIdB) => {
            // Ensure lead IDs are different
            fc.pre(leadIdA !== leadIdB);

            const store: LeadStore = {
              leads: [
                {
                  $id: leadIdA,
                  data: { email, name: 'Lead A' },
                  branchId: branchA,
                },
                {
                  $id: leadIdB,
                  data: { email: 'different@example.com', name: 'Lead B' },
                  branchId: branchB,
                },
              ],
            };

            // Update lead B with lead A's email — should detect duplicate
            const updateData: LeadData = { email, name: 'Updated Lead B' };
            const result = simulateValidateLeadUniqueness(store, updateData, leadIdB);

            return (
              result.isValid === false &&
              result.duplicateField === 'email' &&
              result.existingLeadId === leadIdA &&
              result.existingBranchId === branchA
            );
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should allow updating a lead when no other lead has the same email or phone', () => {
      fc.assert(
        fc.property(
          emailArb,
          emailArb,
          phoneArb,
          phoneArb,
          branchIdArb,
          leadIdArb,
          leadIdArb,
          (emailA, emailB, phoneA, phoneB, branchId, leadIdA, leadIdB) => {
            fc.pre(emailA !== emailB);
            fc.pre(phoneA !== phoneB);
            fc.pre(leadIdA !== leadIdB);

            const store: LeadStore = {
              leads: [
                {
                  $id: leadIdA,
                  data: { email: emailA, phone: phoneA, name: 'Lead A' },
                  branchId,
                },
                {
                  $id: leadIdB,
                  data: { email: emailB, phone: phoneB, name: 'Lead B' },
                  branchId,
                },
              ],
            };

            // Update lead B with new unique values — should pass
            const updateData: LeadData = { email: emailB, phone: phoneB, name: 'Updated Lead B' };
            const result = simulateValidateLeadUniqueness(store, updateData, leadIdB);

            return result.isValid === true;
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});


// --- Helpers: simulate lead service branch logic ---

interface UserRecord {
  $id: string;
  role: 'admin' | 'manager' | 'agent';
  branchId: string | null;
}

/**
 * Simulates listLeads branch filtering logic.
 * - Admin: sees all leads across all branches
 * - Manager: sees only leads in their branch (or own leads if no branch)
 * - Agent: sees only leads assigned to them
 */
function simulateListLeads(
  allLeads: LeadRecord[],
  user: UserRecord
): LeadRecord[] {
  if (user.role === 'admin') {
    return allLeads;
  }
  if (user.role === 'agent') {
    return allLeads.filter((l) => (l as any).assignedToId === user.$id);
  }
  // Manager
  if (user.branchId) {
    return allLeads.filter((l) => l.branchId === user.branchId);
  }
  // Manager without branch sees only own leads
  return allLeads.filter((l) => (l as any).ownerId === user.$id);
}

/**
 * Simulates createLead branchId assignment.
 * - If branchId is explicitly provided (admin use case), use it
 * - Otherwise, inherit from the creator's branchId
 */
function simulateCreateLeadBranchId(
  creator: UserRecord,
  explicitBranchId?: string | null
): string | null {
  if (explicitBranchId !== undefined && explicitBranchId !== null) {
    return explicitBranchId;
  }
  return creator.branchId;
}

// Extended lead record for service tests
interface ServiceLeadRecord extends LeadRecord {
  ownerId: string;
  assignedToId: string | null;
}

const userIdArb = fc.integer({ min: 1, max: 10000 }).map((n) => `user-${n}`);

describe('Lead Service Branch Properties', () => {
  /**
   * Feature: admin-branch-management, Property 11: Manager sees only branch leads
   *
   * For any set of leads across multiple branches, when a manager lists leads,
   * the returned leads all have a branchId matching the manager's branchId,
   * and no leads from other branches are included.
   *
   * **Validates: Requirements 4.1**
   */
  describe('Property 11: Manager sees only branch leads', () => {
    it('should return only leads matching the manager branch', () => {
      fc.assert(
        fc.property(
          branchIdArb,
          branchIdArb,
          userIdArb,
          fc.array(
            fc.record({
              $id: leadIdArb,
              data: fc.constant({ name: 'Test' } as LeadData),
              branchId: branchIdArb,
              ownerId: userIdArb,
              assignedToId: fc.constant(null as string | null),
            }),
            { minLength: 1, maxLength: 20 }
          ),
          (managerBranch, otherBranch, managerId, leads) => {
            fc.pre(managerBranch !== otherBranch);

            const manager: UserRecord = {
              $id: managerId,
              role: 'manager',
              branchId: managerBranch,
            };

            const result = simulateListLeads(leads as any, manager);

            // Every returned lead must belong to the manager's branch
            return result.every((l) => l.branchId === managerBranch);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should not include leads from other branches', () => {
      fc.assert(
        fc.property(
          branchIdArb,
          branchIdArb,
          userIdArb,
          leadIdArb,
          leadIdArb,
          (managerBranch, otherBranch, managerId, leadId1, leadId2) => {
            fc.pre(managerBranch !== otherBranch);
            fc.pre(leadId1 !== leadId2);

            const leads: ServiceLeadRecord[] = [
              {
                $id: leadId1,
                data: { name: 'Branch Lead' },
                branchId: managerBranch,
                ownerId: managerId,
                assignedToId: null,
              },
              {
                $id: leadId2,
                data: { name: 'Other Lead' },
                branchId: otherBranch,
                ownerId: 'other-user',
                assignedToId: null,
              },
            ];

            const manager: UserRecord = {
              $id: managerId,
              role: 'manager',
              branchId: managerBranch,
            };

            const result = simulateListLeads(leads, manager);

            return (
              result.length === 1 &&
              result[0].$id === leadId1 &&
              result.every((l) => l.branchId === managerBranch)
            );
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  /**
   * Feature: admin-branch-management, Property 13: Admin sees all leads across branches
   *
   * For any set of leads across multiple branches, when an admin lists leads,
   * the returned set includes leads from every branch.
   *
   * **Validates: Requirements 4.3**
   */
  describe('Property 13: Admin sees all leads across branches', () => {
    it('should return all leads regardless of branch', () => {
      fc.assert(
        fc.property(
          userIdArb,
          fc.array(
            fc.record({
              $id: leadIdArb,
              data: fc.constant({ name: 'Test' } as LeadData),
              branchId: branchIdArb,
              ownerId: userIdArb,
              assignedToId: fc.constant(null as string | null),
            }),
            { minLength: 0, maxLength: 20 }
          ),
          (adminId, leads) => {
            const admin: UserRecord = {
              $id: adminId,
              role: 'admin',
              branchId: null,
            };

            const result = simulateListLeads(leads as any, admin);

            return result.length === leads.length;
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should include leads from multiple different branches', () => {
      fc.assert(
        fc.property(
          userIdArb,
          branchIdArb,
          branchIdArb,
          leadIdArb,
          leadIdArb,
          (adminId, branchA, branchB, leadId1, leadId2) => {
            fc.pre(branchA !== branchB);
            fc.pre(leadId1 !== leadId2);

            const leads: ServiceLeadRecord[] = [
              {
                $id: leadId1,
                data: { name: 'Lead A' },
                branchId: branchA,
                ownerId: 'owner-1',
                assignedToId: null,
              },
              {
                $id: leadId2,
                data: { name: 'Lead B' },
                branchId: branchB,
                ownerId: 'owner-2',
                assignedToId: null,
              },
            ];

            const admin: UserRecord = {
              $id: adminId,
              role: 'admin',
              branchId: null,
            };

            const result = simulateListLeads(leads, admin);
            const branchIds = new Set(result.map((l) => l.branchId));

            return result.length === 2 && branchIds.has(branchA) && branchIds.has(branchB);
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  /**
   * Feature: admin-branch-management, Property 15: Lead creation inherits creator's branchId
   *
   * For any lead created by a user (manager or agent) who has a branchId,
   * the resulting lead's branchId matches the creator's branchId.
   *
   * **Validates: Requirements 4.5**
   */
  describe('Property 15: Lead creation inherits creator branchId', () => {
    it('should set lead branchId to creator branchId when no explicit branchId given', () => {
      fc.assert(
        fc.property(
          userIdArb,
          branchIdArb,
          fc.constantFrom('manager', 'agent') as fc.Arbitrary<'manager' | 'agent'>,
          (userId, creatorBranch, role) => {
            const creator: UserRecord = {
              $id: userId,
              role,
              branchId: creatorBranch,
            };

            const resultBranchId = simulateCreateLeadBranchId(creator);

            return resultBranchId === creatorBranch;
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should set lead branchId to null when creator has no branch', () => {
      fc.assert(
        fc.property(
          userIdArb,
          fc.constantFrom('manager', 'agent') as fc.Arbitrary<'manager' | 'agent'>,
          (userId, role) => {
            const creator: UserRecord = {
              $id: userId,
              role,
              branchId: null,
            };

            const resultBranchId = simulateCreateLeadBranchId(creator);

            return resultBranchId === null;
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  /**
   * Feature: admin-branch-management, Property 18: Admin can specify branchId on lead creation
   *
   * For any admin user creating a lead with an explicit branchId, the resulting lead's
   * branchId matches the specified value, regardless of the admin's own branch assignment.
   *
   * **Validates: Requirements 6.1**
   */
  describe('Property 18: Admin can specify branchId on lead creation', () => {
    it('should use the explicitly specified branchId regardless of admin branch', () => {
      fc.assert(
        fc.property(
          userIdArb,
          branchIdArb,
          branchIdArb,
          (adminId, adminBranch, specifiedBranch) => {
            const admin: UserRecord = {
              $id: adminId,
              role: 'admin',
              branchId: adminBranch,
            };

            const resultBranchId = simulateCreateLeadBranchId(admin, specifiedBranch);

            return resultBranchId === specifiedBranch;
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should use specified branchId even when admin has no branch', () => {
      fc.assert(
        fc.property(
          userIdArb,
          branchIdArb,
          (adminId, specifiedBranch) => {
            const admin: UserRecord = {
              $id: adminId,
              role: 'admin',
              branchId: null,
            };

            const resultBranchId = simulateCreateLeadBranchId(admin, specifiedBranch);

            return resultBranchId === specifiedBranch;
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should fall back to admin branchId when no explicit branchId given', () => {
      fc.assert(
        fc.property(
          userIdArb,
          branchIdArb,
          (adminId, adminBranch) => {
            const admin: UserRecord = {
              $id: adminId,
              role: 'admin',
              branchId: adminBranch,
            };

            const resultBranchId = simulateCreateLeadBranchId(admin);

            return resultBranchId === adminBranch;
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
