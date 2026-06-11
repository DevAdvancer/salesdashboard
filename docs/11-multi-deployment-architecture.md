# Multi-Region Deployment Architecture (US + UK)

## Overview

The CRM is being extended to serve two separate regions — **US** and **UK** — from a **single Appwrite project** with **two databases**. Each region has its own deployment of the Next.js app, its own user base, and its own data. There is **no cross-region data access** and **no runtime scope switching**.

```
┌─────────────────────────────────────────────────────┐
│         Appwrite Project (shared, one)              │
│  ┌──────────────────┐  ┌──────────────────┐         │
│  │  crm-database-1  │  │   crm-database   │         │
│  │  (US region)     │  │   (UK region)    │         │
│  │  users, leads,   │  │  users, leads,   │         │
│  │  branches, ...   │  │  branches, ...   │         │
│  └──────────────────┘  └──────────────────┘         │
│  Auth accounts (project-level, shared)              │
└─────────────────────────────────────────────────────┘
         ▲                       ▲
         │                       │
    ┌────┴─────┐            ┌────┴─────┐
    │ US App   │            │ UK App   │
    │ (Vercel) │            │ (Vercel) │
    │ Env:     │            │ Env:     │
    │ crm-db-1 │            │ crm-db   │
    └──────────┘            └──────────┘
   us.app.example.com     uk.app.example.com
```

## Why This Design

| Decision | Reason |
|---|---|
| **One Appwrite project** | Single auth system, single billing, single console. Auth identities can exist in both DBs if needed (e.g., a global admin). |
| **Two databases** | Structural isolation. A bug in code cannot read across regions — the data is in different namespaces. |
| **Two deployments** | Region-separation at the URL/DNS layer. A US director never accidentally sees UK data. |
| **No scope switcher** | Different directors, different teams. The UX of "switch to the other team's data" is a liability, not a feature. |
| **Same codebase** | Both deployments are the same Next.js app, built from the same commit, deployed with different env vars. Zero drift. |

## What Stays the Same

- **Codebase** — one repo, one CI pipeline, one `package.json`.
- **Auth** — Appwrite Auth is project-level. A user logs in once per deployment.
- **All existing code** — `DATABASE_ID` is already sourced from `process.env.NEXT_PUBLIC_APPWRITE_DATABASE_ID` in `lib/constants/appwrite.ts`. No code changes are needed for the runtime path.
- **Schema definitions** — both DBs use the same 21-collection schema, defined in `scripts/lib/schema-definitions.ts` (new) and applied by the migration script.

## What Changes

1. **UK database is created** with the same schema as US.
2. **A new env var convention** is added for clarity.
3. **Two Vercel deployments** are configured, each with its own env vars.
4. **DNS** points two subdomains to the two deployments.
5. **No user-creation dropdown** — each deployment creates users in its own database automatically.

## Implementation Steps

### Step 1: Create the UK database schema

Run the new migration script to create all 21 collections, attributes, and indexes in `crm-database`:

```bash
# Preview (read-only)
bun run migrate:uk -- --dry-run

# Apply
bun run migrate:uk
```

The script is defined in [scripts/migrate-uk-database.ts](../scripts/migrate-uk-database.ts). It uses the shared schema definitions in [scripts/lib/schema-definitions.ts](../scripts/lib/schema-definitions.ts) so the US and UK DBs always stay in sync.

> **Important:** The migration script is **read-only** against `crm-database-1` (it never reads or writes to the US DB). It only writes to `crm-database`. This protects US data by construction.

### Step 2: Configure env vars per deployment

The codebase already reads `NEXT_PUBLIC_APPWRITE_DATABASE_ID` from env. To support two deployments with explicit per-region naming, add two new env vars (the old one remains as a fallback):

```bash
# .env.local (US deployment)
NEXT_PUBLIC_APPWRITE_DATABASE_ID=crm-database-1
NEXT_PUBLIC_APPWRITE_DATABASE_ID_US=crm-database-1
NEXT_PUBLIC_APPWRITE_DATABASE_ID_UK=crm-database
```

In `lib/constants/appwrite.ts`, the existing `DATABASE_ID` is unchanged. The new vars are documentation and future-proofing for scripts and tooling that need to reference both DBs explicitly.

### Step 3: Deploy twice on Vercel

Create two Vercel projects from the same repo:

| Project | Domain | Env var |
|---|---|---|
| `saleshub-crm-us` | `us.app.example.com` | `NEXT_PUBLIC_APPWRITE_DATABASE_ID=crm-database-1` |
| `saleshub-crm-uk` | `uk.app.example.com` | `NEXT_PUBLIC_APPWRITE_DATABASE_ID=crm-database` |

All other env vars (endpoint, project ID, API key) are **identical** between the two projects. The only difference is the `DATABASE_ID`.

### Step 4: Configure DNS

In your DNS provider:

