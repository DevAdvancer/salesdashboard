import type { Branch, Lead, LgHandoff, User, ClientPaymentPlan } from '@/lib/types';
import { normalizeLeadStatus } from '@/lib/utils/lead-status-workflow';

export const STALE_LEAD_DAYS = 14;

export interface LeadershipDashboardSummary {
  activeLeads: number;
  closedLeads: number;
  unassignedLeads: number;
  staleLeads: number;
  overdueFollowUps: number;
  dueTodayFollowUps: number;
  totalPipelineValue: number;
  totalUpfrontValue: number;
  fullyPaidUpfrontValue: number;
  partiallyPaidUpfrontValue: number;
  closedRevenue: number;
}

export interface DashboardRoleCounts {
  teamLeads: number;
  agents: number;
  leadGeneration: number;
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

export interface LeadGenerationTeamBreakdownItem {
  leadGenerationId: string;
  leadGenerationName: string;
  assignedLeads: number;
}

export interface TeamLeadAssignmentSummary {
  teamLeadId: string;
  teamLeadName: string;
  assignedLeads: number;
  assignmentShare: number;
  leadGenerationBreakdown: LeadGenerationTeamBreakdownItem[];
}

export interface AssignmentFairnessAlert {
  teamLeadId: string;
  teamLeadName: string;
  assignedLeads: number;
  averageLeadsPerTeam: number;
  share: number;
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

export interface DashboardLeadDetailRow {
  leadId: string;
  leadName: string;
  company: string;
  email: string;
  status: string;
  branchName: string;
  ownerName: string;
  assignedToName: string;
  amount: number;
  isClosed: boolean;
  createdAt: string | null;
  updatedAt: string | null;
  nextFollowUpAt: string | null;
}

export interface LeadershipDashboardDetails {
  activeLeads: DashboardLeadDetailRow[];
  closedLeads: DashboardLeadDetailRow[];
  unassignedLeads: DashboardLeadDetailRow[];
  staleLeads: DashboardLeadDetailRow[];
  pipelineValue: DashboardLeadDetailRow[];
  upfrontCollectedLeads: DashboardLeadDetailRow[];
  fullyPaidLeads: DashboardLeadDetailRow[];
  partiallyPaidLeads: DashboardLeadDetailRow[];
}

export interface LeadershipDashboardInsights {
  summary: LeadershipDashboardSummary;
  roleCounts: DashboardRoleCounts;
  branchSummaries: BranchDashboardSummary[];
  assigneeWorkload: AssigneeWorkloadSummary[];
  statusBreakdown: StatusBreakdownItem[];
  teamLeadAssignmentSummaries: TeamLeadAssignmentSummary[];
  assignmentFairnessAlert: AssignmentFairnessAlert | null;
  followUpQueue: FollowUpQueue;
  details: LeadershipDashboardDetails;
}

interface BuildLeadershipDashboardInsightsInput {
  leads: Lead[];
  users: User[];
  branches: Branch[];
  /**
   * Pre-fetched handoff rows from the lg_handoffs collection, one
   * document per (lead, original TL) pair. The "Lead Gen Team Handoffs"
   * dashboard count is computed from these — never from the lead's
   * current `assignedToId`, which can change after a TL reassigns the
   * lead. Optional for backwards-compat with the test suite: when
   * omitted, the handoff section renders empty.
   */
  lgHandoffs?: LgHandoff[];
  paymentSummaries?: Array<{ leadId: string; status: string; paymentPlan: ClientPaymentPlan }>;
  now?: Date;
}

interface ResolveLeadUsersForInsightsInput {
  leads: Lead[];
  users: User[];
  getUserByIdOrNull: (userId: string) => Promise<User | null>;
}

export async function resolveLeadUsersForInsights({
  leads,
  users,
  getUserByIdOrNull,
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
    Array.from(missingUserIds).map((userId) => getUserByIdOrNull(userId))
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

function getLeadCompany(lead: Lead): string {
  const leadData = parseLeadData(lead);
  return String(leadData.company ?? '').trim();
}

function getLeadEmail(lead: Lead): string {
  const leadData = parseLeadData(lead);
  return String(leadData.email ?? '').trim();
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
  lgHandoffs = [],
  paymentSummaries = [],
  now = new Date(),
}: BuildLeadershipDashboardInsightsInput): LeadershipDashboardInsights {
  const roleCounts: DashboardRoleCounts = {
    teamLeads: 0,
    agents: 0,
    leadGeneration: 0,
  };
  const branchMap = new Map(branches.map((branch) => [branch.$id, createBranchSummary(branch)]));
  const userMap = new Map(users.map((currentUser) => [currentUser.$id, currentUser]));
  const workloadMap = new Map<string, AssigneeWorkloadSummary>();
  const teamLeadAssignmentMap = new Map<string, TeamLeadAssignmentSummary>();
  const statusCounts = new Map<string, number>();
  const summary: LeadershipDashboardSummary = {
    activeLeads: 0,
    closedLeads: 0,
    unassignedLeads: 0,
    staleLeads: 0,
    overdueFollowUps: 0,
    dueTodayFollowUps: 0,
    totalPipelineValue: 0,
    totalUpfrontValue: 0,
    fullyPaidUpfrontValue: 0,
    partiallyPaidUpfrontValue: 0,
    closedRevenue: 0,
  };
  const followUpQueue: FollowUpQueue = {
    overdue: [],
    dueToday: [],
    upcoming: [],
  };
  const details: LeadershipDashboardDetails = {
    activeLeads: [],
    closedLeads: [],
    unassignedLeads: [],
    staleLeads: [],
    pipelineValue: [],
    upfrontCollectedLeads: [],
    fullyPaidLeads: [],
    partiallyPaidLeads: [],
  };

  const normalizeStatus = (value: unknown) => {
    const text = typeof value === 'string' ? value : '';
    const normalized = text.trim().toLowerCase().replace(/\s+/g, '');
    if (normalized === 'backout' || normalized === 'backedout') return 'Backed Out';
    return text || 'Unknown';
  };

  // Work-queue follow-ups skip leads that are already terminal for the
  // "needs action" flow: Not Interested and Backed Out. These leads
  // have either been re-queued into the unassigned pool (Not Interested)
  // or closed out (Backed Out), so surfacing them in the follow-up
  // queue would be noise. Active pipeline / signed-closure / contacted
  // leads continue to appear.
  const isExcludedFromFollowUpQueue = (lead: Lead) => {
    const normalized = normalizeLeadStatus(lead.status);
    return normalized === 'notinterested' || normalized === 'backedout';
  };

  const paymentMap = new Map(paymentSummaries.map((p) => [p.leadId, p]));
  for (const currentUser of users) {
    if (currentUser.role === 'team_lead') roleCounts.teamLeads += 1;
    if (currentUser.role === 'agent') roleCounts.agents += 1;
    if (currentUser.role === 'lead_generation') roleCounts.leadGeneration += 1;
    if (currentUser.role !== 'admin') {
      workloadMap.set(currentUser.$id, createWorkloadSummary(currentUser));
    }
  }

  for (const currentLead of leads) {
    const payment = paymentMap.get(currentLead.$id);
    // Use the exact amount entered on the lead. Do NOT back-calculate the
    // total deal value from the payment plan — that was producing inflated
    // numbers in the leadership dashboard. The exact amount on the payment
    // plan (upfrontAmount) is tracked separately on the Upfront Collected
    // card, where it is summed as-is from `payment.paymentPlan.upfrontAmount`.
    const amount = getLeadAmount(currentLead);
    const leadIsStale = isStaleLead(currentLead, now);
    const followUpDate = getFollowUpDate(currentLead);
    const hasPendingFollowUp = Boolean(followUpDate && !currentLead.isClosed && currentLead.followUpStatus !== 'completed');
    const followUpIsOverdue = Boolean(hasPendingFollowUp && followUpDate && followUpDate.getTime() < now.getTime() && !isSameLocalDay(followUpDate, now));
    const followUpIsDueToday = Boolean(hasPendingFollowUp && followUpDate && isSameLocalDay(followUpDate, now));
    const inFollowUpScope = hasPendingFollowUp && !isExcludedFromFollowUpQueue(currentLead);
    const followUpCountsTowardQueue = inFollowUpScope && (followUpIsOverdue || followUpIsDueToday);
    const status = normalizeStatus(currentLead.status);
    const branchId = typeof currentLead.branchId === "string" && currentLead.branchId ? currentLead.branchId : 'unassigned-branch';
    const branchSummary = branchMap.get(branchId);
    const branchName = branchSummary?.branchName ?? 'No branch';
    const owner = userMap.get(currentLead.ownerId);
    const assignee = currentLead.assignedToId ? userMap.get(currentLead.assignedToId) : null;
    // assignedTeamLead used to be looked up here so the handoff
    // block (now removed) could group the lead under its current
    // TL. With the move to lg_handoffs, neither the lookup nor the
    // agent→TL fallback chain is needed in the per-lead walk.
    const detailRow: DashboardLeadDetailRow = {
      leadId: currentLead.$id,
      leadName: getLeadName(currentLead),
      company: getLeadCompany(currentLead),
      email: getLeadEmail(currentLead),
      status,
      branchName,
      ownerName: owner?.name ?? 'Unknown owner',
      assignedToName: assignee?.name ?? 'Unassigned',
      amount,
      isClosed: currentLead.isClosed,
      createdAt: currentLead.$createdAt ?? null,
      updatedAt: currentLead.$updatedAt ?? null,
      nextFollowUpAt: currentLead.nextFollowUpAt ?? null,
    };

    statusCounts.set(status, (statusCounts.get(status) ?? 0) + 1);
    summary.totalPipelineValue += amount;

    // Handoff counting moved off the per-lead walk. We read
    // pre-fetched lg_handoffs rows instead — see the block below the
    // lead loop — so a later reassignment does not change the
    // original TL's count. The handoff row is keyed on leadId and
    // recorded at creation time (app/actions/lg-handoffs.ts).

    if (payment && (payment.status === 'partially_paid' || payment.status === 'fully_paid')) {
      summary.totalUpfrontValue += payment.paymentPlan.upfrontAmount;
      details.upfrontCollectedLeads.push(detailRow);
      if (payment.status === 'fully_paid') {
        summary.fullyPaidUpfrontValue += payment.paymentPlan.upfrontAmount;
        details.fullyPaidLeads.push(detailRow);
      } else if (payment.status === 'partially_paid') {
        summary.partiallyPaidUpfrontValue += payment.paymentPlan.upfrontAmount;
        details.partiallyPaidLeads.push(detailRow);
      }
    }

    if (amount > 0) {
      details.pipelineValue.push(detailRow);
    }

    if (currentLead.isClosed) {
      summary.closedLeads += 1;
      summary.closedRevenue += amount;
      details.closedLeads.push(detailRow);
    } else {
      summary.activeLeads += 1;
      details.activeLeads.push(detailRow);
    }

    if (!currentLead.assignedToId && !currentLead.isClosed) {
      summary.unassignedLeads += 1;
      details.unassignedLeads.push(detailRow);
    }

    if (leadIsStale) {
      summary.staleLeads += 1;
      details.staleLeads.push(detailRow);
    }

    if (followUpIsOverdue && followUpCountsTowardQueue) {
      summary.overdueFollowUps += 1;
    }

    if (followUpIsDueToday && followUpCountsTowardQueue) {
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
      if (followUpIsOverdue && followUpCountsTowardQueue) {
        branchSummary.overdueFollowUps += 1;
      }
      if (followUpIsDueToday && followUpCountsTowardQueue) {
        branchSummary.dueTodayFollowUps += 1;
      }
    }

    const workloadAssigneeId = currentLead.assignedToId ?? currentLead.ownerId;
    const workloadAssignee = userMap.get(workloadAssigneeId);
    if (workloadAssignee) {
      const workload = workloadMap.get(workloadAssignee.$id) ?? createWorkloadSummary(workloadAssignee);
      workload.totalValue += amount;
      if (currentLead.isClosed) {
        workload.closedLeads += 1;
      } else {
        workload.activeLeads += 1;
      }
      if (leadIsStale) {
        workload.staleLeads += 1;
      }
      workloadMap.set(workloadAssignee.$id, workload);
    }

    if (inFollowUpScope && followUpDate) {
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
  details.pipelineValue.sort((a, b) => b.amount - a.amount || a.leadName.localeCompare(b.leadName));
  // Build the Lead Gen Team Handoffs view from the pre-fetched
  // lg_handoffs rows. Each row is one (lead, original TL) pair, so
  // the per-TL count is exact by construction — a later reassignment
  // never produces a new row. We look up TL / LG names from the
  // already-loaded user map; rows that reference missing users are
  // skipped (their lead is not visible in this dashboard anyway).
  for (const handoff of lgHandoffs) {
    const teamLead = userMap.get(handoff.teamLeadId);
    const leadGeneration = userMap.get(handoff.leadGenerationId);
    if (!teamLead || teamLead.role !== 'team_lead') continue;
    if (!leadGeneration || leadGeneration.role !== 'lead_generation') continue;

    const teamSummary = teamLeadAssignmentMap.get(teamLead.$id) ?? {
      teamLeadId: teamLead.$id,
      teamLeadName: teamLead.name,
      assignedLeads: 0,
      assignmentShare: 0,
      leadGenerationBreakdown: [],
    };
    teamSummary.assignedLeads += 1;

    const leadGenerationEntry = teamSummary.leadGenerationBreakdown.find(
      (entry) => entry.leadGenerationId === leadGeneration.$id,
    );
    if (leadGenerationEntry) {
      leadGenerationEntry.assignedLeads += 1;
    } else {
      teamSummary.leadGenerationBreakdown.push({
        leadGenerationId: leadGeneration.$id,
        leadGenerationName: leadGeneration.name,
        assignedLeads: 1,
      });
    }
    teamLeadAssignmentMap.set(teamLead.$id, teamSummary);
  }
  const totalTeamAssignedLeads = Array.from(teamLeadAssignmentMap.values()).reduce(
    (total, team) => total + team.assignedLeads,
    0,
  );
  const teamLeadAssignmentSummaries = Array.from(teamLeadAssignmentMap.values())
    .map((team) => ({
      ...team,
      assignmentShare: totalTeamAssignedLeads > 0
        ? Math.round((team.assignedLeads / totalTeamAssignedLeads) * 100)
        : 0,
      leadGenerationBreakdown: team.leadGenerationBreakdown.sort(
        (a, b) => b.assignedLeads - a.assignedLeads || a.leadGenerationName.localeCompare(b.leadGenerationName),
      ),
    }))
    .sort((a, b) => b.assignedLeads - a.assignedLeads || a.teamLeadName.localeCompare(b.teamLeadName));
  const averageLeadsPerTeam = teamLeadAssignmentSummaries.length > 0
    ? totalTeamAssignedLeads / teamLeadAssignmentSummaries.length
    : 0;
  const assignmentFairnessAlert =
    teamLeadAssignmentSummaries.length > 1 &&
    teamLeadAssignmentSummaries[0].assignedLeads > averageLeadsPerTeam * 1.25
      ? {
        teamLeadId: teamLeadAssignmentSummaries[0].teamLeadId,
        teamLeadName: teamLeadAssignmentSummaries[0].teamLeadName,
        assignedLeads: teamLeadAssignmentSummaries[0].assignedLeads,
        averageLeadsPerTeam,
        share: teamLeadAssignmentSummaries[0].assignmentShare,
      }
      : null;

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
    teamLeadAssignmentSummaries,
    assignmentFairnessAlert,
    followUpQueue,
    details,
  };
}
