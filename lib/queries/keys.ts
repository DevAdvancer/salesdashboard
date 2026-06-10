/**
 * Centralised query-key factory. Every TanStack Query key in the app
 * flows through here so we can invalidate safely and find usages by grep.
 *
 * Convention: scope-first keys let us invalidate everything for a user
 * with `queryClient.invalidateQueries({ queryKey: ['leads', scope] })`
 * without touching another user's cache.
 */
export const queryKeys = {
  leads: {
    all: ["leads"] as const,
    list: (
      scope: string,
      filters: unknown,
      page: number,
      pageSize: number,
    ) =>
      [
        "leads",
        "list",
        scope,
        JSON.stringify(filters ?? {}),
        page,
        pageSize,
      ] as const,
    counts: (scope: string, filters: unknown) =>
      ["leads", "counts", scope, JSON.stringify(filters ?? {})] as const,
    detail: (id: string) => ["leads", "detail", id] as const,
  },
  users: {
    all: ["users"] as const,
    assignable: (scope: string) => ["users", "assignable", scope] as const,
    list: (scope: string, page: number, pageSize: number) =>
      ["users", "list", scope, page, pageSize] as const,
  },
  branches: {
    all: ["branches"] as const,
  },
  clientPayments: {
    detail: (leadId: string) => ["clientPayments", "detail", leadId] as const,
  },
} as const;

/**
 * Build a stable scope string from the authenticated user. Two users
 * with the same role but different ids get different scopes, so a
 * logout/login cycle can't serve cached data from the previous user.
 */
export function buildScope(userId: string, role: string): string {
  return `${userId}:${role}`;
}
