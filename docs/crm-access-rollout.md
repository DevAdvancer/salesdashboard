# Attendance, Appwrite email OTP and lead history rollout

## Current preparation

The targeted live schema additions were applied on 22 October 2026 after the dry-run preview: server-only `security_challenges` and `crm_access_requests`, their indexes, and the optional `leads.history` string column. No existing business rows or native client-access settings were changed. The live Appwrite project has Email OTP enabled and custom SMTP enabled through Brevo with TLS. A real Appwrite OTP was delivered to the authorized recipient, who confirmed receipt. The native code validated successfully and its temporary session was removed. The English OTP Session template was then saved live with CRM HUB sender name, subject, message and sign-off, a ten-minute CRM expiry notice and no UNKNOWN device text. A fresh branded test code also validated successfully.

At the 22 October pre-release checkpoint, application checks were local and the deployed gateway was not yet ready for cutover. Treat production attendance enforcement and native client isolation as pending until the deployment and verification steps below complete.

## Login and daily access

Attendance page reads use a single read-only team/summary action with a shared
request authorization snapshot. Initial selection starts at today's Eastern date
so hydration does not trigger a second fetch. Background absence scans start
after visible data has loaded. Flag summaries query only flagged rows once for
the combined week/month range. Generation checks discard old selection responses.
The attendance mutation actions remain outside that shared read context.

October 23 update: all attendance-required roles can access CRM after email OTP
before 10 AM New York time and mark themselves present. At 10 AM the server
requires today's attendance or approved cover. A bootstrap cutoff timestamp
prompts the browser to recheck at the boundary; browser time never authorizes
server access. Exempt roles remain Admin, Developer, Monitor and Operations.

After an idle tab's 15-minute server JWT expires, the security gate now forces a
shared JWT rotation from the existing native Appwrite session and retries before
blocking. Successful background rechecks do not unmount CRM providers. An actual
native-session expiry shows an explicit sign-in action; repeated outages still
fail closed after one silent retry. Checks are deduplicated, run every minute
while visible, and suppress repeated focus checks within 30 seconds.

Every CRM login, including Admin, Developer, Monitor and Operations, requires a code sent and validated by Appwrite's native Email OTP APIs using the configured project SMTP. The Google transporter is not imported by this flow. Other existing notification emails are unchanged. Before sending, the server verifies that the native authentication account is active and its email matches the CRM record, so the token endpoint cannot silently register or target another account.

Native OTP verification creates a temporary Appwrite session. The server deletes that session before issuing an HttpOnly signed proof bound to the original CRM login session, for at most twelve hours or the native session expiry. The native token secret is never returned or stored by the CRM. Challenges expire within ten minutes, permit five attempts, and have durable resend/hourly limits and an atomic consumption claim. A provider/cleanup failure never unlocks access. This is password plus email verification enforced by the CRM gateway, rather than automatic enrollment in Appwrite's native MFA feature.

Admin, Developer, Monitor and Operations are exempt from attendance. All other roles require today's Eastern-date attendance. An absent/unmarked account without assigned cover only shows instructions to ask its TL or manager to mark attendance or assign cover; it never shows a name input.

With assigned cover, the person's name must match the assignment, and a second Appwrite OTP goes to their registered email. Verification submits a pending request. A separate authorized TL/manager, Admin, Developer or Operations user approves in Attendance -> CRM access approvals. Monitor cannot approve; neither the absent account nor its effective cover actor can approve their own request. The CRM access approvals panel only approves or revokes assigned-cover access. It has no mark-present control or mark-present API operation; existing attendance and delegate-assignment controls remain in their original workflow.

Cover approval is bound to the absent account's session, current assignment timestamp, assigned person and Eastern date. Cover must remain active and present or exempt. Reassignment, deactivation, revocation and Eastern midnight invalidate the grant. Approval does not mark the absent person present. Approved cover is recorded as the effective actor in lead history.

## Data access and uploads

Pages, API routes, server actions, mail routes, browser CRUD and change subscriptions pass through server access checks. The browser gate mounts before access and notification providers, checks on focus and every thirty seconds, and does not mount CRM data providers while blocked. Outlook authentication remains independent; this controls CRM use of mail routes, not Microsoft's separate mailbox sessions.

The public referral form keeps its dedicated, validated intake-only POST endpoint; it does not exempt general server actions or allow CRM reads. Shared lookup services invoked by server actions use authenticated in-process reads rather than HTTP calls to localhost. Scheduled LinkedIn withdrawals supply an explicit system audit actor after cron-secret validation. The browser Account SDK still authenticates directly with Appwrite. Database and resume requests go through `/api/appwrite/...`; only an authenticated user's own safe profile can be read before OTP for the login screen. Lists, other profiles, changes and files require CRM access. Generic browser lead reads are restricted to leadership; normal users use the existing scoped lead actions. The gateway preserves department boundaries and excludes private user preferences from other users' profiles. Mutations use existing authorized server actions; branch management is Admin/Developer only.

