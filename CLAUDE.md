# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Common Commands

```bash
bun run dev              # Start dev server → http://localhost:5000
bun run build            # Production build
bun run lint             # ESLint check
bun run test             # Jest tests
bun run test:watch       # Watch mode
bun run test:coverage   # With coverage report
bun run setup:appwrite  # Initialize Appwrite collections (run once)
# docker-compose up --build  # Docker build, runs on port 5000
```

## Architecture Overview

This is a **Next.js 16 App Router CRM** with two separate authentication systems:

### Authentication Systems

1. **Appwrite Auth** (`lib/contexts/auth-context.tsx`, `lib/appwrite.ts`) — CRM user sessions
2. **Azure/MSAL Auth** (`lib/msal-config.ts`, `lib/msal-server-config.ts`) — Microsoft Graph/Outlook access

The two auth systems are independent. A user can be logged into the CRM without being connected to Outlook.

### Provider Chain

The root layout wraps every page through this provider sequence:

```
AzureMsalProvider → ErrorBoundary → AuthProvider → AccessControlProvider → AppLayout → Toaster
```

See [app/layout.tsx](app/layout.tsx) for the exact implementation.

### Data Storage Strategy

- **Leads**: Business fields stored in JSON `data` string field, not individual columns. Metadata fields (`ownerId`, `assignedToId`, `branchId`, `status`) are stable columns.
- **Users**: Stored in Appwrite auth + mirrored in `users` collection. Document ID aligns with Appwrite account ID.
- **Dynamic config**: `form_config` and `access_config` collections drive runtime behavior.

### Access Control Enforcement

Two layers work together:

1. **UI layer**: Navigation visibility + `ProtectedRoute` component checks via `access-control-context.tsx`
2. **Database layer**: Appwrite document-level permissions

Never rely on UI hiding alone — enforce at both layers.

### Server Patterns

Three patterns coexist for backend operations:

| Pattern | Location | Use For |
|---|---|---|
| Client SDK | `lib/services/*.ts` | Session-aware CRUD, browser-side operations |
| Server Actions | `app/actions/*.ts` | Privileged access, cross-document checks |
| API Routes | `app/api/**/route.ts` | OAuth callbacks, email proxying, cron jobs |

### Important Code Patterns

**Lead data access**: Use `JSON.parse(lead.data)` to read lead fields. Never assume individual Appwrite attributes for lead business data.

**User hierarchy**: Legacy (`managerId`) and new (`managerIds`, `assistantManagerIds`) fields coexist. Read both when checking hierarchy.

**API vs Client**: Server actions use `node-appwrite` (admin client). Client services use browser Appwrite SDK.

## Key Directories

| Directory | Purpose |
|---|---|
| `app/actions/` | Server actions with privileged Appwrite access |
| `app/api/` | Route handlers (OAuth, email proxy, cron) |
| `app/leads/`, `app/users/`, etc. | Page routes |
| `lib/services/` | Client-side business logic (browser SDK) |
| `lib/server/` | Server-only helpers (node-appwrite, email) |
| `lib/contexts/` | React contexts (Auth, AccessControl) |
| `lib/constants/` | Collection IDs, access rules |
| `lib/types/` | TypeScript interfaces |
| `components/` | Shared React components |
| `scripts/` | One-off setup scripts |

## Collection IDs

Stored in [lib/constants/appwrite.ts](lib/constants/appwrite.ts). Default IDs:

- `users`, `leads`, `branches`, `form_config`, `access_config`
- `audit_logs`, `lead_notes`, `coaching_notes`, `review_queue`
- `notifications`, `attendance`, `chat_messages`
- `mock_attempts`, `assessment_attempts`, `interview_attempts`
- `linkedin_accounts`, `linkedin_requests`, `client_payments`, `lead_requests`

## Cron Jobs

Automated jobs run via API routes under `app/api/cron/`:

- `linkedin-withdrawal-reminders/` — Reminds agents to withdraw stale LinkedIn requests
- `payment-reminders/` — Follows up on pending client payments

## User Roles

| Role | Scope |
|---|---|
| `admin` | Full access (bypasses all checks) |
| `developer` | Same as admin |
| `team_lead` | Manage agents, see team leads, attendance |
| `agent` | Own leads only, LinkedIn outreach |
| `lead_generation` | Create leads only, no history/reports |

## Known Patterns to Maintain

- Lead `data` is JSON string — always parse before reading fields
- Duplicate logic exists between `lib/services/lead-service.ts` and `app/actions/lead.ts` — update both when changing lead behavior
- Two auth systems are independent — CRM auth != Outlook auth
- Tests use Jest (configured in `jest.config.js`)
- Dev server runs on **port 5000** (not 3000)
