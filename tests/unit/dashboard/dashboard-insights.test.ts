import {
  buildLeadershipDashboardInsights,
  STALE_LEAD_DAYS,
} from '@/lib/utils/dashboard-insights';
import type { Branch, Lead, User } from '@/lib/types';

const now = new Date('2026-05-06T12:00:00.000Z');

function lead(overrides: Partial<Lead>): Lead {
  return {
    $id: 'lead-default',
    data: JSON.stringify({ amount: '0' }),
    status: 'Prospect',
    ownerId: 'manager-1',
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
    managerId: null,
    managerIds: [],
    assistantManagerId: null,
    assistantManagerIds: [],
    teamLeadId: null,
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
  it('summarizes role counts, branch health, workload, and stale leads', () => {
    const users = [
      user({ $id: 'manager-1', name: 'Mina Manager', role: 'manager', branchIds: ['branch-1'] }),
      user({ $id: 'am-1', name: 'Ava AM', role: 'assistant_manager', branchIds: ['branch-1'] }),
      user({ $id: 'tl-1', name: 'Tara TL', role: 'team_lead', branchIds: ['branch-1'] }),
      user({ $id: 'agent-1', name: 'Alex Agent', role: 'agent', branchIds: ['branch-1'] }),
      user({ $id: 'agent-2', name: 'Casey Agent', role: 'agent', branchIds: ['branch-2'] }),
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
      managers: 1,
      assistantManagers: 1,
      teamLeads: 1,
      agents: 2,
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
});
