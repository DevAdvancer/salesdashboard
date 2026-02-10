import fc from 'fast-check';
import { isValidRole, VALID_ROLES } from '@/lib/types/index';

/**
 * Feature: team-lead-role-hierarchy, Property 1: Role validation
 *
 * For any string value, the role validation function SHALL accept it if and only if
 * it is one of 'admin', 'manager', 'team_lead', or 'agent'. All other strings SHALL be rejected.
 *
 * Validates: Requirements 1.1, 1.2
 */

describe('Role Validation Properties', () => {
  describe('Property 1: Role validation', () => {
    it('should accept exactly the four valid roles', () => {
      fc.assert(
        fc.property(
          fc.constantFrom('admin', 'manager', 'team_lead', 'agent'),
          (role) => {
            expect(isValidRole(role)).toBe(true);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should reject any string that is not one of the four valid roles', () => {
      fc.assert(
        fc.property(
          fc.string().filter((s) => !VALID_ROLES.includes(s as any)),
          (invalidRole) => {
            expect(isValidRole(invalidRole)).toBe(false);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should reject near-miss role strings (case variations, typos, extra chars)', () => {
      fc.assert(
        fc.property(
          fc.oneof(
            // Case variations
            fc.constantFrom('Admin', 'ADMIN', 'Manager', 'MANAGER', 'Team_Lead', 'TEAM_LEAD', 'Agent', 'AGENT'),
            // Typos and near-misses
            fc.constantFrom('admn', 'manger', 'team_leads', 'agents', 'teamlead', 'team-lead'),
            // Valid role with extra whitespace or chars
            fc.constantFrom(' admin', 'admin ', 'manager!', '_agent')
          ),
          (nearMiss) => {
            expect(isValidRole(nearMiss)).toBe(false);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('VALID_ROLES array should contain exactly four roles', () => {
      expect(VALID_ROLES).toHaveLength(4);
      expect(new Set(VALID_ROLES).size).toBe(4);
      expect(VALID_ROLES).toContain('admin');
      expect(VALID_ROLES).toContain('manager');
      expect(VALID_ROLES).toContain('team_lead');
      expect(VALID_ROLES).toContain('agent');
    });
  });
});
