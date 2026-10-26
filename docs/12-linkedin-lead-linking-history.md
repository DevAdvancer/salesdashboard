# LinkedIn profile protection and lead history

An existing lead reserves its LinkedIn profile across all companies, agents, URL variants and request states. Only a live lead status of **Not Interested** or **Backed Out** releases the profile. A request withdrawal never releases an existing lead.

## Existing records

`bun run link:linkedin-leads:dry` reads every lead and request and writes a local preview under `outputs/linkedin-lead-repair/`. Current Not Interested leads are skipped entirely. Valid profile URLs are resolved from `linkedinProfileUrl`, `linkedinProfile` and legacy `field_16`.

Existing requests with the same profile are linked through `request.leadId`, including older rows marked as cold calls. Request agents, accounts, companies, statuses and dates are preserved. If no matching request exists, a clearly marked `recordSource: lead_backfill` row is created using the lead's creation date in Eastern time. Its invitation/acceptance timestamps are unknown; `acceptedAt` stays null. The row uses an import account ID, and request reports/stat aggregation exclude it from invitation counts.

The script never creates, updates or deletes a lead. It verifies source revisions before applying and rechecks each lead's status. Apply requires the exact preview hash:

```powershell
bun run link:linkedin-leads:apply --plan=<reviewed-plan-hash>
bun scripts/verify-linkedin-lead-links.ts
```

The hash prevents applying a different plan accidentally. Rerun the dry run if source records changed. The first production run found eight existing cold-call rows that avoided unnecessary imports. The final expected scope is 963 profile registrations, 143 request links and 299 historical request rows, skipping 265 current Not Interested leads.

## Server enforcement

`lib/server/linkedin-lead-protection.ts` reads the current lead through a server-only profile registry, with a complete lead scan as fallback. It has no one-year, branch, company or 1,000-lead cutoff and never treats a scan failure as an available profile. Manual request actions, the extension check/save path and the Create Lead action on LinkedIn Requests all use this check.

The shared admin client also wraps lead/request writes with `withLeadHistory`. Lead creation acquires a deterministic database reservation per normalized profile and checks again inside that reservation. This serializes concurrent server instances. Ownership takeover is rejected while the lead is protected; normal existing team assignment behavior remains governed by its existing server authorization. The configured holding-owner transition when marking a lead Not Interested/Backed Out remains allowed.

The request-link action authorizes the actor and checks the URL before changing only the request's `leadId`; it never rewrites lead data or the lead's saved request reference. Existing linked requests show **Open Lead** and **Lead History**, including withdrawn and historical import rows. Old sent requests with a lead link do not expire merely because no acceptance timestamp is known.

## Reusing a released lead

Marking a lead Not Interested or Backed Out withdraws its linked requests while retaining their lead links and acceptance dates. Create Lead reuses the existing released lead ID, replaces its current business fields with the new submission, applies the new owner/assignee/branch, clears old follow-up details, and starts a new payment cycle. Earlier payment records and append-only history remain intact. Active duplicate matches take priority over released matches, and the profile is rechecked under its write lock.

Form previews use the same server policy and allow eligible reuse. LinkedIn matching includes older records and legacy URL fields. Reuse also withdraws old outreach referenced by the lead's saved request ID. Same-company resends still reuse the request row because of the company/profile/active unique index; resending clears its old lead link, and restoring the lead leaves that newly accepted request active. Earlier ownership, request statuses, and lead data remain in `lead_history`.

Lead History is available from the Activity Timeline for open and closed leads. TLs/Senior TLs retain their existing lead visibility scope; admin, developer, monitor, and operations retain their leadership visibility. Closure status does not grant or remove history access.

## Append-only event storage

`lead_history` stores separate lead/request write attempts, successful changes, failures and blocked takeovers. Baselines distinguish existing snapshots from a complete historical log; past events and missing acceptance times cannot be reconstructed. Sensitive credential/SSN values are redacted; long values have bounded previews and hashes. Collection and document permissions do not permit browser writes, updates or deletes. The application only appends history events.

An intent is durably stored before a tracked CRM server mutation. If history cannot be saved, the mutation does not start. If a process fails after the mutation, the intent remains for reconciliation. History viewing reuses the full lead detail authorization and is paginated. It does not grant lead visibility to another agent just because that agent owns a request for the same profile.

This records writes through the CRM shared admin client. Direct administrative changes outside the application must be handled by a separate Appwrite event integration if those also need to be captured; the historical baseline is not an external audit log.

## Operations

`linkedin_lead_registry` contains permanent `p_…` lookup rows and temporary `l_…` operation reservations. A failed process does not automatically expire or steal a reservation: after confirming no operation is still running, an administrator can inspect the intent history and remove only the abandoned registry reservation. Never remove the corresponding lead or its history.

Both new collections have no browser collection permissions and use document security. Schema setup for this feature is scoped in the link script; the durable collection definitions are also present in the general schema synchronizer. No new role, route or access component is introduced.

Production linking can be applied independently, but the new prevention checks, history recording and UI become live only when this code is deployed. No commit or push is implicit in the migration.
