"use client";

import { useQuery } from "@tanstack/react-query";
import {
  getAgentsByTeamLead,
  getAssignableUsers,
  getTeamLeads,
} from "@/lib/services/user-service";
import { getCachedBranchesAction } from "@/app/actions/branch-cache";
import { getCachedFormConfigAction } from "@/app/actions/form-config";
import { buildScope, queryKeys } from "@/lib/queries/keys";
import type { Department, User, UserRole } from "@/lib/types";
import type { Branch } from "@/lib/types";

/**
 * TanStack wrappers around the user / branch / form-config service calls.
 *
 * The underlying service functions already wrap Appwrite reads in
 * `cached(...)` (5 min default), so the Appwrite roundtrip is skipped on
 * repeat calls. The TanStack layer on top gives us:
 *
 *  - shared cache across components (e.g. the dashboard insights + the
 *    leads page both reading `branches:list`),
 *  - structural sharing so a re-render with identical data doesn't
 *    ripple down to consumers,
 *  - automatic invalidation through `useLeadMutations` / `useUserMutations`.
 */

const FIVE_MINUTES = 5 * 60 * 1000;
const TEN_MINUTES = 10 * 60 * 1000;

export function useAssignableUsersQuery({
  userId,
  role,
  branchIds,
  departmentScope,
  includeInactive,
}: {
  userId: string;
  role: UserRole;
  branchIds?: string[];
  departmentScope?: Department | "all";
  includeInactive?: boolean;
}) {
  const scope = buildScope(userId, role);
  return useQuery<User[]>({
    queryKey: queryKeys.users.assignable(scope, includeInactive),
    queryFn: () =>
      getAssignableUsers(role, branchIds ?? [], userId, departmentScope, includeInactive),
    enabled: Boolean(userId),
    staleTime: FIVE_MINUTES,
  });
}

export function useTeamLeadsQuery({
  userId,
  role,
  branchIds,
  departmentScope,
  includeInactive,
}: {
  userId: string;
  role: UserRole;
  branchIds?: string[];
  departmentScope?: Department | "all";
  includeInactive?: boolean;
}) {
  const scope = buildScope(userId, role);
  return useQuery<User[]>({
    queryKey: queryKeys.users.teamLeads(scope, includeInactive),
    queryFn: () => getTeamLeads(branchIds, departmentScope, includeInactive),
    enabled: Boolean(userId),
    staleTime: FIVE_MINUTES,
  });
}

export function useTeamAgentsQuery({
  teamLeadId,
  departmentScope,
  includeInactive,
}: {
  teamLeadId: string;
  departmentScope?: Department | "all";
  includeInactive?: boolean;
}) {
  return useQuery<User[]>({
    queryKey: queryKeys.users.teamAgents(teamLeadId, includeInactive),
    queryFn: () => getAgentsByTeamLead(teamLeadId, departmentScope, includeInactive),
    enabled: Boolean(teamLeadId),
    staleTime: FIVE_MINUTES,
  });
}

export function useBranchesQuery() {
  return useQuery<Branch[]>({
    queryKey: queryKeys.branches.list(),
    queryFn: () => getCachedBranchesAction().catch(() => []),
    staleTime: FIVE_MINUTES,
  });
}

export function useLeadFormConfigQuery() {
  return useQuery({
    queryKey: queryKeys.formConfig.lead(),
    queryFn: () => getCachedFormConfigAction().catch(() => ({ fields: [], version: 0, updatedBy: '' })),
    staleTime: TEN_MINUTES,
  });
}
