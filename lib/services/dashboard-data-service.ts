"use client";

import { getAssessmentAttempts } from "@/app/actions/assessment";
import {
  listAllPaymentInsightsAction,
  listClientPaymentSummariesAction,
  listLeadPaidAmountsAction,
  type PaymentInsightRecord,
} from "@/app/actions/client-payments";
import { getInterviewAttempts } from "@/app/actions/interview";
import { listLgHandoffsAction } from "@/app/actions/lg-handoffs";
import { getMockAttempts } from "@/app/actions/mock";
import { listLeads } from "@/lib/services/lead-action-service";
import { listBranches } from "@/lib/services/branch-service";
import {
  getAgentsByTeamLead,
  getAssignableUsers,
  getUserByIdOrNull,
} from "@/lib/services/user-service";
import {
  buildLeadershipDashboardInsights,
  resolveLeadUsersForInsights,
  type LeadershipDashboardInsights,
} from "@/lib/utils/dashboard-insights";
import { buildLeadTargetProgress, type DateRange, type KpiRow } from "@/lib/utils/dashboard-kpi";
import {
  splitLeadsByReferral,
  type ReferralSplit,
} from "@/lib/utils/dashboard-referral";
import { cacheClientRead, clearClientReadCache } from "@/lib/utils/client-read-cache";
import type { Branch, Department, Lead, User } from "@/lib/types";

const DASHBOARD_DATA_SCOPE = "dashboard:data";
const DASHBOARD_DATA_TTL_MS = 60 * 1000;
const DASHBOARD_TOP_METRICS_SCOPE = "dashboard:topMetrics";
const DASHBOARD_LEAD_TARGET_SCOPE = "dashboard:leadTarget";
const DASHBOARD_REFERRAL_SCOPE = "dashboard:referral";

export type AssignedDashboardAgent = User & {
  branchNames: string;
};

export interface DashboardDataInput {
  user: User;
  isAdminLike: boolean;
  isTeamLead: boolean;
  teamLeadId?: string;
  includeAllBranchesForAdminLike?: boolean;
  includeAssignedAgents?: boolean;
  departmentScope?: Department | 'all';
}

export interface DashboardDataResult {
  activeLeads: Lead[];
  closedLeads: Lead[];
  visibleLeadIds: string[];
  insights: LeadershipDashboardInsights;
  assignedAgents: AssignedDashboardAgent[];
}

export interface DashboardAttemptCounts {
  createdMocks: number;
  createdInterviewSupport: number;
  createdAssessmentSupport: number;
}

function makeBranchNameMap(branches: Branch[]) {
  return new Map(branches.map((branch) => [branch.$id, branch.name] as const));
}

function mapAgentsWithBranches(
  agents: User[],
  branchNameById: Map<string, string>,
): AssignedDashboardAgent[] {
  return agents.map((agent) => {
    if (!agent.branchIds || agent.branchIds.length === 0) {
      return { ...agent, branchNames: "N/A" };
    }

    const names = agent.branchIds
      .map((branchId) => branchNameById.get(branchId))
      .filter((branchName): branchName is string => Boolean(branchName));

    return {
      ...agent,
      branchNames: names.length > 0 ? names.join(", ") : "Unknown",
    };
  });
}

export function clearDashboardDataCache(): void {
  clearClientReadCache(DASHBOARD_DATA_SCOPE);
}