Native browser realtime is replaced with gated change events. Notification bodies are recipient-scoped and chat bodies department-scoped. Other collections emit refresh metadata. Connections recheck access every ten seconds and reconnect within one minute. The polling interval can coalesce multiple changes; list data remains authoritative.

Resume reads/deletes also check per-file ownership/read permissions and role restrictions. Browser uploads use parts no larger than 2 MiB. Appwrite rejects these as native Content-Range chunks, so each part is temporarily stored server-only and the server assembles the final file using Appwrite's supported SDK upload. Server-selected permissions replace caller permissions. Incomplete parts expire after one hour and the daily cleanup cron removes them. Maximum assembled file size is 20 MiB.

Native public/password-session requests can otherwise bypass the CRM gateway. The separate cutover disables client access on every collection in this configured database and this CRM's configured resume bucket. Appwrite server API-key access continues, as verified on isolated live resources. Existing record values and ACLs are preserved. The local US configuration targets `crm-database-1` and bucket `6a16fabb001803785fd5`; the UK checkout targets `uk-sales` and bucket `resumes`. The script resolves the actual configured scope and does not change other databases/buckets.

## Lead history and payment reminders

`leads.history` is a server-owned JSON string containing up to one hundred recent events, bounded below the 60,000-byte column size. Events are appended in the lead mutation with actor ID/name, time, action and redacted before/after values. Caller-supplied history is discarded. The existing append-only `lead_history` collection retains the full archive. The lead view labels Backed Out, Not Interested, reopened, reassignment and other changes. Historical actors are not invented. Payment History displays payment updates and linked payment follow-ups separately from lifecycle events.

### Refresh and slow connections

The gate consumes fresh server bootstrap status on its first render. Pending
restoration uses a light placeholder; it does not show an attendance/security
panel until the server actually requires verification. Background access checks
retain the verified dashboard while running, and repeated bootstrap object
replacement does not cancel an in-flight check. A failed check cannot fall back
to an older allowed bootstrap.

Browser restoration has a 20-second overall deadline, with bounded bootstrap,
native-session and JWT requests (including response body reads). A transient
bootstrap error falls back to native session recovery. Network failures show an
in-place retry without deleting the OTP proof; only confirmed native expiry
clears it. Timeouts never grant access. Retries cancel obsolete restore work so
late SDK results cannot restore an old user. No browser-stored access decision
is trusted, and server-side enforcement remains fresh on every request.

The payment-reminder cron excludes `non_upfront`, alongside fully paid and refunded payments.

## Deployment order and rollback

1. Run `bun run setup:crm-access:dry`. It must show no missing schema. This schema-only command is safe before deploying; `:apply` creates missing schema without altering existing client access.
2. Review the completed SMTP delivery test and application diff/check results. Obtain separate approval for the exact commit and then separate approval for pushing, per AGENTS.md.
3. Deploy the new application. Next builds default `CRM_ACCESS_ENFORCEMENT` and `CRM_LEAD_HISTORY_SNAPSHOT` to `true`; an explicit environment override can disable either. Both must be true for cutover readiness. Schema must exist before this deployment.
4. On the deployed CRM, verify login OTP, a present user, absent/no-cover, assigned cover pending approval, approval/revocation, existing attendance and delegate assignment, lead history, resume upload/download, and a mail/action call while blocked.
5. Run `bun run setup:crm-access:lock:dry` and show the resolved scope. It currently reports the old deployed gateway is not ready. The apply command refuses to change access until the deployed `/api/security/readiness` reports protocol `crm-gateway-appwrite-otp-v1` and `cutoverReady: true`.
6. Run `bun run setup:crm-access:lock` only after that readiness and preview. It writes an immutable local rollback snapshot before the first change, disables native client access, and verifies `nativeClientIsolation: true` on the deployed URL. Preserve the snapshot privately; do not commit `outputs/`.
7. Test anonymous and ordinary native-session direct reads and file downloads against the real collections/bucket: both must fail while the new gateway and server actions still work.

For rollback, preview `bunx tsx scripts/lock-crm-client-access.ts --restore=outputs/<snapshot>.json`, then apply the same command with `--apply`. The script validates project/database/bucket and restores only original enabled settings while retaining current names, permissions and security configuration. Restoring native access restores the old bypass, so do not claim full isolation during rollback. Do not redeploy old browser code while native access remains disabled.

The daily `security-cleanup` job requires `CRON_SECRET`. It deletes expired verification/attempt claims and expired upload parts. Cover requests and lead history remain retained; security journal entries follow their recorded expiry.

## Verification evidence

Live isolated checks passed for native session/JWT identity, anonymous and password-session read denial after disabling a collection, continued admin reads, disabled-bucket file denial, continued admin downloads, and small-part/server-assembly upload compatibility. Probe collections, files, buckets and temporary auth accounts were deleted afterward. No staff attendance, cover grants, or existing business data were modified by these probes.

