# Client Progress

`/client-progress` is a separate CRM page for closed clients and Admin-created manual candidates. It adds no dashboard widgets, cron jobs, realtime subscriptions, timers or polling. The sidebar exposes the route in both department views and for every existing role.

## Access and fields

- Admin, Developer, Monitor and Operations have all-record read visibility. Other roles are department-scoped: agents/Lead Generation/Compliance see their own assignments; Sales TLs and Senior TLs see their live hierarchy. Department defaults to Sales for legacy users.
- Operations, Monitor and Compliance have read-only access. Admin alone creates manual candidates, assigns/reassigns salespeople and enters/changes recruiter names. Marketing TL is a separate manual text field editable only by an Admin in the Sales department; it does not grant access or change the Sales hierarchy.
- Salespeople are identified by user ID. Display names are derived on the server. Search and manual assignment accept active Sales Admins, agents, TLs and Senior TLs.
- Other permitted writers may change progress status, notes and add feedback. Final feedback may be saved once by a permitted writer; after that only Admin may change it. Final feedback cannot be cleared.
- Backed Out and Not Interested are excluded from all list/search results. A linked lead must still be closed and eligible at read/write time. Reopening/deleting/excluding a source lead hides its entry without deleting feedback. Source changes never reset progress status, Marketing TL, recruiter, notes or final feedback.

Progress statuses are New, Placed, Backout, Hold, Temp Hold, Low priority and Marketing in progress. New is the default for new entries; permitted users can change it to Marketing in progress or another status later. These are independent of lead and payment statuses. Backout entries remain excluded from the list, as do legacy Backed Out / Not Interested entries and ineligible source leads.

Existing New values remain New. Legacy Onboarding / In Progress values display and filter as Marketing in progress; On Hold maps to Hold, and Completed maps to Placed. Compatibility is handled during reads and in the indexed filter query without migrating documents, adding reads or writing on page load. Source synchronization preserves existing tracking decisions.

## Data and performance

`client_progress` is an indexed server-only projection plus manual entries. Linked IDs are deterministic hashes of the lead ID, making retries/backfills duplicate-safe. Original close dates determine list ordering; manual records use their creation time. Source assignment is followed unless Admin explicitly overrides it for this page.

`client_progress_events` holds immutable feedback and audit rows. Feedback is an unlimited series of individually bounded, individually paginated documents; it is never appended to a growing array. Audit previews bound long values and retain their SHA-256 and length. Short-lived `kind=lock` documents serialize entry updates across server instances. An orphan lock after a process crash must be reviewed and released by an operator only after confirming its writer stopped; there is no timer that steals locks from an active writer.

- The client list shows only the latest 10 projected summary records, sorted by `enteredAt` and ID descending. There are no list pages, cursor lookups, offsets or separate total/count requests. Name search searches all authorized eligible records and returns at most 10 matches, including older clients outside the latest ten.
- Search, filters and resets are server-side. Name search is submitted explicitly, not on keystrokes. Date filters use Eastern day boundaries, including daylight saving time.
- Each list request batch-checks its maximum 10 linked leads with one projected query to enforce live eligibility/ownership. It performs no writes and no per-row reads.
- Full notes/final feedback load on opening an entry. Feedback and audit history load separately in pages of 10; no hidden-history prefetch.
- TL scoping follows targeted direct-report queries, including legacy and available array parent columns; leaf agents do not cause more hierarchy queries. Hierarchy membership and record authorization are not cached. Only collection schema shape is process-cached.
- Every page query explicitly disables the inherited global React Query interval and focus/reconnect refetch. List reads use a cancellable, private/no-store API request, outside the Server Action dispatch queue. Each browser query key includes the account, role and department. Recent list snapshots are reused for 60 seconds; returning from a detail or resetting filters does not force another read of a fresh result. A stale snapshot remains visible during refresh. This browser snapshot reuse never caches server authorization decisions; every new request checks the session and current scope.
- Explicit filter submissions, navigation and targeted mutation invalidations drive reads; there are no Refresh buttons. Feedback/history retain their own bounded 10-entry navigation so the full feedback archive remains accessible without loading it all.
- The existing lead cache invalidation path marks tracking snapshots stale after close/reopen/backout/assignment changes. This performs no background fetches; the next visit reads the updated ten entries even within the 60-second browser cache window.
- The lead-history wrapper calls `syncClientProgress` after successful lead writes. The callback skips non-clients and changes unrelated to tracked source fields without any tracking reads/writes. No change-snapshot subscription was added for these collections.
- Browser database access to these collections is forbidden by the existing allowlist gateway. Collections and documents have no native client permissions. Server actions derive the actor from the current session and return sanitized expected-error results.

