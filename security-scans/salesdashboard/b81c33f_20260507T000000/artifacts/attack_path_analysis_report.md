# Attack Path Analysis Report

## C-001 Client-supplied actor IDs authorize privileged Appwrite admin-client operations
Attack path: a logged-in low-privilege user calls a server action directly and supplies an admin or manager user id as currentUserId/userId/actorId. The action fetched that supplied user document, passed role checks, and then used createAdminClient to perform privileged Appwrite operations. This crosses the browser-to-server-action trust boundary and can affect CRM users, leads, access settings, notes, queues, and attempt/audit records. Counterevidence: role checks existed, but they were not bound to account.get(). Severity before fix: high due realistic privilege escalation and object access impact. Policy decision: reportable. Fixed by binding supplied ids to the Appwrite session.

## C-002 Appwrite session helper accepts unrelated project session cookies
Attack path: a request with an a_session_* cookie for a different Appwrite project could be accepted when exact project cookies were absent. Counterevidence: Appwrite account.get would still validate the session against endpoint/project, so exploitability depends on Appwrite rejecting mismatched sessions; the broad fallback was still an unsafe auth boundary. Severity before fix: medium. Policy decision: reportable. Fixed by removing broad fallback.

## C-003 Graph email proxy routes accepted Outlook token without CRM session binding
Attack path: a browser with outlook_access_token cookie sends a POST body to the same-origin Graph proxy route. The route forwarded the arbitrary payload to Microsoft Graph without verifying the user still had a CRM session. Counterevidence: token cookie is httpOnly and same-origin protections may limit cross-site triggering, but same-origin script or direct user request still reached a privileged mail-sending sink without CRM auth. Severity before fix: medium. Policy decision: reportable. Fixed by requiring Appwrite account.get().

## C-004 Debug config route exposed deployment identifiers
Attack path: unauthenticated GET to /api/debug-config returns Appwrite endpoint/project/database/collection ids. Counterevidence: values are NEXT_PUBLIC and not secrets. Severity before fix: low/informational. Policy decision: report as quality/security hardening. Fixed by returning 404 in production.
