"use client";

import { getAssessmentAttempts } from "@/app/actions/assessment";
import {
  listAllPaymentInsightsAction,
  listClientPaymentSummariesAction,
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
import { cacheClientRead, clearClientReadCache } from "@/lib/utils/client-read-cache";
import type { Branch, Department, Lead, User } from "@/lib/types";

const DASHBOARD_DATA_SCOPE = "dashboard:data";
const DASHBOARD_DATA_TTL_MS = 60 * 1000;

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