Jest covers signed proofs, expiry, tampering, native token calls, no plaintext persistence, rate/attempt limits, concurrent consumption, temporary-session cleanup, attendance exemptions, hierarchy/department scoping, self-approval denial, assignment changes, midnight, absent cover, approval/revocation, server-owned lead history, browser gateway bypass attempts and upload integrity/permissions. Final build/test/lint results are reported with the release handoff; repository-wide pre-existing lint errors are reported separately.



## Login and refresh performance

The shared reference-data cache uses database-scoped, exact query keys. Invalidated in-flight reads cannot repopulate the cache or remove a replacement read. Write failures return through the caller's promise chain, including invalidation, without a detached rejection. Authorization remains independently revalidated per HTTP operation.

A valid HttpOnly CRM session restores the own profile and current access decision with one bootstrap request. JWT rotation runs in the background when due. Login and expired-session recovery can return the same bootstrap with JWT synchronization. The gate uses this fresh server response without a second status request, and successful OTP verification returns the new attendance/access state directly. No browser-stored access decision is trusted.

The protected application waits for authentication to finish before mounting its data providers. The query provider keeps one stable provider tree while IndexedDB cache restoration completes. This avoids dashboard remounts and duplicate loading work. Parallel identical identity/database reads share only their outstanding promise, with no cache of settled authorization decisions or failures. Role, activity, OTP, attendance and cover approval remain enforced; later requests re-read current state.

Delegate approvals no longer load the whole attendance roster. They batch only the users referenced by today's requests, skip orphaned/malformed rows, and show a lookup error without incorrectly claiming no requests exist.

Warm local-development requests against live Appwrite measured the old sequential session restore at 1,273 ms average and the combined bootstrap at 374 ms average over three paired runs (71% reduction). This measures session restoration for a developer account, not production end-to-end dashboard rendering. The temporary native test session was removed; no attendance or lead data was changed and no OTP was sent by the benchmark.

## LinkedIn Helper save performance

The extension endpoint uses an explicit HTTP-operation context for native identity, attendance and safe own-profile reads. This context is enabled only for the LinkedIn endpoint, which does not change attendance, authentication or cover approvals. Results never carry into a later HTTP request. Session revocation, deactivation and attendance removal are checked again on that next request. Native connection pooling shares sockets while each request supplies its own credentials.

Lead protection scans explicitly request 5,000-row cursor pages, with a 100-row fallback for older Appwrite installations. Short capped pages continue while Appwrite reports more rows; incomplete scans and the 100,000-row safety ceiling block the operation. New extension creates defer the lead check to the existing distributed profile lock and history interceptor, avoiding a duplicate scan before the lock. Resends retain their existing action checks. A protected lead appearing after preview returns a conflict without creating a request.

`vercel.json` places this endpoint in `sin1`, close to this deployment's Singapore Appwrite project. Revisit that setting if the database region changes. The installed extension protocol/package is unchanged.

`bunx tsx scripts/benchmark-linkedin-extension.ts --email=<authorized-developer-email>` previews the probe. Adding `--apply` uses isolated synthetic agent, attendance, account and request fixtures against localhost, then deletes those fixtures, their history/locks and native auth user/session. `--origin=http://localhost:5001` selects a locally started production build. The final warm production-build run against live Appwrite measured one complete 1,945-lead scan at 422 ms versus 5,312 ms across 20 old batches, and complete saves at 2,844 / 2,755 / 3,638 ms (3,079 ms average). These are local API timings, not deployed browser timings or real LinkedIn sends. The approximately two-second target still requires verification after deployment in the configured region.

Validation after these changes: 144 Jest suites / 1,049 tests passed; production build and application typecheck passed. Full ESLint still reports the same nine pre-existing errors in untouched files. The updated application remains uncommitted and undeployed.

## Read budget for access checks

Each access check reads the live user record and today's attendance (2 database
reads). To avoid repeating that work without caching decisions across requests:

- **One check per request.** `proxy.ts` runs the full check, then forwards a signed,
  30-second, server-only `x-crm-access-pass` header to the handler of the same request.
  The handler still validates the native Appwrite session and reuses the proxy's user
  record and `allowed` decision only if the pass is genuine and bound to that account,
  session and Eastern date. Any browser-supplied copy is stripped by the proxy and would
  fail signature verification anyway. Status endpoints (`/api/security/access`,
  `/api/auth/appwrite-session`) bypass the proxy and always evaluate fresh.
- **Live change stream.** Access is verified when each stream connects (about once a
  minute), not on every 10-second tick. A revoked user's open stream ends within about a
  minute; every page, data read and action is still checked on its own request.
- **Gate re-checks.** The browser gate re-checks every minute while waiting for OTP,
  attendance or cover approval, and every 5 minutes once allowed. Focus, `recheckAt` and
  the stream's `crm-access-recheck` signal still refresh immediately.