export async function loadDashboardData(
  input: DashboardDataInput,
): Promise<DashboardDataResult> {
  const branchIds = input.user.branchIds ?? [];
  const normalizedBranchIds = [...branchIds].sort();
  const normalizedTeamLeadId = input.teamLeadId ?? null;

  return cacheClientRead(
    DASHBOARD_DATA_SCOPE,
    [
      input.user.$id,
      input.user.role,
      normalizedBranchIds,
      input.isAdminLike,
      input.isTeamLead,
      normalizedTeamLeadId,
      Boolean(input.includeAllBranchesForAdminLike),
      Boolean(input.includeAssignedAgents),
      input.departmentScope ?? 'all',
    ],
    async () => {
      const [activeLeads, closedLeads, allBranches, lgHandoffs] = await Promise.all([
        listLeads({ isClosed: false, teamLeadId: input.teamLeadId }, input.user.$id, input.user.role, branchIds),
        listLeads({ isClosed: true, teamLeadId: input.teamLeadId }, input.user.$id, input.user.role, branchIds),
        listBranches(),
        cacheClientRead(
          `${DASHBOARD_DATA_SCOPE}:handoffs`,
          [input.user.$id],
          () => listLgHandoffsAction(),
          DASHBOARD_DATA_TTL_MS,
        ).catch((error) => {
          console.error("Error loading LG handoffs:", error);
          return [];
        }),
      ]);

      const combinedLeads = [...activeLeads, ...closedLeads];
      const visibleLeadIds = Array.from(new Set(combinedLeads.map((lead) => lead.$id)));
      const branchNameById = makeBranchNameMap(allBranches);
      let usersForInsights: User[] = [input.user];
      let assignedAgents: AssignedDashboardAgent[] = [];

      if (input.isAdminLike && input.teamLeadId) {
        const selectedTeamLead = await getUserByIdOrNull(input.teamLeadId);
        if (selectedTeamLead) {
          const teamAgents = await getAgentsByTeamLead(
            selectedTeamLead.$id,
            input.departmentScope,
          );
          usersForInsights = [selectedTeamLead, ...teamAgents];
          if (input.includeAssignedAgents) {
            assignedAgents = mapAgentsWithBranches(teamAgents, branchNameById);
          }
        } else {
          usersForInsights = [];
        }
      } else if (input.isAdminLike) {
        const visibleUsers = await getAssignableUsers(
          input.user.role,
          branchIds,
          input.user.$id,
          input.departmentScope,
        );
        usersForInsights = [
          input.user,
          ...visibleUsers.filter((visibleUser) => visibleUser.$id !== input.user.$id),
        ];
      } else if (input.isTeamLead) {
        const teamAgents = await getAgentsByTeamLead(
          input.user.$id,
          input.departmentScope,
        );
        usersForInsights = [input.user, ...teamAgents];
        if (input.includeAssignedAgents) {
          assignedAgents = mapAgentsWithBranches(teamAgents, branchNameById);
        }
      }

      usersForInsights = await resolveLeadUsersForInsights({
        leads: combinedLeads,
        users: usersForInsights,
        getUserByIdOrNull,
      });

      const branchIdsInScope = new Set([
        ...usersForInsights.flatMap((visibleUser) => visibleUser.branchIds || []),
        ...combinedLeads.flatMap((lead) => (lead.branchId ? [lead.branchId] : [])),
      ]);
      const branches = allBranches.filter((branch) =>
        input.includeAllBranchesForAdminLike && input.isAdminLike
          ? true
          : branchIdsInScope.has(branch.$id),
      );
      const paymentSummaries =
        visibleLeadIds.length > 0
          ? await cacheClientRead(
              `${DASHBOARD_DATA_SCOPE}:paymentSummaries`,
              [input.user.$id, [...visibleLeadIds].sort()],
              () =>
                listClientPaymentSummariesAction({
                  actorId: input.user.$id,
                  leadIds: visibleLeadIds,
                }),
              DASHBOARD_DATA_TTL_MS,
            )
          : [];

      return {
        activeLeads,
        closedLeads,
        visibleLeadIds,
        assignedAgents,
        insights: buildLeadershipDashboardInsights({
          leads: combinedLeads,
          users: usersForInsights,
          branches,
          lgHandoffs,
          paymentSummaries,
        }),
      };
    },
    DASHBOARD_DATA_TTL_MS,
  );
}

export async function loadDashboardAttemptCounts(
  userId: string,
  leadIds: string[],
): Promise<DashboardAttemptCounts> {
  if (leadIds.length === 0) {
    return {
      createdMocks: 0,
      createdInterviewSupport: 0,
      createdAssessmentSupport: 0,
    };
  }

  return cacheClientRead(
    `${DASHBOARD_DATA_SCOPE}:attemptCounts`,
    [userId, [...leadIds].sort()],
    async () => {
      const [mockAttempts, interviewAttempts, assessmentAttempts] = await Promise.all([
        getMockAttempts(userId, leadIds),
        getInterviewAttempts(userId, leadIds),
        getAssessmentAttempts(userId, leadIds),
      ]);

      const countCreatedRequests = (
        attempts: { attemptCount?: number | string }[],
      ) =>
        attempts.reduce((total, attempt) => {
          const count =
            typeof attempt.attemptCount === "number"
              ? attempt.attemptCount
              : Number.parseInt(String(attempt.attemptCount ?? 0), 10);

          return total + (Number.isFinite(count) ? count : 0);
        }, 0);

      return {
        createdMocks: countCreatedRequests(mockAttempts),
        createdInterviewSupport: countCreatedRequests(interviewAttempts),
        createdAssessmentSupport: countCreatedRequests(assessmentAttempts),
      };
    },
    DASHBOARD_DATA_TTL_MS,
  );
}

