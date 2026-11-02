# CRM reporting periods and Eastern time

`target_month_bounds` defines the business reporting month throughout monthly CRM views. These are shared reporting settings. The calendar editor remains restricted to Admin and Developer; every signed-in role resolves the same month definition within its existing record scope.

The configured October 2026 window is October 2–November 2, inclusive. November 2 at 11:59:59 PM Eastern belongs to October. November begins at midnight Eastern on November 3, using its configured November 3–30 window. Unconfigured dates fall back to their calendar month. New saved windows must have valid dates, a valid month key, ordered endpoints and no overlap with another configured month.

The shared resolver drives Target Report's default month, Sales/Resume dashboard monthly presets, Lead Generation month-to-date reads, Assigned Report, Technical Payments defaults/reset, Followup Payments' current-month summary, revenue-month buckets, pending-payment month keys and scheduled Target Report selection. Explicit historical month or custom date selections remain available. Report labels use the actual configured dates.

`useCurrentMonthBounds` shares a single React Query settings request per account, with no interval/focus/reconnect polling. A one-shot local timer re-resolves the period at Eastern midnight; it does not request data from Appwrite. Visibility restoration also corrects the local day after sleep. Changes invalidate the shared settings cache and target-report cache. Server-side settings are cached for five minutes and expired immediately on an authorized save; session/role/activation decisions are checked separately and are never cached by this feature.

`America/New_York` provides EST/EDT automatically. A date-only report filter is expanded from local Eastern midnight through inclusive local Eastern end-of-day. Timestamp inputs retain their actual instant. The spring transition day is 23 hours; the autumn transition day is 25 hours. KPI date enumeration converts instants back to Eastern date keys before counting working days. Financial events retain their actual date and are bucketed into the corresponding configured reporting month.

The window editor uses the existing custom calendar DatePicker controls. Window reads never write documents; no schema changes, historical financial rewrites, new polling jobs or additional schedules are introduced.

Daily aggregation code now also uses Eastern boundaries for future rebuilds. Previously stored daily aggregate rows are not silently rewritten by opening a page. If historical aggregates need recalculation after deploying the time-boundary correction, review a bounded backfill plan before applying it; original leads/payments and configured windows remain unchanged by this implementation. Vercel cron expressions continue to run in UTC as configured; they are not an Eastern wall-clock scheduling mechanism.
