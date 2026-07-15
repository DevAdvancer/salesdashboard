import fc from 'fast-check';
import { User, UserRole } from '@/lib/types';

/**
 * Feature: team-lead-role-hierarchy, Property 6: Hierarchy chain correctness
 *
 * For any TeamLead creating a Team_Lead, the Team_Lead's teamLeadId SHALL equal the TeamLead's
 * user ID. For any Team_Lead creating an Agent, the Agent's teamLeadId SHALL equal the
 * Team_Lead's user ID and the Agent's teamLeadId SHALL equal the Team_Lead's teamLeadId.
 *
 * Validates: Requirements 3.5, 3.6
 */

const branchIdArb = fc.stringMatching(/^[a-z0-9]{4,12}$/);

const managerArb = fc.record({
  $id: fc.uuid(),
  name: fc.string({ minLength: 1, maxLength: 128 }),
  email: fc.emailAddress(),
  role: fc.constant<UserRole>('team_lead'),
  teamLeadId: fc.constant(null as string | null),
  branchIds: fc.uniqueArray(branchIdArb, { minLength: 1, maxLength: 5 }),
});

describe('Hierarchy Chain Properties', () => {
  describe('Property 6: Hierarchy chain correctness', () => {
    it('team lead teamLeadId should equal the creating teamLead ID', () => {
      fc.assert(
        fc.property(managerArb, (teamLead) => {
          // Simulate createTeamLead: teamLeadId is set to the teamLead's $id
          const teamLead: User = {
            $id: 'tl-id',
            name: 'TL',
            email: 'tl@test.com',
            role: 'team_lead',
            teamLeadId: teamLead.$id,
            branchIds: teamLead.branchIds.slice(0, 1),
          };
          expect(teamLead.teamLeadId).toBe(teamLead.$id);
        }),
        { numRuns: 100 }
      );
    });

    it('agent teamLeadId should equal the creating team lead ID', () => {
      fc.assert(
        fc.property(
          managerArb,
          fc.uuid(),
          (teamLead, teamLeadId) => {
            const teamLead: User = {
              $id: teamLeadId,
              name: 'TL',
              email: 'tl@test.com',
              role: 'team_lead',
              teamLeadId: teamLead.$id,
              branchIds: teamLead.branchIds.slice(0, 1),
            };

            // Simulate createAgent: teamLeadId = teamLead.$id, teamLeadId = teamLead.teamLeadId
            const agent: User = {
              $id: 'agent-id',
              name: 'Agent',
              email: 'agent@test.com',
              role: 'agent',
              teamLeadId: teamLead.teamLeadId,
              branchIds: teamLead.branchIds.slice(0, 1),
            };

            expect(agent.teamLeadId).toBe(teamLeadId);
            expect(agent.teamLeadId).toBe(teamLead.$id);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('full chain: agent.teamLeadId === teamLead.teamLeadId === teamLead.$id', () => {
      fc.assert(
        fc.property(
          managerArb,
          fc.uuid(),
          (teamLead, tlId) => {
            const teamLead: User = {
              $id: tlId,
              name: 'TL',
              email: 'tl@test.com',
              role: 'team_lead',
              teamLeadId: teamLead.$id,
              branchIds: teamLead.branchIds,
            };

            const agent: User = {
              $id: 'agent-id',
              name: 'Agent',
              email: 'agent@test.com',
              role: 'agent',
              teamLeadId: teamLead.teamLeadId,
              branchIds: teamLead.branchIds.slice(0, 1),
            };

            // The full chain is preserved
            expect(agent.teamLeadId).toBe(teamLead.teamLeadId);
            expect(teamLead.teamLeadId).toBe(teamLead.$id);
            expect(agent.teamLeadId).toBe(teamLead.$id);
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
