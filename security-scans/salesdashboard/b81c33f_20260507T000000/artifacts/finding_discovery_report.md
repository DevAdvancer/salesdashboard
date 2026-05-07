# Finding Discovery Report

## Candidate C-001: Client-supplied actor IDs authorize privileged Appwrite admin-client operations
Affected locations before fix: app/actions/user.ts create/update actions; app/actions/lead.ts create/list/reopen; app/actions/access-settings.ts; app/actions/profile.ts; app/actions/sop.ts; app/actions/mock.ts; app/actions/interview.ts; app/actions/assessment.ts.
Attacker source: browser-controlled server action arguments such as currentUserId, userId, actorId.
Broken control: code looked up the caller document by the supplied ID and then used createAdminClient for privileged operations.
Impact: logged-in users could potentially impersonate higher-privilege CRM users for user creation, user updates, lead listing, lead mutation, access setting changes, notes/review queue changes, and attempt/audit mutation.
Closest control: role checks existed, but they checked the supplied actor document instead of the authenticated session principal.
CWE: CWE-639, CWE-862, CWE-863.
Status: reportable and fixed.

## Candidate C-002: Appwrite session helper accepts unrelated project session cookies
Affected location before fix: lib/server/appwrite.ts fallback any a_session_* cookie.
Attacker source: cookies attached to the request.
Broken control: missing binding between accepted cookie name and configured Appwrite project id.
Impact: session confusion across Appwrite projects in the same browser/domain environment.
CWE: CWE-287.
Status: reportable and fixed.

## Candidate C-003: Graph email proxy routes accepted Outlook token without CRM session binding
Affected locations before fix: app/api/mock/send-email/route.ts, app/api/interview/send-email/route.ts, app/api/assessment/send-email/route.ts.
Attacker source: POST JSON body plus ambient outlook_access_token cookie.
Broken control: no Appwrite CRM auth check before forwarding attacker-provided payload to Graph me/sendMail.
Impact: if a victim had an Outlook token cookie, the route could be used as a privileged same-origin mail-sending proxy without verifying CRM authentication.
CWE: CWE-306, CWE-352.
Status: reportable and fixed.
