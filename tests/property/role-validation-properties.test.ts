import fc from 'fast-check';
import { isValidRole, VALID_ROLES } from '@/lib/types/index';

/**
 * Feature: team-lead-role-hierarchy, Property 1: Role validation
 *
 * For any string value, the role validation function SHALL accept it if and only if
 * it is one of the valid role strings. All other strings SHALL be rejected.
 *
 * The supported roles are the seven documented in CLAUDE.md: admin, developer,
 * team_lead, agent, lead_generation, monitor and operations. The intermediate
 * 'manager' / 'assistant_manager' tiers this file was originally written against
 * no longer exist in the domain (see lib/types/index.ts).
 *
 * Validates: Requirements 1.1, 1.2
 */

const SUPPORTED_ROLES = [
  'admin',
  'developer',
  'team_lead',
  'agent',
  'lead_generation',
  'monitor',
  'operations',
  'compliance',
] as const;

describe('Role Validation Properties', () => {
  describe('Property 1: Role validation', () => {
    it('should accept exactly the valid roles', () => {
      fc.assert(
        fc.property(
          fc.constantFrom(...SUPPORTED_ROLES),
          (role) => {
            expect(isValidRole(role)).toBe(true);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should reject any string that is not a valid role', () => {
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
            fc.constantFrom('Admin', 'ADMIN', 'Developer', 'DEVELOPER', 'TeamLead', 'Team_Lead', 'TEAM_LEAD', 'Agent', 'AGENT', 'Lead_Generation', 'LEAD_GENERATION', 'Monitor', 'MONITOR', 'Operations', 'OPERATIONS'),
            // Typos and near-misses, including roles that were removed from the domain
            fc.constantFrom('admn', 'manager', 'assistant_manager', 'assistant_team_lead', 'team_leads', 'agents', 'teamlead', 'team-lead', 'operation', 'monitors'),
            // Valid role with extra whitespace or chars
            fc.constantFrom(' admin', 'admin ', 'teamLead!', '_agent')
          ),
          (nearMiss) => {
            expect(isValidRole(nearMiss)).toBe(false);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('VALID_ROLES array should contain exactly the seven supported roles', () => {
      expect(VALID_ROLES).toHaveLength(SUPPORTED_ROLES.length);
      expect(new Set(VALID_ROLES).size).toBe(SUPPORTED_ROLES.length);
      for (const role of SUPPORTED_ROLES) {
        expect(VALID_ROLES).toContain(role);
      }
      // Roles that were removed from the hierarchy must stay removed
      expect(VALID_ROLES).not.toContain('manager');
      expect(VALID_ROLES).not.toContain('assistant_manager');
    });
  });
});
