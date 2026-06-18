# Read / Request / CPU Optimization Plan

## Summary

Optimize the highest-cost hotspots first without changing data, features, permissions, or user-visible workflows. The implementation should prefer cached reads by default, refresh only on realtime/invalidation events or an explicit hard refresh, and reduce background polling / write frequency where the current code does duplicate work.

## Current State Analysis

### Existing cache mechanisms already in the repo

- `lib/utils/appwrite-read-cache.ts` wraps Appwrite `getDocument` / `listDocuments` with a 5-minute read-through cache plus in-flight dedupe, and clears on write-like methods.
- `lib/utils/client-read-cache.ts` provides browser-side TTL caching, force refresh, in-flight dedupe, and scoped invalidation.
- `lib/queries/client.ts` already configures React Query with `staleTime: 5 minutes`, `gcTime: 30 minutes`, and `refetchOnWindowFocus: false`.
- `lib/services/user-service.ts`, `lib/services/branch-service.ts`, `lib/services/sop-service.ts`, and `lib/services/client-payment-service.ts` already use cache helpers in selected places.

### Verified hotspots

- `lib/contexts/auth-context.tsx` refreshes the server session every 10 minutes and on every window focus for every logged-in user.
- `components/app-layout.tsx` sends a presence heartbeat every 2 minutes, immediately on mount, and on window focus; each heartbeat performs both presence upsert and attendance write work.
- `components/attendance-self-toggle.tsx` polls attendance toggle state every 60 seconds and on focus.
- `components/notification-bell.tsx` uses realtime updates but still force-refreshes on a 5-minute fallback interval and on focus.
- `lib/contexts/access-control-context.tsx` fetches the full `access_config` collection directly from the root provider without a dedicated scoped cache layer.
- `app/dashboard/page.tsx` loads full active leads, full closed leads, counts, users, branches, payments, handoffs, and support attempt data in one client effect.
- `app/work-queue/page.tsx` repeats most of the dashboard read pattern independently.
- `app/hierarchy/page.tsx` and `app/resume-hierarchy/page.tsx` read large user sets directly and reload the whole tree on every user document event.
- `app/audit-logs/page.tsx` refetches branch, user, and lead reference maps together with audit logs whenever filters change.
- `app/actions/attendance.ts` has the heaviest server fan-out: it loops team leads, then fetches agents and attendance per team lead, and performs multiple write paths inside the loop.

## Proposed Changes

### 1. Normalize cache ownership at the app root

#### `lib/queries/client.ts`

- Export a browser-safe helper that returns the singleton QueryClient and can clear browser query state on logout.
- Keep the current React Query defaults unchanged; the goal is to make the existing cache easier to invalidate, not to change freshness semantics.

#### `lib/contexts/auth-context.tsx`

- On logout, clear both the Appwrite read cache and the React Query browser cache so data from the previous user session cannot trigger extra reads or stale cross-user renders.
- Add a lightweight session-sync cooldown in `sessionStorage` so repeated `focus` events do not call `/api/auth/appwrite-session` multiple times in a short burst.
- Keep forced sync only for explicit auth transitions such as login, initial session recovery failure, and manual hard refresh.

#### New file: `lib/services/access-config-service.ts`

- Add a dedicated cached accessor for access rules using `cacheClientRead(...)` keyed by user role / session scope.
- Expose `listAccessRules({ forceRefresh })` and `invalidateAccessRulesCache()` so the root provider can read from cache by default and only bypass cache when a settings save explicitly needs fresh rules.

#### `lib/contexts/access-control-context.tsx`

- Replace the direct `databases.listDocuments(...)` call with the new access-config service.
- Keep the existing `refreshRules()` API and permission logic exactly as-is; only the read path changes.

### 2. Reduce background polling and duplicate writes without changing features

#### `components/app-layout.tsx`

- Keep the current presence / attendance feature behavior, but make the heartbeat visibility-aware and cooldown-safe:
  - skip background heartbeats while the tab is hidden,
  - dedupe mount, interval, and focus-triggered pings against the existing `sessionStorage` cooldown,
  - avoid back-to-back presence upsert + attendance action calls when the same route/user state was just synced.
- Preserve current presence expiry semantics so online status and attendance escalation logic continue to work.

#### `components/attendance-self-toggle.tsx`

- Replace the blind uncached refresh loop with a cached, visibility-aware read path:
  - use React Query or `cacheClientRead(...)` for `getMyAttendanceToggleStateAction`,
  - keep a maximum 60-second freshness window while visible,
  - refresh immediately after `markMyselfPresentAction`,
  - skip background refreshes when the tab is hidden.
- Preserve the existing button states and attendance rules.

#### `components/notification-bell.tsx`

- Continue using Appwrite realtime as the primary freshness source.
- Stop treating every fallback timer tick as a forced read; use cached reads for normal opens and only force refresh on realtime invalidation, explicit focus refresh after cooldown, or manual hard refresh.
- Keep the existing toast behavior, unread counter behavior, and notification list behavior unchanged.

### 3. Remove duplicated hotspot reads across dashboard-style pages

#### New file: `lib/services/dashboard-data-service.ts`

