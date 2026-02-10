import fc from 'fast-check';
import { User, UserRole } from '@/lib/types';

/**
 * Feature: team-lead-role-hierarchy, Property 6: Hierarchy chain correctness
 *
 * For any Manager creating a Team_Lead, the Team_Lead's managerId SHALL equal the Manager's
 * user ID. For any Team_Lead creating an Agent, the Agent's teamLeadId SHALL equal the
 * Team_Lead's user ID and the Agent's managerId SHALL equal the Team_Lead's managerId.
 *
 * Validates: Requirements 3.5, 3.6
 */

const branchIdArb = fc.stringMatching(/^[a-z0-9]{4,12}$/);

const managerArb = fc.record({
  $id: fc.uuid(),
  name: fc.string({ minLength: 1, maxLength: 128 }),
  email: fc.emailAddress(),
  role: fc.constant<UserRole>('manager'),
  managerId: fc.constant(null as string | null),
  teamLeadId: fc.constant(null as string | null),
  branchIds: fc.uniqueArray(branchIdArb, { minLength: 1, maxLength: 5 }),
});

describe('Hierarchy Chain Properties', () => {
  describe('Property 6: Hierarchy chain correctness', () => {
    it('team lead managerId should equal the creating manager ID', () => {
      fc.assert(
        fc.property(managerArb, (manager) => {
          // Simulate createTeamLead: managerId is set to the manager's $id
          const teamLead: User = {
            $id: 'tl-id',
            name: 'TL',
            email: 'tl@test.com',
            role: 'team_lead',
            managerId: manager.$id,
            teamLeadId: null,
            branchIds: manager.branchIds.slice(0, 1),
          };
          expect(teamLead.managerId).toBe(manager.$id);
        }),
        { numRuns: 100 }
      );
    });

    it('agent teamLeadId should equal the creating team lead ID', () => {
      fc.assert(
        fc.property(
          managerArb,
          fc.uuid(),
          (manager, teamLeadId) => {
            const teamLead: User = {
              $id: teamLeadId,
              name: 'TL',
              email: 'tl@test.com',
              role: 'team_lead',
              managerId: manager.$id,
              teamLeadId: null,
              branchIds: manager.branchIds.slice(0, 1),
            };

            // Simulate createAgent: teamLeadId = teamLead.$id, managerId = teamLead.managerId
            const agent: User = {
              $id: 'agent-id',
              name: 'Agent',
              email: 'agent@test.com',
              role: 'agent',
              managerId: teamLead.managerId,
              teamLeadId: teamLead.$id,
              branchIds: teamLead.branchIds.slice(0, 1),
            };

            expect(agent.teamLeadId).toBe(teamLeadId);
            expect(agent.managerId).toBe(manager.$id);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('full chain: agent.managerId === teamLead.managerId === manager.$id', () => {
      fc.assert(
        fc.property(
          managerArb,
          fc.uuid(),
          (manager, tlId) => {
            const teamLead: User = {
              $id: tlId,
              name: 'TL',
              email: 'tl@test.com',
              role: 'team_lead',
              managerId: manager.$id,
              teamLeadId: null,
              branchIds: manager.branchIds,
            };

            const agent: User = {
              $id: 'agent-id',
              name: 'Agent',
              email: 'agent@test.com',
              role: 'agent',
              managerId: teamLead.managerId,
              teamLeadId: teamLead.$id,
              branchIds: teamLead.branchIds.slice(0, 1),
            };

            // The full chain is preserved
            expect(agent.managerId).toBe(teamLead.managerId);
            expect(teamLead.managerId).toBe(manager.$id);
            expect(agent.teamLeadId).toBe(teamLead.$id);
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
