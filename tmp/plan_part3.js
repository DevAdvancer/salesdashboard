const fs = require('fs');
const planPath = 'C:/Users/Vizva/.claude/plans/validated-inventing-rabin-agent-a04d554089d9d0c7c.md';
const out = `

---

## 3. Caching layers

| Layer | TTL | Where | Notes |
|---|---|---|---|
| QueryClient | staleTime 2 h, gcTime 4 h | lib/queries/client.ts | Excellent defaults; respect them |
| appwrite-read-cache (browser) | 2 h | lib/utils/appwrite-read-cache.ts | Surgical per-collection invalidation; covers listDocuments/getDocument |
| appwrite-read-cache (server, admin) | 2 h | lib/server/appwrite.ts | Shared adminDatabaseCacheStores in module scope - survives across requests in long-running Node workers, which is correct for an admin key |
| appwrite-read-cache (server, session) | 2 h | lib/server/appwrite.ts | One sessionDatabaseCacheStores per worker; potential leak risk if a token is reused across users - see below |
| resource-cache | 5 min | lib/utils/resource-cache.ts | cached(key, ttlMs, loader) for service-level results (branches:all, users:assignable:..., users:agents:...) |
| client-read-cache | 60 s (or 5 min default) | lib/utils/client-read-cache.ts | Page-level result cache (leads list, dashboard data) |
| sessionStorage | session | app/dashboard/page.tsx:122 (crm:outlook-checked), app/layout.tsx:35 (salesdashboard-theme) | Two short reads on boot - fine |
| localStorage | persistent | app/layout.tsx:35 (theme) | Fine |

### Caching gaps (biggest wins)
1. getDepartmentScopedUserIds is uncached - every admin
   dashboard call walks all users (see Opportunity #1).
2. listLeads(isClosed:true) cache is co-aliased with the active
   leads cache via the same Query.limit key in listLeads
   (lib/services/lead-action-service.ts lines 41-53). The cache key
   is just 'lead:listLeads' plus (filters, userId, role, branchIds)
   - there's no distinguishing between closed vs active beyond what's
   in filters. As long as filters include isClosed, the key is
   distinct - that's correct. However, the loader still uses the
   forExport path (pageSize 10000) every time, which is more than
   the 60 s TTL probably warrants. Bumping the TTL or capping the
   export loader to pageSize: 1000 for cache entries would reduce
   repeated transfers.
3. Session read-through cache namespace in lib/server/appwrite.ts
   uses namespaceForSecret("session-cookie", session.value) - the
   cookie value is the namespace seed, so logout/re-login produces a
   fresh namespace. Good. But the adminDatabaseCacheStores lives at
   module scope, so it persists for the worker process - fine for an
   admin key, but worth noting in a serverless environment.

### No cookies used as cached data
Search confirmed - only appwrite_jwt and a_session_* cookies hold
session material, no caching cookie payload.

---

## 4. Real-time / subscription patterns

The only Appwrite realtime subscription in the codebase is:

- components/notification-bell.tsx lines 141-150 -> subscribes to
  databases.<db>.collections.<notifications>.documents, fires
  forceLoad() on any event.

That's the right shape (per-collection subscription, throttled by the
60 s NOTIFICATION_FALLBACK_POLL_MS).

Polling intervals found:

- components/attendance-self-toggle.tsx:64 - interval for the present-button badge.
- components/notification-bell.tsx:122 - NOTIFICATION_FALLBACK_POLL_MS interval that calls load({ forceRefresh }).
- components/app-layout.tsx:112 - likely auth/session heartbeat.
- lib/contexts/auth-context.tsx:200 - setInterval(refreshServerSession, 10 * 60 * 1000) - once per 10 minutes, fine.

No refetchInterval in TanStack Query.

No realtime on leads / attendance / audit-logs. They are pull-on-mount
via TanStack Query.

Implication: if any feature currently feels laggy, it's not because
we're not subscribing - it's because the underlying queries are heavy.
Adding subscriptions won't help; cutting the work per query will.
`;
fs.appendFileSync(planPath, out, 'utf8');
console.log('Section 3+4 appended');
