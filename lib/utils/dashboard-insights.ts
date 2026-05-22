import type { Branch, Lead, User } from '@/lib/types';

export const STALE_LEAD_DAYS = 14;

export interface LeadershipDashboardSummary {
  activeLeads: number;
  closedLeads: number;
  unassignedLeads: number;
  staleLeads: number;
  overdueFollowUps: number;
  dueTodayFollowUps: number;
  totalPipelineValue: number;
  closedRevenue: number;
}

export interface DashboardRoleCounts {
  managers: number;
  assistantManagers: number;
  teamLeads: number;
  agents: number;
}

export interface BranchDashboardSummary {
  branchId: string;
  branchName: string;
  activeLeads: number;
  closedLeads: number;
  unassignedLeads: number;
  staleLeads: number;
  overdueFollowUps: number;
  dueTodayFollowUps: number;
  totalValue: number;
  closedValue: number;
}

export interface AssigneeWorkloadSummary {
  userId: string;
  userName: string;
  role: User['role'];
  activeLeads: number;
  closedLeads: number;
  staleLeads: number;
  totalValue: number;
}

export interface StatusBreakdownItem {
  status: string;
  count: number;
}

export interface FollowUpQueueItem {
  leadId: string;
  leadName: string;
  assignedToName: string;
  ownerName: string;
  status: string;
  nextAction: string;
  nextFollowUpAt: string;
  branchName: string;
}

export interface FollowUpQueue {
  overdue: FollowUpQueueItem[];
  dueToday: FollowUpQueueItem[];
  upcoming: FollowUpQueueItem[];
}

export interface LeadershipDashboardInsights {
  summary: LeadershipDashboardSummary;
  roleCounts: DashboardRoleCounts;
  branchSummaries: BranchDashboardSummary[];
  assigneeWorkload: AssigneeWorkloadSummary[];
  statusBreakdown: StatusBreakdownItem[];
  followUpQueue: FollowUpQueue;
}

interface BuildLeadershipDashboardInsightsInput {
  leads: Lead[];
  users: User[];
  branches: Branch[];
  now?: Date;
}

interface ResolveLeadUsersForInsightsInput {
  leads: Lead[];
  users: User[];
  getUserById: (userId: string) => Promise<User>;
}

export async function resolveLeadUsersForInsights({
  leads,
  users,
  getUserById,
}: ResolveLeadUsersForInsightsInput): Promise<User[]> {
  const userMap = new Map(users.map((currentUser) => [currentUser.$id, currentUser]));
  const missingUserIds = new Set<string>();

  for (const lead of leads) {
    if (lead.ownerId && !userMap.has(lead.ownerId)) {
      missingUserIds.add(lead.ownerId);
    }

    if (lead.assignedToId && !userMap.has(lead.assignedToId)) {
      missingUserIds.add(lead.assignedToId);
    }
  }

  if (missingUserIds.size === 0) {
    return users;
  }

  const resolvedUsers = await Promise.all(
    Array.from(missingUserIds).map(async (userId) => {
      try {
        return await getUserById(userId);
      } catch (error) {
        console.warn(`Could not resolve dashboard user ${userId}`, error);
        return null;
      }
    })
  );

  for (const resolvedUser of resolvedUsers) {
    if (resolvedUser) {
      userMap.set(resolvedUser.$id, resolvedUser);
    }
  }

  return Array.from(userMap.values());
}

function parseCurrencyAmount(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value !== 'string') {
    return 0;
  }

  const normalizedValue = value.replace(/[^0-9.-]/g, '');
  if (!normalizedValue) {
    return 0;
  }

  const parsedValue = Number.parseFloat(normalizedValue);
  return Number.isFinite(parsedValue) ? parsedValue : 0;
}

