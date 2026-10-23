# AGENTS.md

Guidance for AI coding agents working in this repository. Human-facing setup docs live in [README.md](README.md), [SETUP.md](SETUP.md), and [docs/](docs/).

## What this project is

`newpulsecrm` (branded "CRM HUB", Silverspace Inc.) is a **Next.js 16 App Router CRM** backed by **Appwrite**. It serves two departments out of one codebase:

- **Sales**: leads, follow-ups, LinkedIn outreach, payments, attendance, reports
- **Resume**: resume profiles, marketing, call requests raised by Sales, its own chat and hierarchy

The department split (`user.department` is `'sales'` or `'resume'`) is a first-class access dimension, not just a label. See [Access control](#access-control).

## Commands

Package manager is **bun**. Use `bun` and `bunx` for everything; `bun.lock` is the lockfile to update.

A `package-lock.json` is also committed, and as of the last commit it is in sync with `package.json`. It is not what the team installs from. Do not run `npm install` to add or change a dependency: that updates only the npm lockfile and lets the two drift. If you change dependencies, use `bun add` / `bun remove` and mention the npm lockfile to the user so they can decide whether to refresh or drop it.

```bash
bun run dev              # Dev server on http://localhost:5000 (NOT 3000)
bun run build            # Production build
bun run lint             # ESLint (flat config, eslint-config-next)
bun run test             # Jest
bun run test:watch
bun run test:coverage
```

There is no typecheck script. Run `bunx tsc --noEmit` when you need one.

### Appwrite schema and data scripts

All scripts are `tsx` entrypoints under [scripts/](scripts/). **Always run the dry variant first** and show the user the diff before applying.

```bash
bun run setup:appwrite:dry          # Report schema changes without writing
bun run setup:appwrite              # Apply collections + backfill user.department
bun run sync:appwrite:dry           # Same script, alternate alias
bun run setup:appwrite:targets:dry  # Monthly targets preview
bun run setup:appwrite:targets      # Monthly targets collections
bun run setup:crm-access:dry        # Preview security_challenges, crm_access_requests, leads.history
bun run setup:crm-access:apply      # Create security/access schema (does not alter native client access)
bun run setup:crm-access:lock:dry   # Preview native Appwrite client-access isolation cutover
bun run setup:crm-access:lock       # Disable native client access (requires deployed readiness + writes rollback snapshot to outputs/)
bun run setup:beta-access:dry       # Preview beta_feature_access schema
bun run setup:beta-access:apply     # Apply beta_feature_access schema
bun run setup:maintenance:dry       # Preview maintenance_settings schema
bun run setup:maintenance:apply     # Apply maintenance_settings schema
bun run setup:report-emails:dry     # Preview report_email_settings schema
bun run setup:report-emails:apply   # Apply report_email_settings schema
bun run promote-admin               # Promote a user to admin
```

Migrations, repairs, and backfills follow a `:dry` / `:apply` pair convention:

```bash
bun run migrate:uk:dry                       bun run migrate:uk
bun run migrate:not-interested               bun run migrate:not-interested:apply
bun run migrate:company-names                bun run migrate:company-names:apply
bun run backfill:not-interested-events:dry   bun run backfill:not-interested-events:apply
bun run backfill:lg-handoffs:dry             bun run backfill:lg-handoffs:apply
bun run link:linkedin-leads:dry              bun run link:linkedin-leads:apply --plan=<hash>
```

Note the mixed defaults across script families:
- For `migrate:*`, `backfill:*`, `link:*`, and newer `setup:*` scripts (`setup:crm-access`, `setup:beta-access`, `setup:maintenance`, `setup:report-emails`), the **bare or `:dry`** command is the dry run and `:apply` writes.
- For `setup:appwrite`, `setup:appwrite:targets`, `setup:technical-payments`, `setup:pending-amounts`, and `setup:crm-access:lock`, the **bare** command writes and `:dry` is the preview.
Always read the script's argv handling in [package.json](package.json) before assuming.

`scripts/**` is excluded from `tsconfig.json`, so type errors there will not surface in a normal typecheck. Never commit generated snapshots or previews in `outputs/`.

## Testing

Jest is the real test runner (`jest.config.js`, via `next/jest`, jsdom environment). Tests live in [tests/](tests/) and only files matching `tests/**/*.test.ts(x)` run.

| Directory | Purpose |
|---|---|
| `tests/unit/` | Services, utils, components, per-feature subfolders |
| `tests/integration/` | Cross-layer flows (lead lifecycle, access control, form builder, user management) |
| `tests/property/` | `fast-check` property tests, heavily used for access, hierarchy, and visibility scoping invariants |
| `tests/__mocks__/` | `next/cache` stub (required; the real module breaks under jsdom) |

A `vitest.config.js` also exists and points at the same `tests/**` glob, but nothing in `package.json` invokes it. **Use Jest.** Do not add vitest-only APIs to test files.

`tests/**` is excluded from `tsconfig.json` and has `no-explicit-any` / `no-unused-vars` disabled in the ESLint config.

When changing access rules, role visibility, or lead scoping, add or update a **property test** rather than a single example test. That is the established pattern here.

## Architecture

### Two independent auth systems

1. **Appwrite auth** ([lib/contexts/auth-context.tsx](lib/contexts/auth-context.tsx), [lib/appwrite.ts](lib/appwrite.ts)) for CRM sessions
2. **Azure MSAL** ([lib/msal-config.ts](lib/msal-config.ts), [lib/msal-server-config.ts](lib/msal-server-config.ts)) for Microsoft Graph / Outlook

They are unrelated. A user can be signed into the CRM with no Outlook connection. Never gate CRM behavior on MSAL state or vice versa.

### Provider chain

The actual chain in [app/layout.tsx](app/layout.tsx):

```text
AzureMsalProvider
  → ErrorBoundary
    → AuthProvider
      → CrmSecurityGate
        → QueryProvider
          → AccessControlProvider
            → NotificationProvider
              → AppLayout → children + Toaster
```

`GlobalLoader` sits outside the chain in a `Suspense` boundary. Order matters:
- `CrmSecurityGate` ([components/crm-security-gate.tsx](components/crm-security-gate.tsx)) mounts before `QueryProvider`, `AccessControlProvider`, and `NotificationProvider`, and **does not mount CRM data providers while blocked** by login OTP or attendance/cover approval.
- `QueryProvider` ([app/providers/query-provider.tsx](app/providers/query-provider.tsx)) keeps a single stable provider tree while IndexedDB cache restoration completes to avoid dashboard remounts.
- `AccessControlProvider` reads the authenticated user, and `NotificationProvider` reads access state.

### Security gateway, Email OTP, and daily attendance enforcement

See [docs/crm-access-rollout.md](docs/crm-access-rollout.md) for the full operational specification:

1. **Middleware & Server Gate**: [proxy.ts](proxy.ts), [lib/server/crm-access.ts](lib/server/crm-access.ts), and [lib/utils/crm-access-policy.ts](lib/utils/crm-access-policy.ts) enforce CRM access across pages, API routes, server actions, mail routes, browser CRUD, and change subscriptions when `CRM_ACCESS_ENFORCEMENT === 'true'` (default in [next.config.ts](next.config.ts)).
2. **Appwrite Native Email OTP**: Every CRM login (including `admin`, `developer`, `monitor`, `operations`) requires an Email OTP sent and verified via Appwrite's native Email OTP APIs ([lib/server/crm-security-store.ts](lib/server/crm-security-store.ts)) using project SMTP (never the Google transporter). Before sending, the server verifies the native auth account is active and its email matches the CRM `users` record. Verification creates a temporary Appwrite session that the server immediately deletes before issuing an HttpOnly signed proof cookie (`crm_email_verified`) bound to `(userId, sessionId)` for up to 12 hours (or native session expiry). Challenges expire in 10 minutes, allow 5 attempts, and enforce atomic consumption and rate limits in `security_challenges`.
3. **Daily Attendance & Assigned Cover**:
   - `admin`, `developer`, `monitor`, and `operations` (`ATTENDANCE_EXEMPT_ROLES`) are exempt from daily attendance.
   - All other roles can enter after OTP and self-mark attendance before **10 AM America/New_York**. From 10 AM, they require today's Eastern-date attendance (`present === true`) or approved cover. Duplicate attendance rows fail closed. The server enforces the cutoff; browser `recheckAt` is only a UI scheduling hint.
   - If absent/unmarked **without** an assigned cover (`delegateUserId`), the gate shows instructions to contact their TL/manager and **never** renders a name input.
   - If absent **with** an assigned active same-department cover, the user must enter the assigned cover's matching normalized full name, triggering a second Appwrite OTP to the cover's registered email. Verifying that OTP creates a `pending` row in `crm_access_requests` bound to `(userId, delegateId, dateKey, sessionId, assignedAt)`.
   - A separate authorized TL/manager, `admin`, `developer`, or `operations` user approves or revokes the request in **Attendance → CRM access approvals** ([components/attendance-access-approvals.tsx](components/attendance-access-approvals.tsx)). `monitor` cannot approve, and neither the absent user nor the covering delegate can approve their own request. Approval does **not** mark the absent user present, and has no mark-present control/API.
   - Cover must remain active and present (or exempt). Reassignment, deactivation, revocation, or Eastern midnight invalidates the grant immediately. When acting under approved cover, `effectiveCrmAuditActor` records the covering delegate as the actor in `lead_history` and `leads.history`.
4. **Fast Bootstrap & In-Flight Deduplication**:
   - `/api/auth/appwrite-session` (`bootstrap: true`) and `/api/security/access?view=bootstrap` return the user's own safe profile and fresh access status in a single round-trip. Never trust browser-stored access decisions.
   - Parallel identical identity/database reads in [lib/server/crm-access.ts](lib/server/crm-access.ts) share only their in-flight promise ([lib/utils/in-flight.ts](lib/utils/in-flight.ts)) with **no settled TTL cache**, so revocations and attendance changes take effect immediately on the next request.
   - **Proxy → handler access pass**: after [proxy.ts](proxy.ts) approves a request it forwards a signed, 30-second, server-only `x-crm-access-pass` request header (`assertCrmAccessForProxy`, `signAccessPass`/`readAccessPass` in [lib/server/crm-security-store.ts](lib/server/crm-security-store.ts)). The handler of that **same request** still validates the native Appwrite session, and reuses the proxy's user record and `allowed` decision only when the pass is genuine and bound to that exact account, session and Eastern date. The proxy strips any browser-supplied copy on every path. This removes the duplicate user/attendance reads per request without adding a settled cache: every new request is still checked fresh.
   - **Live change stream** (`/api/security/changes`) verifies access once per connection (connections close after ~55s), not on every 10-second tick. A revoked user's open stream stops within about a minute; pages, data reads and actions are still checked on every request.
   - **Gate re-check cadence**: [components/crm-security-gate.tsx](components/crm-security-gate.tsx) re-checks every minute while a user is waiting (OTP, attendance, cover approval) and every 5 minutes once allowed; focus, `recheckAt`, and `crm-access-recheck` events (dispatched by the stream when blocked) still refresh immediately.
5. **Public & Bypass Boundaries**:
   - Public GET pages (`/login`, `/referral`, `/maintenance`) do **not** exempt server actions POSTed to the same URL (`bypassCrmGate` rejects when `next-action` header is present).
   - Public referral submissions use the dedicated intake-only `POST /api/referrals` endpoint ([app/api/referrals/route.ts](app/api/referrals/route.ts)), which validates origin and payload without allowing CRM reads.

### Three server patterns coexist (and the browser gateway)

| Pattern | Location | SDK | Use for |
|---|---|---|---|
| Client services | [lib/services/](lib/services/) | browser `appwrite` via `/api/appwrite` | Gated reads, branch admin mutations, chunked resume uploads |
| Shared reference lookups | [lib/services/reference-databases.ts](lib/services/reference-databases.ts) | in-process / `/api/appwrite` | `users`, `branches`, `form_config` reads shared by client & server actions |
| Server actions | [app/actions/](app/actions/) | `node-appwrite` admin client | Privileged reads/writes, cross-document checks |
| Route handlers | [app/api/](app/api/) | `node-appwrite` | OAuth callbacks, security gateway, email sending, cron, SSE changes |

Key rules for client vs. server data access:
- **Browser SDK routing**: In [lib/appwrite.ts](lib/appwrite.ts), `account` talks directly to Appwrite Auth, while `databases` and `storage` route through `/api/appwrite` ([app/api/appwrite/[...path]/route.ts](app/api/appwrite/[...path]/route.ts)) and `client.subscribe` uses `/api/security/changes` SSE ([lib/utils/crm-realtime-client.ts](lib/utils/crm-realtime-client.ts)).
- **Browser read restrictions** ([lib/server/crm-browser-data.ts](lib/server/crm-browser-data.ts)): Before OTP/attendance, a user may only read their own safe profile (`users/<own-id>`). After verification, browser reads are limited to `users` (sanitized via `publicUser`, department-scoped for non-leadership, private preferences stripped from other users), `branches`, `form_config`, and `leads` (**leadership only**; non-leadership must use scoped server actions). Browser writes are rejected except `admin`/`developer` mutations on `branches`.
- **Shared reference services**: Services like `user-service`, `branch-service`, and `form-config-service` use `referenceDatabases` ([lib/services/reference-databases.ts](lib/services/reference-databases.ts)) so server actions invoke `readCrmReferenceAction` ([app/actions/crm-reference.ts](app/actions/crm-reference.ts)) in-process rather than making HTTP calls back to localhost or relying on native public Appwrite reads.
- **Resume storage gateway** ([lib/server/crm-resume-gateway.ts](lib/server/crm-resume-gateway.ts), [lib/server/crm-resume-upload.ts](lib/server/crm-resume-upload.ts)): Browser uploads use `Client.CHUNK_SIZE = 2 MiB` parts to fit Vercel request limits. Because Appwrite rejects 2 MiB native `Content-Range` chunks, each part is stored temporarily in `resumes` and tracked in `security_challenges` (`kind: 'resume-upload'`, 1-hour expiry, max 20 MiB total), then assembled server-side with server-selected permissions (`read`/`update`/`delete` for actor, `read` for `teamLeadId`). Resume team members cannot upload lead resumes; `monitor`/`operations` have read-only access.
- **Admin client proxies** ([lib/server/appwrite.ts](lib/server/appwrite.ts)): `createAdminClient()` wraps `databases` in:
  1. `withLeadHistory` ([lib/server/lead-history.ts](lib/server/lead-history.ts)): intercepts `leads` and `linkedin_requests` writes to enforce LinkedIn profile protection, optimistic concurrency (`$updatedAt`), pre-mutation `_ATTEMPT` logging in `lead_history`, and bounded `leads.history` snapshot updates. Internal cron jobs that mutate leads/requests must pass an explicit `systemActor` (e.g., `createAdminClient({ systemActor: ... })`) after validating `CRON_SECRET`.
  2. `withServerOwnedPermissions` ([lib/server/server-owned-permissions.ts](lib/server/server-owned-permissions.ts)): strips any client write/update/delete permissions on `users` and `attendance` documents so roles, activation, and attendance remain strictly server-owned.
  3. `createReadThroughDatabases` ([lib/utils/appwrite-read-cache.ts](lib/utils/appwrite-read-cache.ts)): namespaced read-through cache. Call `invalidateCollectionReads(collectionId)` on write paths.
- **Session client**: `createSessionClient()` resolves a session from `crm_appwrite_jwt` first, then probes only the exact cookie names `a_session_<projectId>`, `a_session_<projectId>_legacy`, and `<projectId>`. **Never** reinstate a catch-all `a_session_*` prefix scan, as anonymous callers could turn one HTTP request with crafted cookies into N Appwrite `/v1/account` calls.

### Authorization in server actions

Server actions run with the **admin** client, which bypasses Appwrite document permissions entirely. Every action must therefore authorize explicitly. Use the helpers in [lib/server/current-user.ts](lib/server/current-user.ts):

- `getAuthenticatedAccount()` for the Appwrite account (automatically runs `assertCrmAccess()` when `CRM_ACCESS_ENFORCEMENT === 'true'` and checks maintenance status)
- `assertAuthenticatedUserId(userId)` when the client passes a user id (never trust it)
- `getAuthenticatedUserDoc()` for the full `User` doc including `department`, `role`, `branchIds`, `primaryBranchId`

`getAuthenticatedUserDoc()` defaults `department` to `'sales'` for legacy rows. Dropping that field has previously locked resume users out of their own pages. Preserve it.

## Data model

### Leads store business data as JSON (plus server-owned `history`)

Lead business fields live in a single `data` string column. Real Appwrite attributes are: `ownerId`, `assignedToId`, `branchId`, `status`, `isClosed`, `closedAt`, `nextFollowUpAt`, `followUpStatus`, and `history`.

```ts
const fields = JSON.parse(lead.data) as LeadData;
```

Consequences to respect:

- You **cannot** query, filter, sort, or project on a field inside `data`. Anything that needs server-side filtering must be promoted to a column.
- List endpoints project columns explicitly (see `LEADS_LIST_SELECT` in [app/actions/lead.ts](app/actions/lead.ts)). The `data` blob still ships because the table renders from it.
- Detail reads return the full document.
- `leads.history` ([lib/utils/lead-history-snapshot.ts](lib/utils/lead-history-snapshot.ts), [lib/server/lead-history.ts](lib/server/lead-history.ts)) is a **server-owned** JSON string column (max 60,000 bytes, up to 100 recent events, kept under 59,000 bytes) updated automatically by `withLeadHistory`. Caller-supplied `history` fields are stripped. The append-only `lead_history` collection retains the complete archive.
- **LinkedIn profile protection** ([docs/12-linkedin-lead-linking-history.md](docs/12-linkedin-lead-linking-history.md), [lib/server/linkedin-lead-protection.ts](lib/server/linkedin-lead-protection.ts)): An existing lead reserves its LinkedIn profile across all companies, agents, URL variants, and request states in `linkedin_lead_registry`. Only a live lead status of **Not Interested** or **Backed Out** releases the profile; withdrawing a LinkedIn request never releases an existing lead.

### Users

Mirrored between Appwrite auth and the `users` collection, with the document ID equal to the account ID.

- `branchIds` (array) and `primaryBranchId` are current. `branchId` (scalar) is **deprecated** but still read for legacy rows.
- Hierarchy has two generations: legacy `managerId` / `teamLeadId` and newer `managerIds` / `assistantManagerIds`. **Read both** when resolving a chain. See [lib/utils/user-hierarchy.ts](lib/utils/user-hierarchy.ts).
- `department` (`'sales'` | `'resume'`) defaults to `'sales'`.
- User mutations from the browser must go through server actions (`updateUserAction`, `deactivateUserAction`, `reactivateUserAction`); only `admin` and `developer` can update user names or emails.

### Collection IDs

Every collection ID is an env-overridable constant in [lib/constants/appwrite.ts](lib/constants/appwrite.ts). Import `COLLECTIONS` and `DATABASE_ID` from there. Some older modules read `process.env.NEXT_PUBLIC_APPWRITE_*_COLLECTION_ID` directly; prefer the constants module in new code.

That file also carries the authoritative comments on non-obvious collections. Read them before touching:

- `security_challenges`: server-only OTP challenges, atomic attempt/rate-limit claims, and temporary chunked resume upload manifests
- `crm_access_requests`: server-only daily attendance cover approval requests (`pending` / `approved` / `denied`)
- `linkedin_lead_registry`: server-only LinkedIn profile reservations (`p_...`) and per-profile operation locks (`l_...`). A withdrawal never releases a lead.
- `lead_history`: append-only lead and LinkedIn request event archive (intents, completions, failures, blocked takeovers); no browser write/update/delete permissions
- `lg_handoffs`: append-only, one row per Lead Gen to Team Lead handoff, never updated
- `not_interested_leads`: event-sourced. Marking a lead not-interested writes a new `active` row and flips the prior one to `reopened`. Reports count only `active` rows in range, attributed to the **previous** owner.
- `monthly_targets` / `monthly_target_assignments` / `target_month_bounds`: team target, its per-agent split, and custom month date bounds
- `pending_amounts`: per (lead, month) remaining balance, cleared at zero
- `call_requests`: Sales to Resume workflow, status `not_called → pending_documents → call_done`, with per-request chat stored as a JSON array
- `resume_chat_messages`: separate table from `chat_messages`, same shape
- `linkedin_daily_stats` / `agent_daily_stats`: daily pre-aggregated caches
- `report_email_settings` / `maintenance_settings` / `beta_feature_access`: server-managed operational settings and per-user beta feature allowlists

## Access control

Enforced at **two layers**, and both are required:

1. **UI**: `CrmSecurityGate` + navigation visibility + the `ProtectedRoute` component, driven by [lib/contexts/access-control-context.tsx](lib/contexts/access-control-context.tsx)
2. **Server**: middleware/gateway (`proxy.ts`, `/api/appwrite`) + explicit role/department/attendance checks in the action or route handler

Hiding a nav item is not security. An action that does not check the actor is open to every authenticated user.

### Roles

| Role | Scope |
|---|---|
| `admin` | Full access, bypasses checks, attendance-exempt |
| `developer` | Same as admin, attendance-exempt |
| `monitor` | Admin-level read visibility, attendance-exempt. **Not read-only**: may close/reopen leads, update own/assigned leads, and mutate client payments. Cannot approve cover requests, set monthly targets, or mutate followup payments. |
| `operations` | Admin-level read visibility, attendance-exempt. Can approve CRM cover requests, but blocked from mutating leads, client payments, monthly targets, and followup payments. |
| `senior_tl` | Hierarchy, reports, team management, leads, attendance, cover approvals for own hierarchy |
| `team_lead` | Own team's agents, team leads, attendance, cover approvals for own hierarchy |
| `agent` | Own leads, LinkedIn outreach |
| `lead_generation` | Create leads and LinkedIn requests, assign to Sales TLs/Senior TLs/Agents only, no history or reports |
| `compliance` | Compliance dashboard and settings |

### Where the rules live

- [lib/constants/component-access.ts](lib/constants/component-access.ts): `COMPONENT_ACCESS`, the role list per component key
- [lib/constants/default-access.ts](lib/constants/default-access.ts): `ComponentKey` and `UserRole` unions plus `DEFAULT_ACCESS_RULES` seed data
- `access_config` collection: runtime overrides on top of the defaults

**Adding a route or role means editing both constants files.** They are separate sources of truth and drift silently.

### The department short-circuit

Several component keys have an **intentionally empty** role list in `COMPONENT_ACCESS`: `resume-dashboard`, `resume-profiles`, `resume-marketing`, `resume-chat`, `resume-hierarchy`, `resume-reports`, `call-requests`, `compliance-dashboard`, `field-management`.

Empty does not mean "nobody". Resume keys open through the `user.department === 'resume'` (or leadership) short-circuit in `AccessControlProvider.canAccess`. Symmetrically, `SALES_ONLY_COMPONENTS` blocks resume users from sales pages regardless of role. Do not "fix" an empty array by populating it.

## Conventions

- **Path alias**: `@/*` maps to the repo root. Use `@/lib/...`, not relative climbs.
- **Data fetching**: `@tanstack/react-query` for server state (query keys in [lib/queries/keys.ts](lib/queries/keys.ts)), `@tanstack/react-table` for tables, `recharts` for charts, `react-hook-form` + `zod` for forms, `zustand` for local stores.
- **UI**: shadcn-style components in [components/ui/](components/ui/), Radix primitives, Tailwind v4, `lucide-react` icons, `framer-motion` for animation. Fonts (`Bebas Neue` and `Plus Jakarta Sans`) are bundled locally under `app/fonts/` so Vercel builds do not depend on remote font fetches.
- **Errors**: use `getAppwriteErrorMessage` ([lib/server/appwrite-errors.ts](lib/server/appwrite-errors.ts)) and `LeadActionError` ([lib/server/lead-errors.ts](lib/server/lead-errors.ts)) rather than leaking raw Appwrite errors to the client.
- **Pagination**: Appwrite caps page size. Use `listAllDocuments` from [lib/server/appwrite-pagination.ts](lib/server/appwrite-pagination.ts) instead of hand-rolling cursor loops.
- **Audit & History**: mutations that matter call `logAction` from [lib/services/audit-service.ts](lib/services/audit-service.ts); lead and LinkedIn request mutations through `createAdminClient()` are automatically recorded in `lead_history` and `leads.history` via `withLeadHistory`.
- **Dates**: the business runs on Eastern time. Use [lib/utils/eastern-date.ts](lib/utils/eastern-date.ts) / [lib/utils/est-date.ts](lib/utils/est-date.ts) and `date-fns`, not raw `Date` arithmetic. KPI math excludes weekday holidays via [lib/utils/holiday-calendar.ts](lib/utils/holiday-calendar.ts).

## Known duplication and traps

- **`lib/services/lead-service.ts` and `app/actions/lead.ts` duplicate lead logic.** Changing lead behavior almost always means editing both. There is a third partial home in [lib/actions/lead-actions.ts](lib/actions/lead-actions.ts) for the not-interested flow.
- Root-level `fix.js`, `fix2.js`, `fix3.js`, `fix4.js`, `fix_duplicates.js`, `fix_tests.js`, `add-attributes.js`, `check_lead.ts`, and `.tmp-followup-*.mjs` are **one-off debugging leftovers**, not part of the app. Do not import from them, do not treat them as reference implementations, and do not extend them.
- [CLAUDE.md](CLAUDE.md) documents an older, shorter provider chain. This file has the current one.
- `docs/` mixes durable architecture and rollout docs (`01-` through `12-`, `crm-access-rollout.md`, `BETA_LINKEDIN_EXTENSION.md`, `API_REFERENCE.md`, `APPWRITE_SCHEMA.md`) with historical task write-ups (`TASK_*.md`, `AUTH_FIX_SUMMARY.md`). Trust the numbered/feature docs and the code; treat the task files as history.
- `.env*` is gitignored. Never commit credentials, and never print `APPWRITE_API_KEY` or an MSAL secret into logs, comments, or tool output.

## Cron jobs

Handlers live under [app/api/cron/](app/api/cron/) and authenticate via `CRON_SECRET`:

| Route | Purpose | Scheduled in `vercel.json` |
|---|---|---|
| `security-cleanup` | Delete expired OTP challenges/claims and incomplete resume upload parts | Yes, `0 6 * * *` |
| `refresh-lead-profile-index` | Incrementally refresh private profile lookup metadata and checkpoint without writing lead documents | Yes, `*/5 * * * *` |
| `linkedin-withdrawal-reminders` | Auto-withdraw stale LinkedIn requests (`systemActor`) and send report | Yes, `0 14 * * 1` |
| `friday-withdrawal-warning` | Warn agents on Friday about upcoming Monday LinkedIn withdrawals | Yes, `0 21 * * 5` |
| `payment-reminders` | Follow up on pending client payments (excludes `fully_paid`, `refunded`, `non_upfront`) | Yes, `0 5 * * 1-5` |
| `partial-paid-reminders` | Follow up on partially paid client payments | Yes, `0 5 * * 1-5` |
| `cleanup-notifications` | Clean up old notifications | Yes, `0 0 * * *` |
| `calendar-reminders` | Send upcoming calendar event reminders | Yes, `*/5 * * * *` |
| `daily-report-summary` | Send daily summary report email | Yes, `0 21 * * 1-5` |
| `target-report` | Send weekly target report email | Yes, `0 22 * * 5` |
| `aggregate-linkedin-stats` | Pre-aggregate daily LinkedIn stats | Yes, `0 4 * * *` |
| `aggregate-agent-stats` | Pre-aggregate daily agent stats | Yes, `0 4 * * *` |
| `resume-sla` | Resume SLA checks ([lib/services/resume-sla-service.ts](lib/services/resume-sla-service.ts)) | **No.** Handler exists but is unscheduled. |

Adding a cron handler requires a matching entry in [vercel.json](vercel.json) or it never fires.

## Deployment

Vercel is the primary target (`vercel.json` supplies the cron schedule). A [Dockerfile](Dockerfile) and [docker-compose.yml](docker-compose.yml) exist for self-hosting. [docs/11-multi-deployment-architecture.md](docs/11-multi-deployment-architecture.md) covers the multi-deployment setup, and [docs/crm-access-rollout.md](docs/crm-access-rollout.md) covers the staged deployment and native Appwrite client-access lock/rollback sequence.

## Working agreements

- **Dry-run first** on anything that mutates Appwrite schema or production data, and show the user the plan before applying.
- **Do not commit or push unless explicitly asked by the user.** You are ONLY allowed to push when the user says to push. Otherwise, you will not. When you do commit, plain messages only, no AI attribution trailers.
- **Ask before every commit and every push.** Show the exact scope and proposed commit message, then get explicit approval for that commit. After committing, ask separately for approval before pushing. Approval for one commit or push does not cover later ones.
- **Verify before claiming done.** `bun run lint` and `bun run test` at minimum; run the dev server for UI changes.
- **When behavior spans layers**, check whether the change is needed in the service, the action, the access constants, and the tests. This codebase's most common defect is updating one of the four.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