- Create a shared loader for dashboard/work-queue datasets keyed by user scope and page inputs.
- Reuse existing cached helpers for users, branches, notifications, and payment summaries instead of each page reassembling the same read graph independently.
- Keep output shape aligned with what `app/dashboard/page.tsx` and `app/work-queue/page.tsx` already expect so the UI does not change.

#### `app/dashboard/page.tsx`

- Move the heavy multi-read effect behind the shared dashboard-data service.
- Keep counts, insights, payment insights, and support-attempt metrics identical, but avoid duplicate branch/user/payment reads when the same scoped data is still fresh.
- Use existing `visibleLeadIds` computation once per load and reuse it for downstream loaders.

#### `app/work-queue/page.tsx`

- Reuse the same shared dashboard-data service instead of duplicating the active-leads / closed-leads / users / branches / payments / handoffs pipeline.
- Preserve current filtering by selected team lead and current role.

#### Cache invalidation for dashboard/work-queue data

- Scope the shared dashboard cache by user id, role, branch ids, selected team lead id, and closed/open filters so one user’s cache cannot leak into another.
- Invalidate the shared dashboard cache from existing mutation boundaries that already change visible dashboard data, especially lead updates, client payment updates, handoff updates, and attendance-driven queue changes.

### 4. Route large list pages through existing cache patterns

#### `lib/services/user-service.ts`

- Add a cached helper for the admin/monitor “all visible users” read path currently implemented inline in hierarchy pages.
- Keep branch-scoped helpers unchanged for team leads, but ensure all hierarchy callers go through a single cached service path instead of raw `databases.listDocuments(...)`.

#### `app/hierarchy/page.tsx`

- Replace direct `listDocuments(..., Query.limit(5000))` usage with cached service helpers.
- Debounce realtime-triggered full reloads so a burst of user document events results in one reload, not many.
- Preserve the current sales-only filtering, branch filtering, tree shape, and realtime responsiveness.

#### `app/resume-hierarchy/page.tsx`

- Apply the same cached service + debounced realtime reload pattern used for the sales hierarchy page.
- Preserve the current resume-only filtering and page-specific access rules.

#### New file: `lib/services/audit-log-reference-service.ts`

- Cache branch, user, and lead display-name maps separately from audit log entries.
- Expose force-refresh invalidation hooks for cases where an admin edits a user/lead and expects names to change immediately.

#### `app/audit-logs/page.tsx`

- Split “reference map” loading from “log entry” loading so changing filters only refetches audit logs, not all user/lead/branch names every time.
- Preserve current filters, result set, and detail rendering.

### 5. Reduce server-side fan-out in attendance escalation

#### `app/actions/attendance.ts`

- Rewrite `checkAndNotifyAdminAttendanceEscalationsAction(...)` to batch reads by date window instead of querying inside the team-lead loop:
  - read admins once,
  - read team leads once,
  - read all in-scope agents once,
  - read attendance records once for the date scope,
  - group data in memory by `teamLeadId`,
  - perform write operations only when a timestamp or status actually changes.
- Batch LinkedIn account lookups once per action execution instead of per-team-lead subgroup where possible.
- Preserve notification content, escalation timing, and current attendance business rules.

### 6. Keep cache freshness explicit and safe

#### Cross-cutting rules for every new cache entry

- Key every cached read by user scope and relevant filters.
- Default to TTL-backed cached reads for normal navigation.
- Use realtime events, explicit mutation invalidation, or a browser hard refresh to get fresh data immediately.
- Do not introduce stale cross-user data; clear session-scoped caches on logout.
- Do not change document structure, collection ids, permissions, or feature behavior.

## Assumptions And Decisions

- Scope is “hotspots first”, not a full app-wide rewrite.
- User-visible behavior must stay the same: same data, same pages, same permissions, same attendance and notification rules.
- Freshness policy is “cache by default, refresh on realtime/invalidation, or on hard refresh”.
- No schema changes, no Appwrite collection changes, and no replacement of Appwrite with a different backend.
- Existing caching primitives in the repo are sufficient; the plan extends and standardizes them instead of introducing a new data-fetching stack.
- React Query remains the default cache for query-driven pages, while `cacheClientRead(...)` remains the default cache for service-style reads outside TanStack Query.

## Verification Steps

### Functional verification

- Confirm login, logout, role switching, and access-controlled navigation behave exactly as before.
- Confirm dashboard, work queue, hierarchy, audit logs, notifications, and attendance pages show the same data as before optimization.
- Confirm new lead / payment / handoff / notification / attendance changes appear after realtime invalidation or browser hard refresh.

### Performance verification

- Measure Appwrite read/write counts for:
  - dashboard first load,
  - work queue first load,
  - hierarchy open + realtime update burst,
  - audit log filter changes,
  - 15 minutes of an idle logged-in tab.
- Verify that idle-tab reads and writes drop materially because hidden-tab polling is suppressed and focus bursts are deduped.
- Verify that route-to-route navigation between dashboard-style pages reuses cached data instead of rebuilding the entire read graph.
- Verify that attendance escalation action performs fewer list queries and fewer no-op writes.

### Code verification

- Run `bun run lint`.
- Run the focused Jest suites covering auth, dashboard insights, notifications, attendance, hierarchy, and cache helpers.
- Add or update only targeted tests for new cache invalidation / dedupe behavior where coverage is currently missing.
