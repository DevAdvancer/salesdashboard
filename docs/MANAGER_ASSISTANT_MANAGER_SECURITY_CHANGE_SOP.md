# SOP: Manager And Assistant Manager Security Workflow Changes

## Audience

Managers and assistant managers who create users, manage leads, send candidate support emails, update follow-ups, manage review queues, or use access-controlled CRM features.

## Purpose

The tech team has strengthened the CRM security controls so actions performed in the system are always tied to the signed-in user session. These changes help prevent unauthorized access, mistaken role use, and activity being recorded under the wrong user.

## What Changed

1. User actions now verify the signed-in session before continuing.
   - Creating managers, assistant managers, team leads, and agents now requires the logged-in session to match the acting user.
   - Updating a user profile or hierarchy now requires the same session check.

2. Lead actions now verify the signed-in session.
   - Creating, listing, and reopening leads now checks that the acting user is the logged-in user.
   - Branch, role, and hierarchy visibility rules still apply after the session check.

3. Review, notes, coaching, and notification actions now verify the signed-in session.
   - The CRM will not accept a browser-supplied user ID as proof of identity.

4. Mock, interview, and assessment support email workflows now verify the signed-in session.
   - Attempt reservations, completions, and rollbacks must come from the logged-in user.
   - Email proxy routes also require an active CRM session before sending through Outlook.

5. Debug configuration is hidden in production.
   - The debug configuration endpoint no longer exposes project and collection identifiers in production.

## Manager And Assistant Manager Responsibilities

1. Always sign in using your own CRM account.
   - Do not share sessions, browsers, or accounts.
   - If you are using a shared machine, fully log out when finished.

2. Refresh the page and sign in again if an action says `Unauthorized`.
   - This usually means the session expired, the user changed accounts in another tab, or the browser has stale session data.

3. Create and update users only from your assigned role and branch scope.
   - Managers and assistant managers should continue assigning users only within their approved branch and hierarchy access.

4. Confirm lead ownership and branch before making updates.
   - If a lead is not visible or cannot be updated, treat that as an access-control signal and contact the tech team instead of trying alternate accounts.

5. Use support email workflows only for authorized candidate communications.
   - Mock, interview, and assessment email attempts are now more strictly tied to the logged-in user and audit trail.

6. Report unexpected access immediately.
   - Examples: seeing leads outside your branch, being able to update a user outside your hierarchy, emails sent under the wrong person, or audit logs showing the wrong actor.

## Expected User Experience

- Normal CRM usage should remain the same.
- Some stale sessions may require logging out and logging back in.
- Direct links or browser tabs left open for a long time may need a refresh.
- Unauthorized actions should now fail earlier and more consistently.

## Escalation Path

Contact the tech team with:

- Your name and role.
- Page or workflow where the issue happened.
- Time of issue.
- Screenshot of the error, if available.
- The user, lead, branch, or candidate involved.

## Do Not

- Do not ask another manager or assistant manager to perform actions from their account for your work.
- Do not reuse another user's browser session.
- Do not manually alter browser storage, cookies, or request payloads.
- Do not retry blocked actions repeatedly if the access decision looks wrong.

## Quick Summary

The CRM now checks the real signed-in session before allowing sensitive manager and assistant manager workflows. This protects user management, lead access, support email sending, review queues, notifications, notes, and audit records.
