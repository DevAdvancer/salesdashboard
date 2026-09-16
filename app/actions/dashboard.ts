"use server";

import { listLeads } from "@/lib/services/lead-action-service";
import { listBranches } from "@/lib/services/branch-service";
import { listLgHandoffsAction } from "@/app/actions/lg-handoffs";
import { listClientPaymentSummariesAction } from "@/app/actions/client-payments/list";
import {
  getAgentsByTeamLead,
  getAssignableUsers,
  getUserByIdOrNull,
} from "@/lib/services/user-service";
import { buildLeadershipDashboardInsights } from "@/lib/utils/dashboard-insights";
import type { DashboardDataInput, DashboardDataResult } from "@/lib/services/dashboard-data-service";
import type { User, Branch } from "@/lib/types";

import { getAuthenticatedUserDoc } from "@/lib/server/current-user";
import { isAdminLikeReadAllRole } from "@/lib/utils/role-utils";

export async function loadDashboardDataServerAction(
  input: DashboardDataInput
): Promise<DashboardDataResult> {
  const authUser = await getAuthenticatedUserDoc();
  if (authUser.$id !== input.user.$id) {
    throw new Error("Unauthorized: Invalid user ID");
  }

  // Force true server-side role evaluation rather than trusting the client payload
  const realIsAdminLike = isAdminLikeReadAllRole(authUser.role);
  const realIsTeamLead = authUser.role === 'team_lead';

  const branchIds = authUser.branchIds ?? [];
  const normalizedBranchIds = [...branchIds].sort();
  const normalizedTeamLeadId = input.teamLeadId ?? null;

  // Apply a 60-day limit to closed leads to prevent fetching the entire database history
  // on every dashboard load. Historical leads are available in reports.
  const sixtyDaysAgo = new Date();
  sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);
  const dateFrom = sixtyDaysAgo.toISOString();

  const closedDateFrom = input.dateRange?.from || dateFrom;
  const closedDateTo = input.dateRange?.to;

  const [activeLeads, closedLeads, allBranches, lgHandoffs] = await Promise.all([
    listLeads({ 
      isClosed: false, 
      teamLeadId: input.teamLeadId,
      dateFrom: input.dateRange?.from,
      dateTo: input.dateRange?.to
    }, authUser.$id, authUser.role, branchIds),
    listLeads({ 
      isClosed: true, 
      teamLeadId: input.teamLeadId, 
      dateFrom: closedDateFrom,
      dateTo: closedDateTo
    }, authUser.$id, authUser.role, branchIds),
    listBranches(),
    listLgHandoffsAction().catch((error) => {
      console.error("Error loading LG handoffs:", error);
      return [];
    }),
  ]);

  const combinedLeads = [...activeLeads, ...closedLeads];
  const visibleLeadIds = Array.from(new Set(combinedLeads.map((lead) => lead.$id)));
  
  // Quick inline branch map
  const branchNameById = new Map(allBranches.map((b: Branch) => [b.$id, b.name] as const));
  const _mapAgentsWithBranches = (agents: User[]) => {
    return agents.map((agent) => {
      if (!agent.branchIds || agent.branchIds.length === 0) {
        return { ...agent, branchNames: "N/A" };
      }
      const names = agent.branchIds.map((branchId) => branchNameById.get(branchId)).filter(Boolean);
      return { ...agent, branchNames: names.length > 0 ? names.join(", ") : "Unknown" };
    });
  };

  let usersForInsights: User[] = [authUser];
  let assignedAgents: any[] = [];

  if (realIsAdminLike && input.teamLeadId) {
    const selectedTeamLead = await getUserByIdOrNull(input.teamLeadId);
    if (selectedTeamLead) {
      const teamAgents = await getAgentsByTeamLead(
        selectedTeamLead.$id,
        input.departmentScope,
      );
      usersForInsights = [selectedTeamLead, ...teamAgents];
      if (input.includeAssignedAgents) {
        assignedAgents = _mapAgentsWithBranches(teamAgents);
      }
    } else {
      usersForInsights = [];
    }
  } else if (realIsAdminLike) {
    const visibleUsers = await getAssignableUsers(
      authUser.role,
      branchIds,
      authUser.$id,
      input.departmentScope,
      true
    );
    usersForInsights = [
      authUser,
      ...visibleUsers.filter((visibleUser) => visibleUser.$id !== authUser.$id),
    ];
  } else if (realIsTeamLead) {
    const teamAgents = await getAgentsByTeamLead(
      authUser.$id,
      input.departmentScope,
    );
    usersForInsights = [authUser, ...teamAgents];
    if (input.includeAssignedAgents) {
      assignedAgents = _mapAgentsWithBranches(teamAgents);
    }
  }

  // Resolve missing users for leads 
  const leadUserIds = new Set<string>();
  for (const lead of combinedLeads) {
    if (lead.ownerId) leadUserIds.add(lead.ownerId);
    if (lead.assignedToId) leadUserIds.add(lead.assignedToId);
  }
  const knownUserIds = new Set(usersForInsights.map((u) => u.$id));
  const missingUserIds = Array.from(leadUserIds).filter((id) => !knownUserIds.has(id));

  // Fetch missing users concurrently
  if (missingUserIds.length > 0) {
    const missingUsers = await Promise.all(
      missingUserIds.map((id) => getUserByIdOrNull(id).catch(() => null))
    );
    const validMissingUsers = missingUsers.filter((u): u is User => u !== null);
    usersForInsights = [...usersForInsights, ...validMissingUsers];
  }

  const branchIdsInScope = new Set([
    ...usersForInsights.flatMap((visibleUser) => visibleUser.branchIds || []),
    ...combinedLeads.flatMap((lead) => (lead.branchId ? [lead.branchId] : [])),
  ]);
  const branches = allBranches.filter((branch: Branch) =>
    input.includeAllBranchesForAdminLike && realIsAdminLike
      ? true
      : branchIdsInScope.has(branch.$id),
  );
  const paymentSummaries =
    visibleLeadIds.length > 0
      ? await listClientPaymentSummariesAction({
          actorId: authUser.$id,
          leadIds: visibleLeadIds,
        })
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
}
