"use client";

import { useQuery } from "@tanstack/react-query";
import { listLeadsAction } from "@/app/actions/lead";
import { buildScope, queryKeys } from "@/lib/queries/keys";
import type { LeadListFilters, UserRole } from "@/lib/types";

/**
 * Fetch every lead matching the filters (capped at 10K by the action's
 * `forExport` path). Used by the Client History list (where we want
 * all closed leads in one shot) and the dashboard insight builders
 * (which need the full set to compute funnel metrics).
 */
export function useLeadsForExportQuery({
  userId,
  role,
  branchIds,
  filters,
}: {
  userId: string;
  role: UserRole;
  branchIds?: string[];
  filters: LeadListFilters;
}) {
  const scope = buildScope(userId, role);

  return useQuery({
    queryKey: queryKeys.leads.list(scope, { ...filters, branchIds }, 1, 10000),
    queryFn: () =>
      listLeadsAction(filters, userId, role, branchIds, { forExport: true }),
    enabled: Boolean(userId),
    // 10 min stale — the export path pulls a lot of data, give the
    // server a chance to settle.
    staleTime: 10 * 60 * 1000,
  });
}
