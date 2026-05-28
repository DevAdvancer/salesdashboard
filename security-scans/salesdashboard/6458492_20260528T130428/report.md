# Security Scan Report

## Finding: Unauthenticated support duplicate checks used admin Appwrite reads

- Priority: P3
- Severity: low
- Confidence: high
- CWE: CWE-306 Missing Authentication for Critical Function; CWE-200 Exposure of Sensitive Information to an Unauthorized Actor
- Affected lines: app/actions/assessment.ts:196, app/actions/interview.ts:200

### Summary
Two duplicate-subject server actions could be invoked without first proving the request had an authenticated Appwrite session. Both actions used the admin Appwrite client to list attempt records by lead id and returned a boolean duplicate result, creating a narrow unauthenticated metadata oracle.

### Validation
A focused regression test was added in tests/unit/security/support-duplicate-actions.test.ts. Before the fix, the test showed the actions did not call createSessionClient before the admin read. After the fix, unauthenticated calls return false without creating the admin client, and authenticated duplicate checks still return true for matching normalized subjects.

### Attack Path
1. Invoke the duplicate-check server action with a lead id and subject.
2. Reach admin Appwrite listDocuments without an authenticated account check.
3. Observe the duplicate boolean to infer whether that subject was already sent for the lead.

### Severity Analysis
The issue crosses an authentication boundary but only exposes a boolean about support-attempt metadata, not full CRM records or privileged mutation. Severity is low.

### Remediation
Fixed by calling getAuthenticatedAccount before createAdminClient in app/actions/assessment.ts and app/actions/interview.ts. Regression tests cover unauthenticated blocking and authenticated behavior preservation.

## Coverage Closure
Same-family admin-client server actions were checked for assertAuthenticatedUserId, getAuthenticatedUserDoc, or getActor/getAuthenticatedAccount before privileged work. Support email routes require getAuthenticatedAccount before Graph sendMail. The debug config route returns 404 in production and only exposes NEXT_PUBLIC values in non-production.

## Verification
- npm.cmd audit --omit=dev --json: passed, 0 production vulnerabilities.
- npm.cmd test -- tests/unit/security/support-duplicate-actions.test.ts tests/unit/security/current-user.test.ts --runInBand: passed, 7 tests.
- npm.cmd run lint -- app/actions/assessment.ts app/actions/interview.ts tests/unit/security/support-duplicate-actions.test.ts: passed.
