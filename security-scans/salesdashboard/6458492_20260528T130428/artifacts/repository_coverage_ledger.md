# Repository Coverage Ledger

| row | boundary | family | files checked | disposition | evidence |
| --- | --- | --- | --- | --- | --- |
| RW-001 | Server actions using admin Appwrite reads | Missing authentication / data exposure | app/actions/assessment.ts, app/actions/interview.ts | reportable fixed | checkDuplicateSubject and checkDuplicateInterviewSubject used createAdminClient without getAuthenticatedAccount before reading attempt records. |
| RW-002 | Server actions using client-supplied actor/currentUser ids | Actor spoofing / privilege escalation | app/actions/access-settings.ts, profile.ts, sop.ts, attendance.ts, chat.ts, linkedin.ts, user.ts, lead.ts | suppressed | Nearby exported admin-client actions use assertAuthenticatedUserId, getAuthenticatedUserDoc, or getActor before privileged work. |
| RW-003 | Support email API routes | Unauthenticated Graph send | app/api/mock/send-email/route.ts, app/api/interview/send-email/route.ts, app/api/assessment/send-email/route.ts | suppressed | Each POST calls getAuthenticatedAccount before reading outlook_access_token and forwarding to Graph. |
| RW-004 | Debug/config route | Secret disclosure | app/api/debug-config/route.ts | suppressed | Route returns 404 in production and only exposes NEXT_PUBLIC Appwrite identifiers in non-production. |
| RW-005 | Production dependencies | Known vulnerable dependency | package.json, package-lock.json | suppressed | npm audit --omit=dev --json reported zero production advisories. |
