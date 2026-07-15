"use server";

import { listLeads } from "@/lib/services/lead-action-service";
import { listBranches } from "@/lib/services/branch-service";
import { listLgHandoffsAction } from "@/app/actions/lg-handoffs";
import { listClientPaymentSummariesAction } from "@/app/actions/client-payments";
import {
  getAgentsByTeamLead,
  getAssignableUsers,
  getUserByIdOrNull,
} from "@/lib/services/user-service";
import { buildLeadershipDashboardInsights } from "@/lib/utils/dashboard-insights";
import type { DashboardDataInput, DashboardDataResult } from "@/lib/services/dashboard-data-service";
import type { User, Branch } from "@/lib/types";

export async function loadDashboardDataServerAction(
  input: DashboardDataInput
): Promise<DashboardDataResult> {
  const branchIds = input.user.branchIds ?? [];
  const normalizedBranchIds = [...branchIds].sort();
  const normalizedTeamLeadId = input.teamLeadId ?? null;

  // Notice we removed the 60 days limit for closed leads to keep all historical data visible!
  const [activeLeads, closedLeads, allBranches, lgHandoffs] = await Promise.all([
    listLeads({ isClosed: false, teamLeadId: input.teamLeadId }, input.user.$id, input.user.role, branchIds),
    listLeads({ isClosed: true, teamLeadId: input.teamLeadId }, input.user.$id, input.user.role, branchIds),
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

  let usersForInsights: User[] = [input.user];
  let assignedAgents: any[] = [];

  if (input.isAdminLike && input.teamLeadId) {
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
    input.includeAllBranchesForAdminLike && input.isAdminLike
      ? true
      : branchIdsInScope.has(branch.$id),
  );
  const paymentSummaries =
    visibleLeadIds.length > 0
      ? await listClientPaymentSummariesAction({
          actorId: input.user.$id,
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