## Setup and source repair

```powershell
bun run setup:client-progress:dry
bun run setup:client-progress:apply
bun run backfill:client-progress:dry
bun run backfill:client-progress:apply
```

Setup is idempotent and uses server-only permissions. Backfill is an explicit one-time operation, not a page-load or scheduled task. It reads closed leads, excludes released statuses and creates only missing entries; existing tracking fields and feedback are preserved. Its apply stage has bounded concurrency of four. Inspect the dry run before applying.

For source-name/contact/assignment refresh on eligible clients, preview `bun run backfill:client-progress:dry -- --refresh-source`, then use the corresponding `:apply` command after reviewing the plan. Only changed source fields are updated. Legacy references to deleted users retain the client with a former-user label.

All normal CRM mutations use the shared admin-client hook. Raw Appwrite scripts/external integrations bypass it, so after such imports or a failed projection write, an operator must run the reviewed source refresh/backfill. Live list/detail checks continue to exclude an ineligible source lead even if its projection is stale. No repair scan runs during ordinary page use.

Schema creation does not deploy application code. Deploy the matching application changes to enable automatic tracking in production. The current build deliberately uses the existing CRM theme/components; authenticated visual review is still required with a native-MFA CRM session.

## Client cards and public links

The read-only card follows the reference layout using the CRM's neutral theme, rounded panels and Plus Jakarta Sans: client name and marketing start date, salesperson/recruiter/Marketing TL, current status and optional remarks, chronological numbered feedback and a separate final review. The internal preview inherits the app's theme tokens; the standalone public card follows the same saved theme preference and defaults to dark, using a self-hosted font with its bundled OFL license. More than three feedback entries are supported. Feedback loads in batches of ten on request, with no polling or per-view writes. Calendar pickers replace native date inputs on the list and Admin's marketing-start field. First transition to Marketing in progress records the current Eastern calendar date in the existing update; Admin may correct it.

Only an active Admin can create, replace or revoke a public link, enforced by both UI and server actions. Admin previews the chosen fields and selects 1, 7 or 30 days. Email/phone are excluded by default; remarks are optional. All current and future feedback and the final review are included. The grant is one server-only `client_progress_shares` document per entry, with empty native permissions. Only the token hash is stored; the original URL is shown once. Replacing rotates its secret and revoking blocks subsequent reads.

The public `/share/client` shell uses a token in the URL fragment, so it is absent from the initial request URL and referrer. Its strict POST reader accepts only that 256-bit random secret and an authenticated encrypted feedback cursor. It checks uncached grant expiry/revocation, the issuing Admin's live role/activation, current client/source eligibility and a subject fingerprint bound to identity and assignment. Reopened, excluded, reassigned or reused clients cannot silently expose a different person through an old link. Public responses explicitly select card fields and feedback, never audit rows, payments or raw lead documents. Cursor encryption also hides internal event IDs. No public mutation or session is created, and server-action posts remain gated.

The standalone shell mounts no CRM providers. It renders data as text and uses a nonce CSP, same-origin JSON reader, bounded request bodies, no-store/no-referrer/noindex and frame denial. Valid manual cards need three single-document reads plus one feedback query per requested batch; linked clients add one live source read. Bounded process-local rate limits add no database writes, but are best effort per instance rather than distributed denial-of-service protection. No additional cron, collection subscription or polling is introduced.

Anyone holding a link can forward, copy or screenshot its content. Expiry and revocation prevent future reads; they cannot recall material already viewed. Do not put information in feedback that should not be included in a shared card. Schema setup creates no public grants by itself; Admin must explicitly publish each card.
