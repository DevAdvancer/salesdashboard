import fc from 'fast-check';
import { UserRole, Lead } from '@/lib/types';

/**
 * Feature: team-lead-role-hierarchy, Property 9: Lead visibility scoping
 *
 * For any set of leads and any querying user, listLeads SHALL return:
 * - Admin / developer / monitor / operations: every lead
 * - Team lead: leads owned by themselves or one of their agents, plus leads
 *   assigned to themselves or to any member of their team (agents and
 *   lead_generation users alike)
 * - Agent: leads assigned to them or created by them
 * - lead_generation: only leads they created
 *
 * Branch membership no longer scopes lead visibility for any role. This file
 * was written when a 'manager' tier existed and the branch-scoped fallback in
 * the model below became unreachable once that tier was removed, which left one
 * test asserting branch scoping and another asserting the opposite for the very
 * same role.
 *
 * **Validates: Requirements 5.1, 5.2, 5.3, 5.4**
 */

interface TeamRoster {
  /** Agents reporting to the querying team lead */
  agentIds: string[];
  /** lead_generation users reporting to the querying team lead */
  leadGenIds: string[];
}

interface QueryingUser {
  $id: string;
  role: UserRole;
  team?: TeamRoster;
}

const LEADERSHIP_ROLES: UserRole[] = ['admin', 'developer', 'monitor', 'operations'];

/**
 * Pure filtering logic matching listLeads role-based visibility behavior.
 * This mirrors the core filtering in lead-service.ts listLeads (and its
 * getTeamLeadLeadVisibilityScope helper) without Appwrite dependencies.
 */
function filterLeadsByVisibility(allLeads: Lead[], user: QueryingUser): Lead[] {
  if (LEADERSHIP_ROLES.includes(user.role)) {
    return allLeads;
  }
  if (user.role === 'agent') {
    return allLeads.filter((l) => l.assignedToId === user.$id || l.ownerId === user.$id);
  }
  if (user.role === 'lead_generation') {
    return allLeads.filter((l) => l.ownerId === user.$id);
  }
  if (user.role === 'team_lead') {
    const team = user.team ?? { agentIds: [], leadGenIds: [] };
    // Ownership visibility covers the team lead and their agents only.
    const ownerVisibleUserIds = [user.$id, ...team.agentIds];
    // Assignment visibility additionally covers their lead_generation members.
    const assignmentVisibleUserIds = [user.$id, ...team.agentIds, ...team.leadGenIds];
    return allLeads.filter(
      (l) =>
        ownerVisibleUserIds.includes(l.ownerId) ||
        (l.assignedToId !== null && assignmentVisibleUserIds.includes(l.assignedToId))
    );
  }
  return [];
}

// Arbitraries
const branchPool = ['branch-a', 'branch-b', 'branch-c'];
const userIdArb = fc.integer({ min: 1, max: 10000 }).map((n) => `user-${n}`);
const leadIdArb = fc.uuid();

const leadArb = (userIdPool: string[]) =>
  fc.record({
    $id: leadIdArb,
    data: fc.constant('{"name":"Test Lead"}'),
    status: fc.constantFrom('Interested', 'Not-Interested', 'Pipeline', 'Prospect', 'Signed'),
    ownerId: fc.constantFrom(...userIdPool),
    assignedToId: fc.oneof(fc.constantFrom(...userIdPool), fc.constant(null as string | null)),
    branchId: fc.oneof(fc.constantFrom(...branchPool), fc.constant(null as string | null)),
    isClosed: fc.constant(false),
    closedAt: fc.constant(null as string | null),
  }) as fc.Arbitrary<Lead>;

/**
 * A roster of a team lead, their agents, their lead_generation members and a
 * set of outsiders, together with leads spread across all of them.
 */
const scenarioArb = fc.uniqueArray(userIdArb, { minLength: 5, maxLength: 9 }).chain((pool) => {
  const teamLeadId = pool[0];
  const rest = pool.slice(1);
  const third = Math.ceil(rest.length / 3);
  const agentIds = rest.slice(0, third);
  const leadGenIds = rest.slice(third, third * 2);
  const outsiderIds = rest.slice(third * 2);

  return fc.record({
    teamLeadId: fc.constant(teamLeadId),
    agentIds: fc.constant(agentIds),
    leadGenIds: fc.constant(leadGenIds),
    outsiderIds: fc.constant(outsiderIds),
    userPool: fc.constant(pool),
    leads: fc.array(leadArb(pool), { minLength: 1, maxLength: 15 }),
  });
});

