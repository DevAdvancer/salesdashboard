const fs = require('fs');
const planPath = 'C:/Users/Vizva/.claude/plans/validated-inventing-rabin-agent-a04d554089d9d0c7c.md';
const out = `

---

## 5. Re-render hot spots

### app/leads/page.tsx - full 10K set sliced client-side
Lines 391-550. The page calls useLeadsForExportQuery (TanStack) which
returns up to 10,000 leads as a flat array, then slices 10 per
page in paginatedLeads (line 469). leadRows is useMemo-d but
depends on paginatedLeads, assignedUsers, owners, user?.role,
router. The table renders inside a plain tbody with no
virtualization. Real hot path: every state update (filter typing,
search input, page change) re-renders the entire 10-row visible chunk,
but every setAgents(...)/setOwners(...)/setAssignedUsers(...)
causes useEffect([leads]) -> loadLeadUserNames() -> more state writes.
Better: ship server pagination (useLeadsQuery already exists at
lib/queries/leads/use-leads-query.ts lines 24-45 with (page,
pageSize) in the key) and use the existing server paginated action.

Fix:
1. Switch app/leads/page.tsx to useLeadsQuery instead of
   useLeadsForExportQuery so the wire payload is 10-20 rows per page.
   The 10K export is only needed for the CSV export button - keep
   listLeadsForExport for that single click.
2. Drop the setLeads/setTotalLeads mirror state in LeadsContent
   and consume leadsQuery.data directly via useMemo.

### app/dashboard/page.tsx - assignedAgentRows is properly memoised
Lines 97-114: useMemo keyed on assignedAgents. Good. The dashboard
also keeps a mirror metrics state and a countsQuery state - both
write to the same field, causing a write race. Could collapse to a
single source of truth (TanStack Query). Minor.

### app/users/page.tsx - table renders all loaded users
Lines 100-200 (saw through line 100). USERS_PAGE_SIZE = 50, so this is
smaller. The page also uses a useEffect to load agents (legacy
pattern, lines 331-386). Should move to useAssignableUsersQuery
following the leads pattern.

### app/attendance/page.tsx - multi-table, no virtualization
Two tables, up to ~50 rows each (one for team leads, one for team
attendance agents). Inline map rows, no virtualization. Acceptable
for current scale but no debounce on the date picker (lines 405-411)
which fires loadOverview on every change. Currently that effect is
gated by [loadOverview] dependency (line 188) which is memoised on
[isAdminLikeAttendance, selectedDateKey, user]. OK.

### components/dashboard/leadership-dashboard.tsx (not read but referenced)
Receives insights: LeadershipDashboardInsights whose details.*
arrays can be 10K rows each (one DashboardLeadDetailRow per
lead). Sort happens in dashboard-insights.ts lines 538-541 with three
sort calls on three potentially large arrays. Real hot path on
every dashboard render. Fix: cap the arrays server-side (e.g.
top-50 stale leads, top-50 unassigned, top-50 pipeline value), and
move sorting into the build.

### buildLeadershipDashboardInsights itself (already discussed)
The per-lead loop in lib/utils/dashboard-insights.ts lines 385-536
runs JSON.parse(lead.data) five times per lead (getLeadName,
getLeadCompany, getLeadEmail, getLeadAmount, plus the inline
getUpdatedDate). Each helper reparses. Real hot path.
Fix: parse once, cache the parsed object on a local
Map<leadId, ParsedLead> and pass it through.

### leadsTable row component
AssignedAgentName and OwnerName in app/leads/page.tsx lines
802-822 are correctly memo-ised. Good.
`;
fs.appendFileSync(planPath, out, 'utf8');
console.log('Section 5 appended');
