# Runtime Inventory

Entrypoints reviewed: app/actions/*.ts server actions, app/api/auth/* routes, support email API routes, app/api/debug-config/route.ts, app/api/sentry-example-api/route.ts.

Sensitive sinks and controls: createAdminClient admin Appwrite access, createSessionClient/getAuthenticatedAccount/assertAuthenticatedUserId auth helpers, Microsoft Graph sendMail fetches, access-control and user-management server actions.

Dependency advisory seed: npm audit --omit=dev --json reported 0 production vulnerabilities on 2026-05-28.
