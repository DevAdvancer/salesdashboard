"use client";

import { useQuery } from "@tanstack/react-query";
import { listLeadsAction } from "@/app/actions/lead";
import { buildScope, queryKeys } from "@/lib/queries/keys";
import type { LeadListFilters, UserRole } from "@/lib/types";

export interface UseLeadsQueryArgs {
  userId: string;
  role: UserRole;
  branchIds?: string[];
  filters: LeadListFilters;
  page: number;
  pageSize: number;
}

/**
 * Server-paginated leads list. The query key embeds (scope, filters,
 * page, pageSize) so any of those changing triggers a refetch.
 *
 * For UI that needs the full set (e.g. dashboard insights), use the
 * `forExport: true` path via {@link useLeadsForExportQuery} instead.
 */
export function useLeadsQuery({
  userId,
  role,
  branchIds,
  filters,
  page,
  pageSize,
}: UseLeadsQueryArgs) {
  const scope = buildScope(userId, role);

  return useQuery({
    queryKey: queryKeys.leads.list(
      scope,
      { ...filters, branchIds },
      page,
      pageSize
    ),
    queryFn: () =>
      listLeadsAction(filters, userId, role, branchIds, { page, pageSize }),
    enabled: Boolean(userId),
  });
}
