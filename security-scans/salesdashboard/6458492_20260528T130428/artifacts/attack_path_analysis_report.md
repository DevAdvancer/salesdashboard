# Attack Path Analysis Report

Finding C-001 is in scope because exported Next.js server actions are reachable from browser-originated calls and the repository treats Appwrite admin-client access as privileged.

Attack path before fix:
1. Attacker invokes checkDuplicateSubject or checkDuplicateInterviewSubject with guessed leadId and subject values.
2. The action creates an admin Appwrite client without binding the request to an authenticated Appwrite account.
3. The action queries the attempt collection by leadId and returns a boolean duplicate result.

Counterevidence: The issue is narrower than broad record exfiltration because only duplicate status is returned; other same-family mutate/read actions require assertAuthenticatedUserId or getActor. This calibrates severity to low, not high.

Final policy decision: reportable before fix; fixed by requiring getAuthenticatedAccount before createAdminClient in both actions.
