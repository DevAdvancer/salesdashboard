const fs = require('fs');
const planPath = 'C:/Users/Vizva/.claude/plans/validated-inventing-rabin-agent-a04d554089d9d0c7c.md';
const out = `

---

## 2. Appwrite call hot paths

These are the highest-frequency call sites, ranked by impact.

### Opportunity #1 - listLeadsAction admin path scans entire USERS collection per call
Files: app/actions/lead.ts lines 1060-1282, 1302-1540

For every paginated call (!wantExport && !salesUserIds), the action
walks the visibility queries and, for admin/monitor/operations roles,
calls getDepartmentScopedUserIds(databases, 'sales') which is:

\`\`\`ts
listAllDocuments({ queries: [Query.orderAsc('$id')], pageLimit: 100, maxPages: 500 })
\`\`\`

That is up to 50,000 user docs fetched per page request, just to
check department === 'sales'. The admin path runs this for both
listLeadsAction and listLeadCountsAction - twice per dashboard load.

- Real hot path. Fix: cache the sales-user-id set with the same
  appwrite-read-cache / resource-cache layer used by other helpers
  (e.g. getAllActiveUsers and getAssignableUsers already use
  cached(...) with 5-minute TTL). Add a server-side cached(...)
  helper keyed on 'users:sales-department-ids' with a 5-10 min TTL.

### Opportunity #2 - Lead creation/update uniqueness scan runs full year of leads
File: app/actions/lead.ts lines 121-219

validateLeadUniqueness calls listAllDocuments over leads with
pageLimit: 100, maxPages: 10 (i.e. up to 1000 docs) and JSON-parses
the data blob on every doc, three times (email, phone, linkedin),
all inside the create/update path. On a 50K-collection this is bounded
to 1000, but the per-call CPU is large because of the triple scan.

- Real hot path on every Create / Edit Lead submit. Fix: build an
  inverted index (email -> leadId, phone -> leadId, linkedin -> leadId)
  in either Appwrite (indexed attributes + small dedicated collection)
  or a server-side cached Map. Three lookups at write time -> 3 single
  document gets.

### Opportunity #3 - Dashboard re-fetches everything on every mount
File: app/dashboard/page.tsx, lib/services/dashboard-data-service.ts

loadDashboardData (60 s TTL) fans out to:
- listLeads(isClosed: false) -> listAllDocuments up to 50K
- listLeads(isClosed: true)  -> listAllDocuments up to 50K
- listBranches (cached, fine)
- listLgHandoffsAction -> another listDocuments
- getAgentsByTeamLead / getAssignableUsers (cached, fine)
- resolveLeadUsersForInsights -> parallel getUserByIdOrNull for every
  missing user id
- listClientPaymentSummariesAction for every visible lead id

Then loadDashboardAttemptCounts fans out to getMockAttempts,
getInterviewAttempts, getAssessmentAttempts, each of which lists
across attempt collections.

On dashboard mount (or any user reference change), the action
orchestrator kicks off this whole chain. The 60-second TTL helps, but
the first visit costs a lot. Fix: (a) prefetch via React Query
hydration in the route's layout, (b) compute counts and insights
incrementally and stream, (c) cache listLeads(isClosed: true)
separately with a longer TTL (closed leads barely change).

### Opportunity #4 - listLeadCountsAction admin path scans all leads
File: app/actions/lead.ts lines 1471-1493

\`\`\`ts
const leads = await listAllDocuments<Lead>({
  ...
  queries: [...visibilityQueries, Query.select(['$id', 'ownerId', 'assignedToId', 'isClosed', 'status'])],
  pageLimit: 100, maxPages: 500,
});
\`\`\`

Up to 50K leads, projected down, just to count buckets. The non-admin
path is cheaper (six parallel limit(1) listDocuments), but the admin
path walks the full collection. Fix: same caching strategy as
Opportunity #1, plus store bucket counts on a small summary document
that updates on lead create/update/close.

### Opportunity #5 - Per-lead user lookup still happens in many places
Files:
- lib/services/lead-action-service.ts (closure-side getUserByIdOrNull
  on every dashboard refresh, see lib/services/dashboard-data-service.ts:164-168)
- app/dashboard/page.tsx lines 234-289 (direct databases.getDocument
  in useEffect for team-lead name)
- app/leads/page.tsx (the table page calls getUsersByIds in
  bulk - that's already good; see lines 270-323)

The bulk getUsersByIds(ids) helper in user-service.ts lines 434-466
is the right pattern and is being used. Action: delete the
one-off useEffect lookups and route them through getUsersByIds so
they go through the bulk path.

### Opportunity #6 - N+1 inside dashboard resolveLeadUsersForInsights
File: lib/utils/dashboard-insights.ts lines 155-188

\`\`\`ts
const resolvedUsers = await Promise.all(
  Array.from(missingUserIds).map((userId) => getUserByIdOrNull(userId))
);
\`\`\`

This is parallel and uses getUsersByIds chunking under the hood for
getUsersByIds callers, but getUserByIdOrNull is one-at-a-time. With
a 10K-lead dashboard the map can hold hundreds of missing ids, each
firing one Appwrite request. Fix: route through getUsersByIds
(chunks of 100) instead. Same call shape, far fewer round-trips.

### Opportunity #7 - branch-service.ts getBranchStats does unconditional list
File: lib/services/branch-service.ts lines 225-245

\`\`\`ts
const [leads] = await Promise.all([
  databases.listDocuments(... [Query.equal('branchId', branchId)])
]);
return { leadCount: leads.total };
\`\`\`

Reads all leads per branch even though Appwrite's response total is
already what we want. The Query.select(['$id']) + Query.limit(1)
pattern from listLeadCountsAction would cut this to one tiny
document. Fix: add the projection. This is called per branch when
admin views the branches list.

### Opportunity #8 - Weekly-report and lead exports fetch full data
File: app/actions/weekly-report.ts, app/actions/lg-handoffs.ts

These are write-heavy / read-heavy enough that they deserve caching at
the action level. Currently they re-fetch on every call (no resource
cache wrapper around listLgHandoffsAction).
`;
fs.appendFileSync(planPath, out, 'utf8');
console.log('Section 2 appended');
