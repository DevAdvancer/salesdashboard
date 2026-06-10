"use client";

import { useQuery } from "@tanstack/react-query";
import { listLeadCountsAction } from "@/app/actions/lead";
import { buildScope, queryKeys } from "@/lib/queries/keys";
import type { LeadListFilters, UserRole } from "@/lib/types";

/**
 * Lightweight "count only" query. Replaces the dashboard's two
 * listLeads calls with a single small action. Counts under 100K
 * fit in one listDocuments round-trip.
 */
export function useLeadCountsQuery({
  userId,
  role,
  branchIds,
  filters,
}: {
  userId: string;
  role: UserRole;
  branchIds?: string[];
  filters?: LeadListFilters;
}) {
  const scope = buildScope(userId, role);

  return useQuery({
    queryKey: queryKeys.leads.counts(scope, { ...filters, branchIds }),
    queryFn: () => listLeadCountsAction(userId, role, branchIds, filters ?? {}),
    enabled: Boolean(userId),
  });
}