function parseLeadData(lead: Lead): Record<string, unknown> {
  try {
    return JSON.parse(lead.data) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function getLeadName(lead: Lead): string {
  const leadData = parseLeadData(lead);
  const firstName = String(leadData.firstName ?? '').trim();
  const lastName = String(leadData.lastName ?? '').trim();
  const company = String(leadData.company ?? '').trim();
  const email = String(leadData.email ?? '').trim();
  const fullName = [firstName, lastName].filter(Boolean).join(' ');

  return fullName || company || email || 'Unassigned lead';
}

function getLeadAmount(lead: Lead): number {
  const leadData = parseLeadData(lead);
  return parseCurrencyAmount(leadData.amount ?? leadData.dealValue ?? 0);
}

function getUpdatedDate(lead: Lead): Date | null {
  const candidateDate = lead.$updatedAt ?? lead.$createdAt;
  if (!candidateDate) {
    return null;
  }

  const parsedDate = new Date(candidateDate);
  return Number.isNaN(parsedDate.getTime()) ? null : parsedDate;
}

function isStaleLead(lead: Lead, now: Date): boolean {
  if (lead.isClosed) {
    return false;
  }

  const updatedDate = getUpdatedDate(lead);
  if (!updatedDate) {
    return false;
  }

  const staleMs = STALE_LEAD_DAYS * 24 * 60 * 60 * 1000;
  return now.getTime() - updatedDate.getTime() >= staleMs;
}

function getFollowUpDate(lead: Lead): Date | null {
  if (!lead.nextFollowUpAt) {
    return null;
  }

  const parsedDate = new Date(lead.nextFollowUpAt);
  return Number.isNaN(parsedDate.getTime()) ? null : parsedDate;
}

function isSameLocalDay(left: Date, right: Date): boolean {
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  );
}

function createBranchSummary(branch: Branch): BranchDashboardSummary {
  return {
    branchId: branch.$id,
    branchName: branch.name,
    activeLeads: 0,
    closedLeads: 0,
    unassignedLeads: 0,
    staleLeads: 0,
    overdueFollowUps: 0,
    dueTodayFollowUps: 0,
    totalValue: 0,
    closedValue: 0,
  };
}

function createWorkloadSummary(user: User): AssigneeWorkloadSummary {
  return {
    userId: user.$id,
    userName: user.name,
    role: user.role,
    activeLeads: 0,
    closedLeads: 0,
    staleLeads: 0,
    totalValue: 0,
  };
}

export function buildLeadershipDashboardInsights({
  leads,
  users,
  branches,
  now = new Date(),
}: BuildLeadershipDashboardInsightsInput): LeadershipDashboardInsights {
  const roleCounts: DashboardRoleCounts = {
    managers: 0,
    assistantManagers: 0,
    teamLeads: 0,
    agents: 0,
  };
  const branchMap = new Map(branches.map((branch) => [branch.$id, createBranchSummary(branch)]));
  const userMap = new Map(users.map((currentUser) => [currentUser.$id, currentUser]));
  const workloadMap = new Map<string, AssigneeWorkloadSummary>();
  const statusCounts = new Map<string, number>();
  const summary: LeadershipDashboardSummary = {
    activeLeads: 0,
    closedLeads: 0,
    unassignedLeads: 0,
    staleLeads: 0,
    overdueFollowUps: 0,
    dueTodayFollowUps: 0,
    totalPipelineValue: 0,
    closedRevenue: 0,
  };
  const followUpQueue: FollowUpQueue = {
    overdue: [],
    dueToday: [],
    upcoming: [],
  };

  for (const currentUser of users) {
    if (currentUser.role === 'manager') roleCounts.managers += 1;
    if (currentUser.role === 'assistant_manager') roleCounts.assistantManagers += 1;
    if (currentUser.role === 'team_lead') roleCounts.teamLeads += 1;
    if (currentUser.role === 'agent') roleCounts.agents += 1;

    if (currentUser.role !== 'admin') {
      workloadMap.set(currentUser.$id, createWorkloadSummary(currentUser));
    }
  }

  for (const currentLead of leads) {
    const amount = getLeadAmount(currentLead);
    const leadIsStale = isStaleLead(currentLead, now);
    const followUpDate = getFollowUpDate(currentLead);
    const hasPendingFollowUp = Boolean(followUpDate && !currentLead.isClosed && currentLead.followUpStatus !== 'completed');
    const followUpIsOverdue = Boolean(hasPendingFollowUp && followUpDate && followUpDate.getTime() < now.getTime() && !isSameLocalDay(followUpDate, now));
    const followUpIsDueToday = Boolean(hasPendingFollowUp && followUpDate && isSameLocalDay(followUpDate, now));
    const status = currentLead.status || 'Unknown';
    const branchId = currentLead.branchId ?? 'unassigned-branch';
    const branchSummary = branchMap.get(branchId);
    const branchName = branchSummary?.branchName ?? 'No branch';

    statusCounts.set(status, (statusCounts.get(status) ?? 0) + 1);
    summary.totalPipelineValue += amount;

    if (currentLead.isClosed) {
      summary.closedLeads += 1;
      summary.closedRevenue += amount;
    } else {
      summary.activeLeads += 1;
    }

    if (!currentLead.assignedToId && !currentLead.isClosed) {
      summary.unassignedLeads += 1;
    }

    if (leadIsStale) {
      summary.staleLeads += 1;
    }

    if (followUpIsOverdue) {
      summary.overdueFollowUps += 1;
    }

    if (followUpIsDueToday) {
      summary.dueTodayFollowUps += 1;
    }

    if (branchSummary) {
      branchSummary.totalValue += amount;
      if (currentLead.isClosed) {
        branchSummary.closedLeads += 1;
        branchSummary.closedValue += amount;
      } else {
        branchSummary.activeLeads += 1;
      }
      if (!currentLead.assignedToId && !currentLead.isClosed) {
        branchSummary.unassignedLeads += 1;
      }
      if (leadIsStale) {
        branchSummary.staleLeads += 1;
      }
      if (followUpIsOverdue) {
        branchSummary.overdueFollowUps += 1;
      }
      if (followUpIsDueToday) {
        branchSummary.dueTodayFollowUps += 1;
      }
    }

    const assigneeId = currentLead.assignedToId ?? currentLead.ownerId;
    const assignee = userMap.get(assigneeId);
    if (assignee) {
      const workload = workloadMap.get(assignee.$id) ?? createWorkloadSummary(assignee);
      workload.totalValue += amount;
      if (currentLead.isClosed) {
        workload.closedLeads += 1;
      } else {
        workload.activeLeads += 1;
      }
      if (leadIsStale) {
        workload.staleLeads += 1;
      }
      workloadMap.set(assignee.$id, workload);
    }

    if (hasPendingFollowUp && followUpDate) {
      const assignee = currentLead.assignedToId ? userMap.get(currentLead.assignedToId) : null;
      const owner = userMap.get(currentLead.ownerId);
      const queueItem: FollowUpQueueItem = {
        leadId: currentLead.$id,
        leadName: getLeadName(currentLead),
        assignedToName: assignee?.name ?? 'Unassigned',
        ownerName: owner?.name ?? 'Unknown owner',
        status,
        nextAction: currentLead.nextAction || 'Follow up',
        nextFollowUpAt: currentLead.nextFollowUpAt || followUpDate.toISOString(),
        branchName,
      };

      if (followUpIsOverdue) {
        followUpQueue.overdue.push(queueItem);
      } else if (followUpIsDueToday) {
        followUpQueue.dueToday.push(queueItem);
      } else {
        followUpQueue.upcoming.push(queueItem);
      }
    }
  }

  followUpQueue.overdue.sort((a, b) => a.nextFollowUpAt.localeCompare(b.nextFollowUpAt));
  followUpQueue.dueToday.sort((a, b) => a.nextFollowUpAt.localeCompare(b.nextFollowUpAt));
  followUpQueue.upcoming.sort((a, b) => a.nextFollowUpAt.localeCompare(b.nextFollowUpAt));

  return {
    summary,
    roleCounts,
    branchSummaries: Array.from(branchMap.values())
      .filter((branch) => (
        branch.activeLeads > 0 ||
        branch.closedLeads > 0 ||
        branch.unassignedLeads > 0 ||
        branch.staleLeads > 0 ||
        branch.totalValue > 0
      ))
      .sort((a, b) => b.totalValue - a.totalValue || a.branchName.localeCompare(b.branchName)),
    assigneeWorkload: Array.from(workloadMap.values())
      .filter((workload) => (
        workload.activeLeads > 0 ||
        workload.closedLeads > 0 ||
        workload.staleLeads > 0 ||
        workload.totalValue > 0
      ))
      .sort((a, b) => b.activeLeads - a.activeLeads || b.totalValue - a.totalValue || a.userName.localeCompare(b.userName)),
    statusBreakdown: Array.from(statusCounts.entries())
      .map(([status, count]) => ({ status, count }))
      .sort((a, b) => a.status.localeCompare(b.status)),
    followUpQueue,
  };
}