export async function loadDashboardPaymentInsights(
  actorId: string,
): Promise<PaymentInsightRecord[]> {
  return cacheClientRead(
    `${DASHBOARD_DATA_SCOPE}:paymentInsights`,
    [actorId],
    () => listAllPaymentInsightsAction(actorId),
    DASHBOARD_DATA_TTL_MS,
  );
}

// ----------------------------------------------------------------------------
// New dashboard sections (top row + KPI + referral split). These replace the
// monolithic `loadDashboardData` for the new dashboard page, but the legacy
// function is kept because `app/work-queue/page.tsx` still depends on it.
// ----------------------------------------------------------------------------

export interface TopMetrics {
  activeLeads: number;
  closedLeads: number;
  createdMocks: number;
  createdInterviewSupport: number;
  createdAssessmentSupport: number;
}

export interface TopMetricsInput {
  userId: string;
  role: User["role"];
  branchIds?: string[];
  dateRange: DateRange;
}

const EMPTY_TOP_METRICS: TopMetrics = {
  activeLeads: 0,
  closedLeads: 0,
  createdMocks: 0,
  createdInterviewSupport: 0,
  createdAssessmentSupport: 0,
};

/**
 * Top-row metrics (Active / Clients / Mocks / Interview / Assessment).
 * All five respect the date range — leads created inside the window and
 * attempts against those leads. Falls back to today when no range is set.
 */
export async function loadDashboardTopMetrics(
  input: TopMetricsInput,
): Promise<TopMetrics> {
  const dateFrom = input.dateRange.from;
  const dateTo = input.dateRange.to;
  if (!dateFrom && !dateTo) {
    return EMPTY_TOP_METRICS;
  }

  const branchIds = [...(input.branchIds ?? [])].sort();

  return cacheClientRead(
    DASHBOARD_TOP_METRICS_SCOPE,
    [input.userId, input.role, branchIds, dateFrom ?? "", dateTo ?? ""],
    async () => {
      // 1. Active + closed counts in the range.
      const [active, closed] = await Promise.all([
        listLeads(
          { isClosed: false, dateFrom, dateTo },
          input.userId,
          input.role,
          input.branchIds,
        ),
        listLeads(
          { isClosed: true, dateFrom, dateTo },
          input.userId,
          input.role,
          input.branchIds,
        ),
      ]);

      // 2. Attempt counts against the visible lead IDs.
      const visibleLeadIds = Array.from(
        new Set([...active, ...closed].map((lead) => lead.$id)),
      );
      const attempts = visibleLeadIds.length
        ? await loadDashboardAttemptCounts(input.userId, visibleLeadIds)
        : EMPTY_TOP_METRICS;

      return {
        activeLeads: active.length,
        closedLeads: closed.length,
        createdMocks: attempts.createdMocks,
        createdInterviewSupport: attempts.createdInterviewSupport,
        createdAssessmentSupport: attempts.createdAssessmentSupport,
      };
    },
    DASHBOARD_DATA_TTL_MS,
  );
}

export interface LeadTargetInput {
  userId: string;
  role: User["role"];
  teamLeadId?: string;
  branchIds?: string[];
  dateRange: DateRange;
}

/**
 * Returns per-user lead count progress for the KPI section.
 * - Admin-like (no teamLeadId): every active user.
 * - Admin-like with teamLeadId: just that TL + their agents.
 * - Team lead: self + their agents.
 * - Agent: self only.
 * - Lead generation: self only.
 */
