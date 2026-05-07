# Security Scan Report: salesdashboard

## Findings Fixed

### Finding: Client-supplied actor IDs authorized privileged Appwrite admin-client operations
- Priority: P1
- Severity: high
- Confidence: high
- CWE: CWE-639 Authorization Bypass Through User-Controlled Key; CWE-862 Missing Authorization; CWE-863 Incorrect Authorization
- Affected lines: app/actions/user.ts:79, app/actions/lead.ts:121, app/actions/sop.ts:31, lib/server/current-user.ts:10

Privileged server actions trusted browser-supplied caller IDs before using the Appwrite admin client. A lower-privilege user could call the action directly with a different currentUserId/userId/actorId and cause the server to evaluate role checks against that supplied document.

Fixed by adding lib/server/current-user.ts and requiring account.get().$id to match the supplied actor id before privileged work proceeds. Applied across user, lead, access-settings, profile, sop, mock, interview, and assessment actions. Added a focused regression test for allowed, mismatched, and missing IDs.

### Finding: Session helper accepted any Appwrite session cookie prefix
- Priority: P2
- Severity: medium
- Confidence: medium
- CWE: CWE-287 Improper Authentication
- Affected lines: lib/server/appwrite.ts:25

The session helper fell back to any cookie starting with a_session_ if exact project cookies were absent. That could confuse sessions across Appwrite projects or environments. Fixed by rejecting requests unless one of the exact configured project cookie names is present.

### Finding: Graph email proxy routes lacked CRM session binding
- Priority: P2
- Severity: medium
- Confidence: high
- CWE: CWE-306 Missing Authentication for Critical Function; CWE-352 Cross-Site Request Forgery
- Affected lines: app/api/mock/send-email/route.ts:7, app/api/interview/send-email/route.ts:7, app/api/assessment/send-email/route.ts:7

The mail proxy routes forwarded caller-controlled payloads to Microsoft Graph when outlook_access_token existed, without first verifying an Appwrite CRM session. Fixed by requiring an authenticated Appwrite account before reading the Outlook token and sending mail.

### Finding: Debug config route exposed deployment identifiers in production
- Priority: P3
- Severity: low
- Confidence: high
- CWE: CWE-200 Exposure of Sensitive Information to an Unauthorized Actor
- Affected lines: app/api/debug-config/route.ts:4

The debug route returned Appwrite endpoint/project/database/collection identifiers. These are public-style NEXT_PUBLIC values, so severity is low, but the production route was unnecessary exposure. Fixed by returning 404 in production.

## Coverage Closure

- Appwrite Query usage: suppressed. Reviewed code uses Appwrite Query helpers, not raw SQL/eval/template sinks.
- RCE/file/path traversal: not applicable in reviewed runtime surfaces. No reachable child_process/eval/upload/extraction/filesystem sink found.
- Dependency advisories: deferred. npm audit was blocked because it would send dependency metadata to npm registry without explicit approval.
- GitHub status: connector returned no status checks for commit b81c33fbc48ac53c544ed580daec64d1bd3c3451; gh CLI was not installed.

## Validation

- npm test -- tests/unit/security/current-user.test.ts --runInBand: passed.
- npm run build: passed after approved network access for Google Fonts.
- npm test -- --runInBand: failed in unrelated existing suites.
- npx tsc --noEmit: failed in existing test typing issues, while production build TypeScript passed.
- npm run lint: failed due existing repo-wide lint errors.

## Changed Files

- lib/server/current-user.ts
- lib/server/appwrite.ts
- app/actions/user.ts
- app/actions/lead.ts
- app/actions/access-settings.ts
- app/actions/profile.ts
- app/actions/sop.ts
- app/actions/mock.ts
- app/actions/interview.ts
- app/actions/assessment.ts
- app/api/mock/send-email/route.ts
- app/api/interview/send-email/route.ts
- app/api/assessment/send-email/route.ts
- app/api/debug-config/route.ts
- app/mock/page.tsx
- app/interview-support/page.tsx
- app/assessment-support/page.tsx
- tests/unit/security/current-user.test.ts
