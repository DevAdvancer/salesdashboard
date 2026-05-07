# Runtime Inventory

- App framework: Next.js App Router, React 19, TypeScript.
- Data/auth backend: Appwrite browser SDK and privileged node-appwrite admin client.
- Auth entrypoints: app/login, app/signup, Appwrite session cookies, app/api/auth/login, app/api/auth/callback, app/api/auth/status.
- Privileged mutation surfaces: app/actions/user.ts, lead.ts, access-settings.ts, profile.ts, sop.ts, mock.ts, interview.ts, assessment.ts.
- API routes: Graph send-email proxy routes for mock/interview/assessment; debug-config; Sentry example.
- Sensitive sinks: createAdminClient().users/databases operations, cookie session extraction, Graph me/sendMail fetch calls, access_config writes, audit-log writes, lead/user document reads/writes.
- Out of first-pass scope: tests, docs, examples, public static assets, lockfiles except dependency inventory.
- GitHub status: connector returned no commit statuses for b81c33fbc48ac53c544ed580daec64d1bd3c3451. gh CLI unavailable locally.
