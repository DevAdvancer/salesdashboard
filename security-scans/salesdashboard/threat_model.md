# Threat Model: salesdashboard

## Product Surface
Next.js App Router CRM for sales operations. The main trust boundaries are browser-to-server actions, browser-to-route-handlers, Appwrite session cookies, Appwrite database/auth APIs, Microsoft OAuth/Graph mail APIs, and Sentry/build/deployment configuration.

## Assets
CRM user identities and roles, lead/customer data, branch/hierarchy relationships, access-control configuration, audit logs, Outlook access tokens, Appwrite API key, and email-sending authority.

## Attacker-Controlled Inputs
Client-supplied server action arguments, route JSON bodies, URL search parameters, Appwrite documents editable by users, cookies present on requests, lead form data, review/note/coaching text, and OAuth callback parameters.

## Required Invariants
Privileged server actions must bind the actor to the authenticated Appwrite session. Client-supplied IDs must not select the authorization principal. Admin-client operations must enforce role, hierarchy, branch, object ownership, and recipient checks server-side. Outlook token usage must require a valid CRM session. Session lookup must not consume cookies from unrelated Appwrite projects.

## High-Impact Failure Modes
Authorization bypass or IDOR through trusted client IDs; cross-branch or cross-role data exposure; unauthorized user/lead/access-config mutation through admin Appwrite client; forged attempt/audit records; unauthorized Graph email sending with stored Outlook cookies; accidental disclosure of runtime configuration; dependency or build pipeline vulnerabilities.