describe('Lead Visibility Scoping Properties', () => {
  describe('Property 9: Lead visibility scoping', () => {
    it('leadership roles should see all leads regardless of branch or owner', () => {
      fc.assert(
        fc.property(
          fc.constantFrom(...LEADERSHIP_ROLES),
          scenarioArb,
          (role, { leads, teamLeadId }) => {
            const viewer: QueryingUser = { $id: teamLeadId, role };

            const result = filterLeadsByVisibility(leads, viewer);
            expect(result).toHaveLength(leads.length);
            expect(result).toEqual(leads);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('team lead should see exactly the leads owned by or assigned to their team', () => {
      fc.assert(
        fc.property(scenarioArb, ({ leads, teamLeadId, agentIds, leadGenIds }) => {
          const teamLead: QueryingUser = {
            $id: teamLeadId,
            role: 'team_lead',
            team: { agentIds, leadGenIds },
          };

          const result = filterLeadsByVisibility(leads, teamLead);

          const ownerVisible = [teamLeadId, ...agentIds];
          const assignmentVisible = [teamLeadId, ...agentIds, ...leadGenIds];

          // No leakage: every returned lead touches the team
          for (const lead of result) {
            const reachable =
              ownerVisible.includes(lead.ownerId) ||
              (lead.assignedToId !== null && assignmentVisible.includes(lead.assignedToId));
            expect(reachable).toBe(true);
          }

          // Completeness: no reachable lead is missing
          const expected = leads.filter(
            (l) =>
              ownerVisible.includes(l.ownerId) ||
              (l.assignedToId !== null && assignmentVisible.includes(l.assignedToId))
          );
          expect(result).toHaveLength(expected.length);
        }),
        { numRuns: 100 }
      );
    });

    it('team lead should not see a lead owned and assigned entirely outside their team', () => {
      fc.assert(
        fc.property(
          scenarioArb.filter(({ outsiderIds }) => outsiderIds.length > 0),
          ({ teamLeadId, agentIds, leadGenIds, outsiderIds }) => {
            const foreignLead: Lead = {
              $id: 'foreign-lead',
              data: '{"name":"Foreign"}',
              status: 'Interested',
              ownerId: outsiderIds[0],
              assignedToId: outsiderIds[outsiderIds.length - 1],
              branchId: branchPool[0],
              isClosed: false,
              closedAt: null,
            };

            const teamLead: QueryingUser = {
              $id: teamLeadId,
              role: 'team_lead',
              team: { agentIds, leadGenIds },
            };

            const result = filterLeadsByVisibility([foreignLead], teamLead);
            expect(result).toHaveLength(0);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('agent should see only leads assigned to them or created by them', () => {
      fc.assert(
        fc.property(scenarioArb, ({ leads, agentIds, teamLeadId }) => {
          const agentId = agentIds[0] ?? teamLeadId;
          const agent: QueryingUser = { $id: agentId, role: 'agent' };

          const result = filterLeadsByVisibility(leads, agent);

          for (const lead of result) {
            expect(lead.assignedToId === agentId || lead.ownerId === agentId).toBe(true);
          }

          const expected = leads.filter(
            (l) => l.assignedToId === agentId || l.ownerId === agentId
          );
          expect(result).toHaveLength(expected.length);
        }),
        { numRuns: 100 }
      );
    });

    it('lead_generation should see only leads they created, never leads merely assigned to them', () => {
      fc.assert(
        fc.property(scenarioArb, ({ leads, leadGenIds, teamLeadId }) => {
          const leadGenId = leadGenIds[0] ?? teamLeadId;
          const leadGenUser: QueryingUser = { $id: leadGenId, role: 'lead_generation' };

          const result = filterLeadsByVisibility(leads, leadGenUser);

          for (const lead of result) {
            expect(lead.ownerId).toBe(leadGenId);
          }

          const expected = leads.filter((l) => l.ownerId === leadGenId);
          expect(result).toHaveLength(expected.length);
        }),
        { numRuns: 100 }
      );
    });
  });
});
