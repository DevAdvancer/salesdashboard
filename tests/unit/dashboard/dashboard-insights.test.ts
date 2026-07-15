import {
  buildLeadershipDashboardInsights,
  resolveLeadUsersForInsights,
  STALE_LEAD_DAYS,
} from '@/lib/utils/dashboard-insights';
import type { Branch, Lead, LgHandoff, User } from '@/lib/types';

const now = new Date('2026-05-06T12:00:00.000Z');

function lead(overrides: Partial<Lead>): Lead {
  return {
    $id: 'lead-default',
    data: JSON.stringify({ amount: '0' }),
    status: 'Prospect',
    ownerId: 'teamLead-1',
    assignedToId: null,
    branchId: null,
    isClosed: false,
    closedAt: null,
    $createdAt: now.toISOString(),
    $updatedAt: now.toISOString(),
    ...overrides,
  };
}

function user(overrides: Partial<User>): User {
  return {
    $id: 'user-default',
    name: 'User Default',
    email: 'user@example.com',
    role: 'agent',
    teamLeadId: null,
    teamLeadIds: [],
    assistantManagerId: null,
    assistantManagerIds: [],
    branchIds: [],
    branchId: null,
    ...overrides,
  };
}

const branches: Branch[] = [
  { $id: 'branch-1', name: 'New York', isActive: true },
  { $id: 'branch-2', name: 'Dallas', isActive: true },
];

