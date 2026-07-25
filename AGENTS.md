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
bun run setup:appwrite:dry     # Report schema changes without writing
bun run setup:appwrite         # Apply collections + backfill user.department
bun run sync:appwrite:dry      # Same script, alternate alias
bun run setup:appwrite:targets # Monthly targets collections
bun run promote-admin          # Promote a user to admin
```

Migrations and backfills follow a `:dry` / `:apply` pair convention:

```bash
bun run migrate:uk:dry                       bun run migrate:uk
bun run migrate:not-interested               bun run migrate:not-interested:apply
bun run migrate:company-names                bun run migrate:company-names:apply
bun run backfill:not-interested-events:dry   bun run backfill:not-interested-events:apply
bun run backfill:lg-handoffs:dry             bun run backfill:lg-handoffs:apply
```

Note the inverted default: for `migrate:*` and `backfill:*`, the **bare** command is the dry run and `:apply` writes. For `setup:*`, the bare command writes and `:dry` is the preview. Read the script's argv handling before assuming.

`scripts/**` is excluded from `tsconfig.json`, so type errors there will not surface in a normal typecheck.

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
      → QueryProvider
        → AccessControlProvider
          → NotificationProvider
            → AppLayout → children + Toaster
```

`GlobalLoader` sits outside the chain in a `Suspense` boundary. Order matters: `AccessControlProvider` reads the authenticated user, and `NotificationProvider` reads access state.

### Three server patterns coexist

| Pattern | Location | SDK | Use for |
|---|---|---|---|
| Client services | [lib/services/](lib/services/) | browser `appwrite` | Session-aware CRUD from the browser |
| Server actions | [app/actions/](app/actions/) | `node-appwrite` admin client | Privileged reads/writes, cross-document checks |
| Route handlers | [app/api/](app/api/) | `node-appwrite` | OAuth callbacks, email sending, cron, streaming list endpoints |

Server-only helpers live in [lib/server/](lib/server/). Get an Appwrite client from `createAdminClient()` or `createSessionClient()` in [lib/server/appwrite.ts](lib/server/appwrite.ts). Both return databases wrapped in a **read-through cache** ([lib/utils/appwrite-read-cache.ts](lib/utils/appwrite-read-cache.ts)), namespaced per credential. If you add a write path, make sure the corresponding cache namespace is invalidated.

`createSessionClient()` resolves a session from the `crm_appwrite_jwt` cookie first, then falls back to scanning `a_session_*` cookies and probing each one. Do not hardcode a cookie name.

### Authorization in server actions

Server actions run with the **admin** client, which bypasses Appwrite document permissions entirely. Every action must therefore authorize explicitly. Use the helpers in [lib/server/current-user.ts](lib/server/current-user.ts):

- `getAuthenticatedAccount()` for the Appwrite account
- `assertAuthenticatedUserId(userId)` when the client passes a user id (never trust it)
- `getAuthenticatedUserDoc()` for the full `User` doc including `department`, `role`, `branchIds`

`getAuthenticatedUserDoc()` defaults `department` to `'sales'` for legacy rows. Dropping that field has previously locked resume users out of their own pages. Preserve it.

## Data model

### Leads store business data as JSON

Lead business fields live in a single `data` string column. Only metadata is a real Appwrite attribute: `ownerId`, `assignedToId`, `branchId`, `status`, `isClosed`, `closedAt`, `nextFollowUpAt`, `followUpStatus`.

```ts
const fields = JSON.parse(lead.data) as LeadData;
```

Consequences to respect:

- You **cannot** query, filter, sort, or project on a field inside `data`. Anything that needs server-side filtering must be promoted to a column.
- List endpoints project columns explicitly (see `LEADS_LIST_SELECT` in [app/actions/lead.ts](app/actions/lead.ts)). The `data` blob still ships because the table renders from it.
- Detail reads return the full document.

### Users

Mirrored between Appwrite auth and the `users` collection, with the document ID equal to the account ID.

- `branchIds` (array) is current. `branchId` (scalar) is **deprecated** but still read for legacy rows.
- Hierarchy has two generations: legacy `managerId` / `teamLeadId` and newer `managerIds` / `assistantManagerIds`. **Read both** when resolving a chain. See [lib/utils/user-hierarchy.ts](lib/utils/user-hierarchy.ts).
- `department` (`'sales'` | `'resume'`) defaults to `'sales'`.

### Collection IDs

Every collection ID is an env-overridable constant in [lib/constants/appwrite.ts](lib/constants/appwrite.ts). Import `COLLECTIONS` and `DATABASE_ID` from there. Some older modules read `process.env.NEXT_PUBLIC_APPWRITE_*_COLLECTION_ID` directly; prefer the constants module in new code.

That file also carries the authoritative comments on non-obvious collections. Read them before touching:

- `lg_handoffs`: append-only, one row per Lead Gen to Team Lead handoff, never updated
- `not_interested_leads`: event-sourced. Marking a lead not-interested writes a new `active` row and flips the prior one to `reopened`. Reports count only `active` rows in range, attributed to the **previous** owner.
- `monthly_targets` / `monthly_target_assignments`: team target and its per-agent split
- `pending_amounts`: per (lead, month) remaining balance, cleared at zero
- `call_requests`: Sales to Resume workflow, status `not_called → pending_documents → call_done`, with per-request chat stored as a JSON array
- `resume_chat_messages`: separate table from `chat_messages`, same shape

## Access control

Enforced at **two layers**, and both are required:

1. **UI**: navigation visibility plus the `ProtectedRoute` component, driven by [lib/contexts/access-control-context.tsx](lib/contexts/access-control-context.tsx)
2. **Server**: explicit role/department checks in the action or route handler, plus Appwrite document permissions on session-scoped reads

Hiding a nav item is not security. An action that does not check the actor is open to every authenticated user.

### Roles

| Role | Scope |
|---|---|
| `admin` | Full access, bypasses checks |
| `developer` | Same as admin |
| `monitor` | Admin-level read visibility, no mutations |
| `operations` | Broad read plus operational access, no admin mutations |
| `team_lead` | Own team's agents, team leads, attendance |
| `agent` | Own leads, LinkedIn outreach |
| `lead_generation` | Create leads only, no history or reports |

### Where the rules live

- [lib/constants/component-access.ts](lib/constants/component-access.ts): `COMPONENT_ACCESS`, the role list per component key
- [lib/constants/default-access.ts](lib/constants/default-access.ts): `ComponentKey` and `UserRole` unions plus `DEFAULT_ACCESS_RULES` seed data
- `access_config` collection: runtime overrides on top of the defaults

**Adding a route or role means editing both constants files.** They are separate sources of truth and drift silently.

### The department short-circuit

Several component keys have an **intentionally empty** role list in `COMPONENT_ACCESS`: `resume-dashboard`, `resume-profiles`, `resume-marketing`, `resume-chat`, `resume-hierarchy`, `resume-audit-logs`, `call-requests`, `field-management`.

Empty does not mean "nobody". These open only through the `user.department === 'resume'` short-circuit in `AccessControlProvider.canAccess`. Symmetrically, `SALES_ONLY_COMPONENTS` blocks resume users from sales pages regardless of role. Do not "fix" an empty array by populating it.

## Conventions

- **Path alias**: `@/*` maps to the repo root. Use `@/lib/...`, not relative climbs.
- **Data fetching**: `@tanstack/react-query` for server state (query keys in [lib/queries/keys.ts](lib/queries/keys.ts)), `@tanstack/react-table` for tables, `recharts` for charts, `react-hook-form` + `zod` for forms, `zustand` for local stores.
- **UI**: shadcn-style components in [components/ui/](components/ui/), Radix primitives, Tailwind v4, `lucide-react` icons, `framer-motion` for animation.
- **Errors**: use `getAppwriteErrorMessage` ([lib/server/appwrite-errors.ts](lib/server/appwrite-errors.ts)) and `LeadActionError` ([lib/server/lead-errors.ts](lib/server/lead-errors.ts)) rather than leaking raw Appwrite errors to the client.
- **Pagination**: Appwrite caps page size. Use `listAllDocuments` from [lib/server/appwrite-pagination.ts](lib/server/appwrite-pagination.ts) instead of hand-rolling cursor loops.
- **Audit**: mutations that matter call `logAction` from [lib/services/audit-service.ts](lib/services/audit-service.ts).
- **Dates**: the business runs on Eastern time. Use [lib/utils/eastern-date.ts](lib/utils/eastern-date.ts) / [lib/utils/est-date.ts](lib/utils/est-date.ts) and `date-fns`, not raw `Date` arithmetic. KPI math excludes weekday holidays via [lib/utils/holiday-calendar.ts](lib/utils/holiday-calendar.ts).

## Known duplication and traps

- **`lib/services/lead-service.ts` and `app/actions/lead.ts` duplicate lead logic.** Changing lead behavior almost always means editing both. There is a third partial home in [lib/actions/lead-actions.ts](lib/actions/lead-actions.ts) for the not-interested flow.
- Root-level `fix.js`, `fix2.js`, `fix3.js`, `fix4.js`, `fix_duplicates.js`, `fix_tests.js`, `add-attributes.js`, `check_lead.ts`, and `.tmp-followup-*.mjs` are **one-off debugging leftovers**, not part of the app. Do not import from them, do not treat them as reference implementations, and do not extend them.
- [CLAUDE.md](CLAUDE.md) documents an older, shorter provider chain. This file has the current one.
- `docs/` mixes durable architecture docs (`01-` through `11-`, `API_REFERENCE.md`, `APPWRITE_SCHEMA.md`) with historical task write-ups (`TASK_*.md`, `AUTH_FIX_SUMMARY.md`). Trust the numbered docs and the code; treat the task files as history.
- `.env*` is gitignored. Never commit credentials, and never print `APPWRITE_API_KEY` or an MSAL secret into logs, comments, or tool output.

## Cron jobs

Handlers live under [app/api/cron/](app/api/cron/):

| Route | Purpose | Scheduled in `vercel.json` |
|---|---|---|
| `linkedin-withdrawal-reminders` | Nudge agents to withdraw stale LinkedIn requests | Yes, `0 5 * * *` |
| `payment-reminders` | Follow up on pending client payments | Yes, `0 5 * * *` |
| `partial-paid-reminders` | Follow up on partially paid client payments | Yes, `0 5 * * *` |
| `resume-sla` | Resume SLA checks ([lib/services/resume-sla-service.ts](lib/services/resume-sla-service.ts)) | **No.** Handler exists but is unscheduled. |

Adding a cron handler requires a matching entry in [vercel.json](vercel.json) or it never fires.

## Deployment

Vercel is the primary target (`vercel.json` supplies the cron schedule). A [Dockerfile](Dockerfile) and [docker-compose.yml](docker-compose.yml) exist for self-hosting. [docs/11-multi-deployment-architecture.md](docs/11-multi-deployment-architecture.md) covers the multi-deployment setup.

## Working agreements

- **Dry-run first** on anything that mutates Appwrite schema or production data, and show the user the plan before applying.
- **Do not commit or push** unless asked. When you do commit, plain messages only, no AI attribution trailers.
- **Verify before claiming done.** `bun run lint` and `bun run test` at minimum; run the dev server for UI changes.
- **When behavior spans layers**, check whether the change is needed in the service, the action, the access constants, and the tests. This codebase's most common defect is updating one of the four.
