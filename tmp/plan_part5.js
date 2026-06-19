const fs = require('fs');
const planPath = 'C:/Users/Vizva/.claude/plans/validated-inventing-rabin-agent-a04d554089d9d0c7c.md';
const out = `

---

## 6. Route inventory (data sources, frequency, expected size)

| Route | File | Collections read | Frequency | Max rows |
|---|---|---|---|---|
| /dashboard | app/dashboard/page.tsx | USERS, LEADS (x2 closed + open), BRANCHES, LG_HANDOFFS, MOCK/INTERVIEW/ASSESSMENT_ATTEMPTS, CLIENT_PAYMENTS | Per mount (60 s TTL on dashboard data) | 50K leads + 5K users + 10K handoffs + 5K attempt docs |
| /leads | app/leads/page.tsx | LEADS (10K export), USERS (assignable + by-ids), BRANCHES | Per filter change / mount | 10K leads + 5K users |
| /leads/[id] | app/leads/[id]/page.tsx | LEADS, USERS (assignable), CLIENT_PAYMENTS, AUDIT_LOGS | Per open | 1 lead + N logs |
| /users | app/users/page.tsx | USERS (paginated), BRANCHES | Per mount + per CRUD | 5K users (50 per page) |
| /assessment-support | app/assessment-support/page.tsx | ASSESSMENT_ATTEMPTS | Per mount + per filter | recent N |
| /audit-logs | app/audit-logs/page.tsx | AUDIT_LOGS, LEADS, USERS, BRANCHES (reference cache) | Per mount | up to 10K with date filter |
| /attendance | app/attendance/page.tsx | ATTENDANCE, USERS, LINKEDIN_ACCOUNTS, NOTIFICATIONS (escalations) | Per mount + per date change | 100s rows |
| /attendance-report | app/attendance-report/page.tsx | ATTENDANCE | Per mount + per filter | 1000s rows |
| /payments-report | app/payments-report/page.tsx (component components/payments/payments-report-dashboard.tsx) | CLIENT_PAYMENTS, LEADS | Per mount | 1000s |
| /reports | app/reports/page.tsx | weekly_report collection | Per mount | weekly aggregates |
| /hierarchy / /resume-hierarchy | app/hierarchy/page.tsx, app/resume-hierarchy/page.tsx | USERS (full table) | Per mount | 5K |
| /notifications | app/notifications/page.tsx | NOTIFICATIONS | Per mount | recent N |
| /linkedin-requests, /linkedin-accounts, /linkedin-reports | corresponding page.tsx | LINKEDIN_REQUESTS / LINKEDIN_ACCOUNTS | Per mount | 1000s |
| /lead-requests | app/lead-requests/page.tsx | LEAD_REQUESTS | Per mount | 1000s |
| /chat, /resume-chat | app/chat/** | CHAT_MESSAGES | realtime? not currently subscribed (per Grep) | 1000s |
| /coaching-notes | app/coaching-notes/page.tsx | COACHING_NOTES, LEADS | Per mount | 1000s |
| /review-queue | app/review-queue/page.tsx | REVIEW_QUEUE | Per mount | 100s |
| /branches | app/branches/page.tsx | BRANCHES, USERS, LEADS (count) | Per mount | 100s |
| /settings/* | app/settings/** | ACCESS_CONFIG, FORM_CONFIG | Per mount | tiny |
| /client, /client/[id] | app/client/** | LEADS (closed), CLIENT_PAYMENTS | Per mount | 1000s closed |
| /work-queue | app/work-queue/page.tsx | LEADS (filtered by followUp) | Per mount | 100s |

---

## 7. Existing perf-related infra

### lib/hooks/
- use-debounce.ts - generic, 200 ms typical.
- use-manual-refresh.ts - escape-hatch invalidator (page vs all).
- use-single-click.ts - ref-based in-flight dedup.
- use-confirm-dialog.tsx - UI helper, not perf.

### components/ui/
No table virtualization (no @tanstack/react-virtual, no
react-window). All tables are <table><tbody>{rows.map(...)}</tbody></table>.
This is the single biggest client-side CPU saver when we virtualize
leads/attendance/audit-logs tables. Add @tanstack/react-virtual and
wrap the tbody rows.

### lib/utils/
- dashboard-insights.ts - single biggest re-render hotspot (see #5).
- user-hierarchy.ts, branch-visibility.ts - light helpers.

### Sentry config
- next.config.ts wires @sentry/nextjs/withSentryConfig. No
  custom tracing config visible - performance tracing is on by
  default with default sampling. Worth raising tracesSampleRate
  and instrumenting the slow server actions
  (createLeadAction, listLeadsAction, listLeadCountsAction,
  loadDashboardData) with Sentry.startSpan to confirm baseline
  before/after the fixes.

### Next.js caching
- next.config.ts is empty beyond Sentry.
- No revalidate exports on pages (every page is "use client").
- No ISR config. Pages render client-side after auth + initial fetch.
- This means no benefit from Next's server cache today. Since
  data is user-scoped, RSC + ISR wouldn't help anyway. The Appwrite
  read-through + TanStack Query cache is the right primary layer.
`;
fs.appendFileSync(planPath, out, 'utf8');
console.log('Section 6+7 appended');
