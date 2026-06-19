const fs = require('fs');
const planPath = 'C:/Users/Vizva/.claude/plans/validated-inventing-rabin-agent-a04d554089d9d0c7c.md';
const out = `

---

## 9. Top 10 optimization opportunities, ranked

| # | Opportunity | File(s) | Effort | CPU / RAM impact | Appwrite read impact |
|---|---|---|---|---|---|
| 1 | Cache getDepartmentScopedUserIds results (5-10 min TTL) | app/actions/lead.ts lines 442-460, 1083-1086, 1323-1326, 1470-1479 | XS | Big - eliminates 50K-user walk per admin listLeads/counts call | -1 x listAllDocuments(USERS, 100x500) per dashboard request |
| 2 | Move dashboard insights row-build into a single parse + cap the details.* arrays | lib/utils/dashboard-insights.ts lines 385-541 | M | Big - 5x JSON.parse -> 1x per lead; smaller detail arrays = less render work | None |
| 3 | Switch /leads to server-paginated useLeadsQuery; only fetch all on Export | app/leads/page.tsx, lib/queries/leads/use-leads-query.ts | S | Big - drops 10K -> 20 docs on every page navigation | -1 x listLeadsForExport per page mount |
| 4 | Cache listLgHandoffsAction, listAllPaymentInsightsAction, listBranches, etc. through resource-cache (5 min) | app/actions/lg-handoffs.ts, app/actions/client-payments.ts | S | Medium | -1 round-trip per dashboard load |
| 5 | Build inverted index for lead uniqueness (email/phone/linkedin -> leadId) | new lib/utils/lead-uniqueness-index.ts, called from validateLeadUniqueness app/actions/lead.ts lines 121-219 | L | Medium | -1000 docs per Create / Edit |
| 6 | Add @tanstack/react-virtual to leads, attendance, audit-logs, payments-report, work-queue tables | app/leads/page.tsx, app/attendance/page.tsx, app/audit-logs/page.tsx, app/payments-report/page.tsx, app/work-queue/page.tsx | M | Big - DOM size & paint time drop with row count | None |
| 7 | Replace getUserByIdOrNull fan-out in resolveLeadUsersForInsights with getUsersByIds | lib/utils/dashboard-insights.ts lines 155-188 | S | Small | -N getDocument -> -N/100 listDocuments |
| 8 | Replace branch-service.getBranchStats listDocuments with Query.select(['$id'])+Query.limit(1) | lib/services/branch-service.ts lines 225-245 | XS | Small | -N docs to 1 doc per branch stat query |
| 9 | Drop the direct databases.getDocument useEffect in dashboard (team-lead name) - route through getUsersByIds | app/dashboard/page.tsx lines 234-289 | XS | Small | -1 round-trip per dashboard render |
| 10 | Sentry tracing spans on the slow server actions to measure the above | next.config.ts, sentry.server.config.ts | XS | n/a | n/a (measurement) |

### Big-picture strategy

1. Free wins first. #1, #4, #7, #8, #9 are < 1 day each and
   directly cut Appwrite reads with no schema or UX change.
2. Render wins next. #2, #3, #6 affect perceived speed the most:
   the leads page, the leadership dashboard, and the attendance table
   are where users spend their day.
3. Schema change last. #5 needs a small new collection
   (lead_uniqueness keyed by email/phone/linkedin) plus backfill.
   Worth it for write latency, but only after the read-path wins.

### What NOT to change
- TanStack Query defaults (staleTime: 2h, gcTime: 4h,
  refetchOnWindowFocus: false) are already correct. Resist any
  "make it fresher" instinct.
- The appwrite-read-cache surgical invalidation is already the right
  shape. Don't switch to full-clear; the only place that would help
  is the admin path (Opportunity #1) and even there a 5-min TTL on the
  computed user-id set is enough.
- Don't introduce Appwrite realtime subscriptions on leads / attendance
  / audit-logs. The work per refresh is the bottleneck, not the
  cadence.

### Files to read first when implementing
- lib/utils/appwrite-read-cache.ts - pattern for surgical invalidation.
- lib/utils/resource-cache.ts - pattern for service-level cached().
- lib/utils/client-read-cache.ts - pattern for page-level cacheClientRead().
- lib/queries/client.ts - TanStack defaults.
- lib/services/dashboard-data-service.ts - orchestrator that shows
  how the layers compose.
`;
fs.appendFileSync(planPath, out, 'utf8');
console.log('Final section appended');
