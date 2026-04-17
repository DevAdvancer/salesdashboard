# Architecture And Runtime

## Application Shell

The app is structured as a Next.js App Router project with a shared root layout in `app/layout.tsx`.

The root layout wraps the application in this provider chain:

1. `AzureMsalProvider`
2. `ErrorBoundary`
3. `AuthProvider`
4. `AccessControlProvider`
5. `AppLayout`
6. `Toaster`

This means every authenticated page receives:

- MSAL availability for Azure-related flows
- Global React error handling
- Appwrite auth state
- Access control checks
- Shared navigation shell
- Toast notifications

## Authentication Model

There are two different authentication concerns in this codebase.

### 1. Appwrite User Authentication

Implemented by:

- `lib/appwrite.ts`
- `lib/contexts/auth-context.tsx`
- `app/login/page.tsx`
- `app/signup/page.tsx`

This controls:

- Login
- Signup
- Current CRM session
- Role helper flags such as `isAdmin`, `isManager`, `isTeamLead`, and `isAgent`

### 2. Azure / Outlook Authentication

Implemented by:

- `lib/msal-config.ts`
- `lib/msal-server-config.ts`
- `components/azure-msal-provider.tsx`
- `app/api/auth/login/route.ts`
- `app/api/auth/callback/route.ts`
- `app/api/auth/status/route.ts`

This controls:

- Microsoft sign-in for Graph access
- `Mail.Send` token exchange
- HTTP-only cookie storage for Outlook email features

These two auth systems are related by user experience, but separate in implementation. A CRM user can be logged into the app and still not be connected to Outlook.

## Route Protection

There are two main protection mechanisms.

### App Layout Redirect

`components/app-layout.tsx` redirects unauthenticated users away from non-public routes to `/login`.

Public routes are currently limited to:

- `/login`

### Per-Page Access Guard

`components/protected-route.tsx` wraps protected pages and checks the access-control context by component key.

If the user is unauthorized:

- A permission error toast is shown.
- The user is redirected to a fallback route.

## Access Control Runtime

`lib/contexts/access-control-context.tsx`:

- Loads access rules from Appwrite.
- Keeps them in a `Map`.
- Falls back to hardcoded defaults when a DB rule does not exist.

Important behavior:

- `admin` always has full access.
- `manager`, `assistant_manager`, `team_lead`, and `agent` use default rules plus overrides from `access_config`.

The access-control system drives:

- Navigation visibility
- Protected-route checks
- Settings page behavior

## Client And Server Boundaries

The codebase mixes three backend interaction styles.

### 1. Direct Client SDK Calls

Used in many pages and services through `lib/appwrite.ts`.

Best for:

- Session-aware CRUD
- Pages that already run in the browser
- Simpler UI-driven reads/writes

### 2. Server Actions

Used under `app/actions`.

Best for:

- Privileged Appwrite access
- Safer cross-document checks
- Role-aware operations that should not depend only on browser permissions

### 3. API Route Handlers

Used under `app/api`.

Best for:

- OAuth callback endpoints
- Graph `sendMail` proxying
- Debug and status endpoints

## Data Storage Strategy

### Users

Users are stored in Appwrite auth and also mirrored in the `users` collection. The document ID is usually aligned with the Appwrite account ID.

### Leads

Lead-specific business fields are stored in a serialized JSON string field called `data`.

Stable lead metadata lives alongside that JSON:

- `ownerId`
- `assignedToId`
- `branchId`
- `status`
- `isClosed`
- `closedAt`

### Dynamic Configuration

Two collections drive runtime configurability:

- `form_config`
- `access_config`

## Observability And Error Handling

### UI Error Handling

- `components/error-boundary.tsx`
- `lib/utils/error-handler.ts`
- Toast-based user feedback

### Monitoring

- Sentry is initialized for browser, server, and edge paths.
- Errors are also manually captured from the error utility functions.

## Dashboard Runtime Behavior

`app/dashboard/page.tsx` is one of the most integration-heavy pages. It combines:

- Appwrite auth state
- Outlook connection check
- Lead metrics
- Hierarchy-related user counts
- Branch name resolution
- Financial charts derived from lead JSON values

If this page breaks, it can be because of:

- CRM auth
- Outlook auth
- lead JSON parsing
- user hierarchy data
- branch data

## Architectural Risks To Keep In Mind

### Duplicate Logic Exists

There is meaningful overlap between:

- `lib/services/lead-service.ts`
- `app/actions/lead.ts`

And between:

- `lib/services/user-service.ts`
- `app/actions/user.ts`

That means a behavior change can require updates in more than one place.

### Legacy And New Hierarchy Fields Coexist

Many flows still read `managerId`, while newer flows also write `managerIds` and `assistantManagerIds`. Maintainers should inspect both old and new fields before assuming the hierarchy model is single-parent.