describe('buildLeadershipDashboardInsights', () => {
  it('supplements users with missing lead owners and assignees before building follow-up names', async () => {
    const baseUsers = [
      user({ $id: 'teamLead-1', name: 'Mina TeamLead', role: 'team_lead', branchIds: ['branch-1'] }),
    ];
    const referencedUsers = new Map([
      ['teamLead-2', user({ $id: 'teamLead-2', name: 'Morgan Owner', role: 'team_lead', branchIds: ['branch-1'] })],
      ['agent-2', user({ $id: 'agent-2', name: 'Casey Assignee', role: 'agent', branchIds: ['branch-1'] })],
    ]);
    const fetchedIds: string[] = [];

    const usersForInsights = await resolveLeadUsersForInsights({
      leads: [
        lead({
          $id: 'lead-with-missing-users',
          ownerId: 'teamLead-2',
          assignedToId: 'agent-2',
          branchId: 'branch-1',
          nextFollowUpAt: '2026-05-06T18:00:00.000Z',
        }),
      ],
      users: baseUsers,
      getUserByIdOrNull: async (userId) => {
        fetchedIds.push(userId);
        const foundUser = referencedUsers.get(userId);
        return foundUser ?? null;
      },
    });

    expect(fetchedIds.sort()).toEqual(['agent-2', 'teamLead-2']);

    const insights = buildLeadershipDashboardInsights({
      leads: [
        lead({
          $id: 'lead-with-missing-users',
          ownerId: 'teamLead-2',
          assignedToId: 'agent-2',
          branchId: 'branch-1',
          nextFollowUpAt: '2026-05-06T18:00:00.000Z',
        }),
      ],
      users: usersForInsights,
      branches,
      now,
    });

    expect(insights.followUpQueue.dueToday[0]).toMatchObject({
      assignedToName: 'Casey Assignee',
      ownerName: 'Morgan Owner',
    });
  });

  it('summarizes role counts, branch health, workload, and stale leads', () => {
    const users = [
      user({ $id: 'tl-1', name: 'Tara TL', role: 'team_lead', branchIds: ['branch-1'] }),
      user({ $id: 'agent-1', name: 'Alex Agent', role: 'agent', branchIds: ['branch-1'] }),
      user({ $id: 'agent-2', name: 'Casey Agent', role: 'agent', branchIds: ['branch-2'] }),
      user({ $id: 'lg-1', name: 'Lane LG', role: 'lead_generation', branchIds: ['branch-2'] }),
    ];

    const leads = [
      lead({
        $id: 'lead-1',
        data: JSON.stringify({ amount: '$2,000', firstName: 'Old' }),
        assignedToId: 'agent-1',
        branchId: 'branch-1',
        status: 'Pipeline',
        isClosed: false,
        $updatedAt: '2026-04-20T12:00:00.000Z',
        nextFollowUpAt: '2026-05-05T14:00:00.000Z',
        nextAction: 'Call',
      }),
      lead({
        $id: 'lead-2',
        data: JSON.stringify({ dealValue: '3000' }),
        assignedToId: null,
        branchId: 'branch-1',
        status: 'Prospect',
        isClosed: false,
        $updatedAt: '2026-05-05T12:00:00.000Z',
        nextFollowUpAt: '2026-05-06T18:00:00.000Z',
        nextAction: 'Email',
      }),
      lead({
        $id: 'lead-3',
        data: JSON.stringify({ amount: 5000 }),
        assignedToId: 'agent-1',
        branchId: 'branch-1',
        status: 'Signed',
        isClosed: true,
        closedAt: '2026-05-01T12:00:00.000Z',
      }),
      lead({
        $id: 'lead-4',
        data: JSON.stringify({ amount: '$1,000' }),
        assignedToId: 'agent-2',
        branchId: 'branch-2',
        status: 'Interested',
        isClosed: false,
      }),
    ];

    const insights = buildLeadershipDashboardInsights({
      leads,
      users,
      branches,
      now,
    });

    expect(STALE_LEAD_DAYS).toBe(14);
    expect(insights.roleCounts).toEqual({
      teamLeads: 1,
      agents: 2,
      leadGeneration: 1,
    });
    expect(insights.summary).toMatchObject({
      activeLeads: 3,
      closedLeads: 1,
      unassignedLeads: 1,
      staleLeads: 1,
      overdueFollowUps: 1,
      dueTodayFollowUps: 1,
      totalPipelineValue: 11000,
      closedRevenue: 5000,
    });
    expect(insights.followUpQueue.overdue[0]).toMatchObject({
      leadId: 'lead-1',
      leadName: 'Old',
      assignedToName: 'Alex Agent',
      nextAction: 'Call',
    });
    expect(insights.followUpQueue.dueToday[0]).toMatchObject({
      leadId: 'lead-2',
      leadName: 'Unassigned lead',
      nextAction: 'Email',
    });
    expect(insights.branchSummaries).toEqual([
      expect.objectContaining({
        branchId: 'branch-1',
        branchName: 'New York',
        activeLeads: 2,
        closedLeads: 1,
        unassignedLeads: 1,
        staleLeads: 1,
        overdueFollowUps: 1,
        dueTodayFollowUps: 1,
        totalValue: 10000,
        closedValue: 5000,
      }),
      expect.objectContaining({
        branchId: 'branch-2',
        branchName: 'Dallas',
        activeLeads: 1,
        closedLeads: 0,
        unassignedLeads: 0,
        staleLeads: 0,
        totalValue: 1000,
        closedValue: 0,
      }),
    ]);
    expect(insights.assigneeWorkload[0]).toMatchObject({
      userId: 'agent-1',
      userName: 'Alex Agent',
      activeLeads: 1,
      closedLeads: 1,
      staleLeads: 1,
      totalValue: 7000,
    });
    expect(insights.statusBreakdown).toEqual([
      { status: 'Interested', count: 1 },
      { status: 'Pipeline', count: 1 },
      { status: 'Prospect', count: 1 },
      { status: 'Signed', count: 1 },
    ]);
  });

  it('builds lead detail rows for admin dashboard drill-downs', () => {
    const users = [
      user({ $id: 'admin-1', name: 'Ari Admin', role: 'admin' }),
      user({ $id: 'tl-1', name: 'Tara TL', role: 'team_lead', branchIds: ['branch-1'] }),
      user({ $id: 'agent-1', name: 'Alex Agent', role: 'agent', branchIds: ['branch-1'] }),
    ];

    const leads = [
      lead({
        $id: 'lead-active',
        data: JSON.stringify({
          amount: '$2,500',
          firstName: 'Nina',
          lastName: 'North',
          company: 'Northstar',
          email: 'nina@example.com',
        }),
        ownerId: 'tl-1',
        assignedToId: 'agent-1',
        branchId: 'branch-1',
        status: 'Pipeline',
        isClosed: false,
        $updatedAt: '2026-04-20T12:00:00.000Z',
      }),
      lead({
        $id: 'lead-unassigned',
        data: JSON.stringify({ dealValue: '1500', company: 'Open Co' }),
        ownerId: 'tl-1',
        assignedToId: null,
        branchId: 'branch-2',
        status: 'Prospect',
        isClosed: false,
      }),
      lead({
        $id: 'lead-client',
        data: JSON.stringify({ amount: 5000, firstName: 'Cora', lastName: 'Client' }),
        ownerId: 'admin-1',
        assignedToId: 'agent-1',
        branchId: 'branch-1',
        status: 'Signed',
        isClosed: true,
        closedAt: '2026-05-01T12:00:00.000Z',
      }),
    ];

    const insights = buildLeadershipDashboardInsights({
      leads,
      users,
      branches,
      now,
    });

    expect(insights.details.activeLeads.map((item) => item.leadId)).toEqual([
      'lead-active',
      'lead-unassigned',
    ]);
    expect(insights.details.closedLeads.map((item) => item.leadId)).toEqual([
      'lead-client',
    ]);
    expect(insights.details.unassignedLeads.map((item) => item.leadId)).toEqual([
      'lead-unassigned',
    ]);
    expect(insights.details.staleLeads.map((item) => item.leadId)).toEqual([
      'lead-active',
    ]);
    expect(insights.details.pipelineValue[0]).toMatchObject({
      leadId: 'lead-client',
      leadName: 'Cora Client',
      branchName: 'New York',
      ownerName: 'Ari Admin',
      assignedToName: 'Alex Agent',
      status: 'Signed',
      amount: 5000,
      isClosed: true,
    });
  });

  it('summarizes lead generation handoffs by team and flags uneven sharing', () => {
    const users = [
      user({ $id: 'lg-1', name: 'Lane LG', role: 'lead_generation', branchIds: ['branch-1'] }),
      user({ $id: 'lg-2', name: 'Lina LG', role: 'lead_generation', branchIds: ['branch-1'] }),
      user({ $id: 'tl-1', name: 'Tara TL', role: 'team_lead', branchIds: ['branch-1'] }),
      user({ $id: 'tl-2', name: 'Theo TL', role: 'team_lead', branchIds: ['branch-1'] }),
      user({ $id: 'agent-1', name: 'Alex Agent', role: 'agent', teamLeadId: 'tl-1', branchIds: ['branch-1'] }),
    ];

    // Handoffs are now read from lg_handoffs, not derived from the
    // lead's current assignedToId. Each row records the original TL
    // who first received the lead and is never updated on a later
    // reassignment. lead-3 below was assigned directly to an agent
    // (not a TL) so it has no handoff row, and lead-4 is a single
    // handoff from lg-2 to tl-2.
    const lgHandoffs: LgHandoff[] = [
      { $id: 'lead-1', leadId: 'lead-1', teamLeadId: 'tl-1', leadGenerationId: 'lg-1', handedOffAt: now.toISOString(), branchId: 'branch-1' },
      { $id: 'lead-2', leadId: 'lead-2', teamLeadId: 'tl-1', leadGenerationId: 'lg-1', handedOffAt: now.toISOString(), branchId: 'branch-1' },
      { $id: 'lead-3', leadId: 'lead-3', teamLeadId: 'tl-1', leadGenerationId: 'lg-2', handedOffAt: now.toISOString(), branchId: 'branch-1' },
      { $id: 'lead-4', leadId: 'lead-4', teamLeadId: 'tl-2', leadGenerationId: 'lg-2', handedOffAt: now.toISOString(), branchId: 'branch-1' },
    ];

    const insights = buildLeadershipDashboardInsights({
      leads: [],
      users,
      branches,
      lgHandoffs,
      now,
    });

    expect(insights.teamLeadAssignmentSummaries).toEqual([
      expect.objectContaining({
        teamLeadId: 'tl-1',
        teamLeadName: 'Tara TL',
        assignedLeads: 3,
        assignmentShare: 75,
        leadGenerationBreakdown: [
          { leadGenerationId: 'lg-1', leadGenerationName: 'Lane LG', assignedLeads: 2 },
          { leadGenerationId: 'lg-2', leadGenerationName: 'Lina LG', assignedLeads: 1 },
        ],
      }),
      expect.objectContaining({
        teamLeadId: 'tl-2',
        teamLeadName: 'Theo TL',
        assignedLeads: 1,
        assignmentShare: 25,
      }),
    ]);
    expect(insights.assignmentFairnessAlert).toMatchObject({
      teamLeadId: 'tl-1',
      teamLeadName: 'Tara TL',
      assignedLeads: 3,
      averageLeadsPerTeam: 2,
      share: 75,
    });
  });

  it('keeps the original TL\'s handoff count stable across reassignments', () => {
    // After my change, a reassignment never produces a new handoff
    // row. lead-1 was originally handed to tl-1; the lead was later
    // reassigned to tl-2 but the handoff row still points to tl-1.
    // The dashboard must reflect that.
    const users = [
      user({ $id: 'lg-1', name: 'Lane LG', role: 'lead_generation', branchIds: ['branch-1'] }),
      user({ $id: 'tl-1', name: 'Tara TL', role: 'team_lead', branchIds: ['branch-1'] }),
      user({ $id: 'tl-2', name: 'Theo TL', role: 'team_lead', branchIds: ['branch-1'] }),
    ];
    const leads = [
      // Currently assigned to tl-2 (reassigned) but originally
      // handed to tl-1.
      lead({ $id: 'lead-1', ownerId: 'lg-1', assignedToId: 'tl-2', branchId: 'branch-1' }),
    ];
    const lgHandoffs: LgHandoff[] = [
      { $id: 'lead-1', leadId: 'lead-1', teamLeadId: 'tl-1', leadGenerationId: 'lg-1', handedOffAt: now.toISOString(), branchId: 'branch-1' },
    ];

    const insights = buildLeadershipDashboardInsights({
      leads,
      users,
      branches,
      lgHandoffs,
      now,
    });

    const tl1 = insights.teamLeadAssignmentSummaries.find((s) => s.teamLeadId === 'tl-1');
    const tl2 = insights.teamLeadAssignmentSummaries.find((s) => s.teamLeadId === 'tl-2');
    expect(tl1?.assignedLeads).toBe(1);
    expect(tl2).toBeUndefined();
  });

  it('surfaces pending follow-ups for every status except Not Interested and Backed Out', () => {
    // Work queue follow-ups should show ALL pending follow-ups EXCEPT for
    // leads that are already terminal for the "needs action" flow
    // (Not Interested / Backed Out). Every other status — New, Contacted,
    // Interested, Pipeline / Follow up, Signed/Closure, etc. — must
    // continue to surface per team.
    const users = [
      user({ $id: 'tl-1', name: 'Tara TL', role: 'team_lead', branchIds: ['branch-1'] }),
      user({ $id: 'tl-2', name: 'Theo TL', role: 'team_lead', branchIds: ['branch-1'] }),
      user({ $id: 'a-1', name: 'Alex Agent', role: 'agent', teamLeadId: 'tl-1', branchIds: ['branch-1'] }),
      user({ $id: 'a-2', name: 'Avery Agent', role: 'agent', teamLeadId: 'tl-2', branchIds: ['branch-1'] }),
    ];

    const followUpToday = '2026-05-06T18:00:00.000Z'; // due today vs `now`
    const followUpUpcoming = '2026-05-09T18:00:00.000Z'; // upcoming

    const leads = [
      // team 1: every non-excluded status should appear
      lead({ $id: 't1-new', ownerId: 'a-1', branchId: 'branch-1', status: 'New', nextFollowUpAt: followUpToday }),
      lead({ $id: 't1-contacted', ownerId: 'a-1', branchId: 'branch-1', status: 'Contacted', nextFollowUpAt: followUpToday }),
      lead({ $id: 't1-interested', ownerId: 'a-1', branchId: 'branch-1', status: 'Interested', nextFollowUpAt: followUpToday }),
      lead({ $id: 't1-pipeline', ownerId: 'a-1', branchId: 'branch-1', status: 'Pipeline / Follow up', nextFollowUpAt: followUpToday }),
      lead({ $id: 't1-signed', ownerId: 'a-1', branchId: 'branch-1', status: 'Signed/Closure', nextFollowUpAt: followUpToday }),
      lead({ $id: 't1-pipeline-variant', ownerId: 'a-1', branchId: 'branch-1', status: 'Pipeline', nextFollowUpAt: followUpToday }),
      // team 2: same coverage
      lead({ $id: 't2-new', ownerId: 'a-2', branchId: 'branch-1', status: 'New', nextFollowUpAt: followUpToday }),
      lead({ $id: 't2-pipeline', ownerId: 'a-2', branchId: 'branch-1', status: 'Pipeline / Follow up', nextFollowUpAt: followUpToday }),
      // excluded: must NOT appear in the follow-up queue
      lead({ $id: 't1-not-interested', ownerId: 'a-1', branchId: 'branch-1', status: 'Not Interested', nextFollowUpAt: followUpToday }),
      lead({ $id: 't1-not-interested-variant', ownerId: 'a-1', branchId: 'branch-1', status: 'Not-Interested', nextFollowUpAt: followUpToday }),
      lead({ $id: 't2-backed-out', ownerId: 'a-2', branchId: 'branch-1', status: 'Backed Out', nextFollowUpAt: followUpToday }),
      lead({ $id: 't1-backed-out-variant', ownerId: 'a-1', branchId: 'branch-1', status: 'Backedout', nextFollowUpAt: followUpToday }),
      // upcoming
      lead({ $id: 't1-pipeline-upcoming', ownerId: 'a-1', branchId: 'branch-1', status: 'Pipeline / Follow up', nextFollowUpAt: followUpUpcoming }),
    ];

    const insights = buildLeadershipDashboardInsights({
      leads,
      users,
      branches,
      now,
    });

    const allQueueIds = [
      ...insights.followUpQueue.overdue.map((i) => i.leadId),
      ...insights.followUpQueue.dueToday.map((i) => i.leadId),
      ...insights.followUpQueue.upcoming.map((i) => i.leadId),
    ];

    // Every non-excluded lead with a pending follow-up must appear.
    expect(allQueueIds).toEqual(
      expect.arrayContaining([
        't1-new',
        't1-contacted',
        't1-interested',
        't1-pipeline',
        't1-signed',
        't1-pipeline-variant',
        't2-new',
        't2-pipeline',
        't1-pipeline-upcoming',
      ]),
    );

    // Excluded statuses must NOT appear in the follow-up queue.
    expect(allQueueIds).not.toContain('t1-not-interested');
    expect(allQueueIds).not.toContain('t1-not-interested-variant');
    expect(allQueueIds).not.toContain('t2-backed-out');
    expect(allQueueIds).not.toContain('t1-backed-out-variant');

    // Overdue / due-today counts must also exclude the terminal statuses.
    expect(insights.summary.overdueFollowUps).toBe(0);
    expect(insights.summary.dueTodayFollowUps).toBe(
      ['t1-new', 't1-contacted', 't1-interested', 't1-pipeline', 't1-signed', 't1-pipeline-variant', 't2-new', 't2-pipeline'].length,
    );

    // Per-team branchSummary counts reflect the same scope.
    const branch = insights.branchSummaries.find((b) => b.branchId === 'branch-1');
    expect(branch?.dueTodayFollowUps).toBe(insights.summary.dueTodayFollowUps);
    expect(branch?.overdueFollowUps).toBe(0);

    // Other insights (workload, statusBreakdown, branch summaries, summary
    // activeLeads, etc.) must STILL include the excluded leads so other
    // pages that consume them aren't shorted.
    expect(insights.summary.activeLeads).toBe(leads.length);
    // statusBreakdown normalizes "Backed Out" / "Backedout" to the
    // canonical "Backed Out" (count 2). "Not Interested" / "Not-Interested"
    // remain distinct because the local normalizeStatus only unifies the
    // backed-out variants.
    expect(insights.statusBreakdown).toEqual(
      expect.arrayContaining([
        { status: 'Not Interested', count: 1 },
        { status: 'Not-Interested', count: 1 },
        { status: 'Backed Out', count: 2 },
      ]),
    );
  });
});