| Record | Type | Value |
|---|---|---|
| `us.app.example.com` | CNAME | `cname.vercel-dns.com` (Vercel auto-issued) |
| `uk.app.example.com` | CNAME | `cname.vercel-dns.com` (Vercel auto-issued) |

Vercel will issue SSL certificates automatically once DNS propagates.

### Step 5: Create the first UK admin

Log into `uk.app.example.com` as the first admin:

1. Manually create an Appwrite Auth account in the project (Appwrite console → Auth → Create user). Use a strong password and store it in your team's password manager.
2. In the `users` collection of `crm-database`, create a document with:
   - `$id` = the Appwrite Auth account ID
   - `name` = the admin's display name
   - `email` = the admin's email
   - `role` = `admin`
   - `isActive` = `true`
3. The admin can now log in at `uk.app.example.com` and start creating UK users via the existing create-user dialog.

> **Why this is manual:** Appwrite Auth accounts are project-level, but the user document in the `users` collection is per-database. The first UK user must be bootstrapped in the Appwrite console because there is no in-app flow that can create an auth account AND a user doc in a brand-new database (the create-user flow assumes a user is already logged in).

## What the Code Looks Like

The codebase already supports this — no runtime code changes are required. The single line:

```ts
// lib/constants/appwrite.ts (unchanged)
export const DATABASE_ID = process.env.NEXT_PUBLIC_APPWRITE_DATABASE_ID ?? 'crm-database-1';
```

is the **only** place the database ID is configured. The build-time env var determines which database the deployment talks to. Everything else in the codebase already reads from this constant.

## What About Cross-Region Admins?

A user who needs access to both regions (e.g., a global leadership role) is created **separately** in each deployment:

1. They have one Appwrite Auth account (project-level).
2. They have a `users` document in `crm-database-1` (US) with role `admin`.
3. They have a `users` document in `crm-database` (UK) with role `admin`.
4. They log into `us.app.example.com` to manage US data, and `uk.app.example.com` to manage UK data.

There is **no** in-app "switch region" button. Region separation is enforced by URL.

## Future Regions

To add a third region (e.g., APAC):

1. Run the migration script with a `--target-db` flag pointing at the new database ID.
2. Create a third Vercel project with `NEXT_PUBLIC_APPWRITE_DATABASE_ID=crm-database-apac`.
3. Add a third DNS record.
4. Bootstrap the first APAC admin in the Appwrite console.

No application code changes are required. The pattern scales linearly.

## Migration Script

See [scripts/migrate-uk-database.ts](../scripts/migrate-uk-database.ts) for the full implementation. The script:

1. Connects to Appwrite using the admin API key.
2. Verifies the target database (`crm-database`) exists. Creates it if not.
3. For each of the 21 collections:
   - Creates the collection if it doesn't exist.
   - Creates all required attributes (string, email, enum, boolean, datetime, integer).
   - Waits for attributes to become available (Appwrite indexes asynchronously).
   - Creates all required indexes.
4. Skips anything that already exists (idempotent).
5. Reports a summary at the end.

## Verification

### After running the migration script

```bash
bun run migrate:uk -- --dry-run   # preview
bun run migrate:uk                 # apply
```

Open the Appwrite console → Databases → `crm-database` → confirm all 21 collections are present with attributes and indexes.

### After deploying

1. Log into `us.app.example.com` as a US admin. Confirm you see US data.
2. Log into `uk.app.example.com` as the bootstrapped UK admin. Confirm the dashboard loads with no data (fresh DB).
3. Create a UK agent. Confirm the user doc appears in `crm-database` users collection and **not** in `crm-database-1`.
4. Create a US agent (from a US admin account on the US deployment). Confirm it appears in `crm-database-1` only.
5. Confirm that a US admin account cannot log into the UK deployment (their user doc is in the US DB only, so the UK deployment's auth flow will reject them).

## Risks

| Risk | Mitigation |
|---|---|
| UK admin forgets which URL is which | The deployment's brand/title can be customized per region (e.g., "SalesHub — US" vs "SalesHub — UK") |
| US admin tries to create a UK user | Impossible — the US deployment can only create users in `crm-database-1`. UK creation happens on the UK deployment. |
| Schema drift between US and UK | The migration script and the existing US sync script both read from `scripts/lib/schema-definitions.ts`. Schema changes go in one place. |
| Migration script fails halfway | The script is idempotent. Re-running it picks up where it left off. Each collection, attribute, and index has a try/catch around its creation. |
| Migration script accidentally touches US data | The script targets `crm-database` only. It never calls any method with `crm-database-1` as the first argument. |

## Out of Scope

- Cross-region data sharing (intentionally excluded — different directors, different teams).
- A unified login URL (intentionally excluded — region separation is the goal).
- Per-record tenant IDs in a single database (the design is full-database separation, not row-level).
- Moving historical US data to UK (UK starts empty).