export async function loadLeadTargetProgress(
  input: LeadTargetInput,
): Promise<KpiRow[]> {
  const branchIds = [...(input.branchIds ?? [])].sort();

  return cacheClientRead(
    DASHBOARD_LEAD_TARGET_SCOPE,
    [
      input.userId,
      input.role,
      input.teamLeadId ?? null,
      branchIds,
      input.dateRange.from ?? "",
      input.dateRange.to ?? "",
    ],
    async () => {
      // The lead-target KPI counts all leads created in the date range
      // regardless of closed status — a closed lead still reflects work
      // done, so query both states and merge.
      const [activeLeads, closedLeads] = await Promise.all([
        listLeads(
          { dateFrom: input.dateRange.from, dateTo: input.dateRange.to, isClosed: false },
          input.userId,
          input.role,
          input.branchIds,
        ),
        listLeads(
          { dateFrom: input.dateRange.from, dateTo: input.dateRange.to, isClosed: true },
          input.userId,
          input.role,
          input.branchIds,
        ),
      ]);
      const leads = [...activeLeads, ...closedLeads];

      const users = await resolveScopeUsers({
        userId: input.userId,
        role: input.role,
        teamLeadId: input.teamLeadId,
        branchIds: input.branchIds,
      });

      return buildLeadTargetProgress({ leads, users, range: input.dateRange });
    },
    DASHBOARD_DATA_TTL_MS,
  );
}

async function resolveScopeUsers(input: {
  userId: string;
  role: User["role"];
  teamLeadId?: string;
  branchIds?: string[];
}): Promise<User[]> {
  const { userId, role, teamLeadId, branchIds } = input;

  // KPI scope: active sales-dept agents AND team leads appear in the
  // dashboard lead-target. Other roles (admin, developer, monitor,
  // operations, lead_generation, resume-dept) are excluded — they have
  // different workflows and shouldn't be measured against the lead
  // target.
  const isKpiEligible = (user: User | null | undefined): user is User =>
    Boolean(
      user &&
      user.isActive !== false &&
      user.department === "sales" &&
      (user.role === "agent" || user.role === "team_lead"),
    );

  if (role === "agent" || role === "lead_generation") {
    const self = await getUserByIdOrNull(userId);
    return isKpiEligible(self) ? [self] : [];
  }

  if (role === "team_lead") {
    // KPI shows this TL plus the agents assigned to them.
    const self = await getUserByIdOrNull(userId);
    const agents = await getAgentsByTeamLead(userId);
    return [self, ...agents].filter(isKpiEligible);
  }

  // admin / developer / monitor / operations
  if (teamLeadId) {
    // KPI shows the selected TL plus their agents.
    const selected = await getUserByIdOrNull(teamLeadId);
    const agents = await getAgentsByTeamLead(teamLeadId);
    return [selected, ...agents].filter(isKpiEligible);
  }

  const all = await getAssignableUsers(role, branchIds ?? [], userId, "all");
  return all.filter((candidate) => candidate.$id !== userId && isKpiEligible(candidate));
}

export interface ReferralStatsInput {
  userId: string;
  role: User["role"];
  branchIds?: string[];
  monthStartIso: string;
  monthEndIso: string;
}

export async function loadDashboardReferralStats(
  input: ReferralStatsInput,
): Promise<ReferralSplit> {
  return cacheClientRead(
    DASHBOARD_REFERRAL_SCOPE,
    [
      input.userId,
      input.role,
      input.monthStartIso,
      input.monthEndIso,
    ],
    async () => {
      // The referral split is computed from closed leads only (it's a
      // realized-revenue view), so request isClosed=true explicitly.
      // The default listLeads filter is isClosed=false, which would
      // leave us with nothing to split.
      const leads = await listLeads(
        {
          dateFrom: input.monthStartIso,
          dateTo: input.monthEndIso,
          isClosed: true,
        },
        input.userId,
        input.role,
        input.branchIds,
      );
      // Build a leadId → total-paid lookup from actual payment records so
      // the referral / non-referral totals reflect money actually
      // collected, not the planned leadAmount from the lead form.
      const leadIds = leads.map((l) => l.$id);
      const paidRecord = leadIds.length > 0
        ? await listLeadPaidAmountsAction({ actorId: input.userId, leadIds })
        : {};
      const paidMap = new Map<string, number>(Object.entries(paidRecord));
      return splitLeadsByReferral(leads, paidMap);
    },
    DASHBOARD_DATA_TTL_MS,
  );
}
