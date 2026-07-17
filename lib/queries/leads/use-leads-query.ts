"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
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
 * `placeholderData: keepPreviousData` holds the previous page's rows
 * visible while the next page loads, so the table doesn't flash empty
 * during pagination.
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
    queryFn: async ({ signal }) => {
      const response = await fetch('/api/leads/list', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filters,
          userId,
          role,
          branchIds,
          options: { page, pageSize }
        }),
        signal
      });

      if (!response.ok) {
        let errorMessage = "Failed to fetch leads";
        try {
          const errorData = await response.json();
          if (errorData.error) errorMessage = errorData.error;
        } catch (e) {
          // ignore parsing error if it's not JSON
        }
        throw new Error(errorMessage);
      }

      return response.json();
    },
    enabled: Boolean(userId),
    placeholderData: keepPreviousData,
  });
}
