const fs = require('fs');
const planPath = 'C:/Users/Vizva/.claude/plans/validated-inventing-rabin-agent-a04d554089d9d0c7c.md';
const out = `

## 1. Data fetching patterns

The codebase uses four distinct layers that interact:

| Layer | Lives in | Purpose |
|---|---|---|
| Server Actions | app/actions/*.ts | Pure server code; uses admin client; returns typed data |
| TanStack Query | lib/queries/** + lib/queries/client.ts | Client-side caching on top of server actions |
| Appwrite SDK (browser) | lib/appwrite.ts, lib/utils/appwrite-read-cache.ts | Direct browser-side reads with proxy read-through cache |
| Appwrite SDK (server) | lib/server/appwrite.ts, lib/utils/appwrite-read-cache.ts | Same proxy used in node-appwrite per-request |

### TanStack Query defaults (already excellent)
File: lib/queries/client.ts
- staleTime: 2h, gcTime: 4h, refetchOnWindowFocus: false,
  refetchOnReconnect: false, refetchOnMount: false, retry: 1.
- This is the right shape for an "open-many-pages, mutate-to-refresh"
  CRM. No change recommended; keep these settings.

### Server Actions ARE the data fetchers
Most data fetchers go through 'use server' actions in
app/actions/. The server uses createAdminClient() (admin API key)
and a createReadThroughDatabases proxy. Notable examples:

- app/actions/lead.ts -> listLeadsAction, listLeadCountsAction,
  createLeadAction, updateLeadAction, reopenLeadAction,
  getLeadAction.
- app/actions/attendance.ts -> listMyTeamAttendanceAction,
  listTeamLeadsAttendanceForAdminAction, getAttendanceFlagSummaryAction,
  checkAndNotifyAdminAttendanceEscalationsAction,
  checkAndNotifyMyTeamAbsencesAction.
- app/actions/assessment.ts, app/actions/interview.ts,
  app/actions/mock.ts -> batched attempt counters used by the
  dashboard.
- app/actions/client-payments.ts -> listClientPaymentSummariesAction,
  listAllPaymentInsightsAction.
- app/actions/lg-handoffs.ts -> listLgHandoffsAction.

### Client-side useEffect + fetch
Present in some pages but mostly legacy. Examples:

- app/dashboard/page.tsx (lines 234-289) has a useEffect that does
  a direct databases.getDocument(USERS_COLLECTION_ID, teamLeadId) to
  render the team-lead name card. This bypasses TanStack Query and the
  read-through cache. Hot path - see Opportunity #6.
- components/notification-bell.tsx has both a polling interval AND an
  Appwrite realtime subscription. It directly calls
  load({ forceRefresh: true }) on every tick and every subscription
  event.

### No SWR
No useSWR is in the codebase. All caching is either TanStack Query or
the Appwrite-proxy read-through cache.
`;
fs.appendFileSync(planPath, out, 'utf8');
console.log('Section 1 appended');
