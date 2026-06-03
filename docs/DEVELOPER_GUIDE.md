# SalesHub CRM — Developer Guide

> **Audience:** Any developer picking up this project for the first time, or existing developers looking for implementation context before adding a new feature.

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Tech Stack](#2-tech-stack)
3. [Local Setup](#3-local-setup)
4. [Environment Variables](#4-environment-variables)
5. [Project Structure](#5-project-structure)
6. [Authentication System](#6-authentication-system)
7. [Role & Access Control](#7-role--access-control)
8. [Database Schema (Appwrite Collections)](#8-database-schema-appwrite-collections)
9. [Core Services](#9-core-services)
10. [API Routes](#10-api-routes)
11. [Key Components](#11-key-components)
12. [Pages & Routes](#12-pages--routes)
13. [Email System](#13-email-system)
14. [Lead Lifecycle & Status Workflow](#14-lead-lifecycle--status-workflow)
15. [LinkedIn Leads Module](#15-linkedin-leads-module)
16. [Attendance System](#16-attendance-system)
17. [Notification System](#17-notification-system)
18. [Form Configuration System](#18-form-configuration-system)
19. [Audit Logging](#19-audit-logging)
20. [Referral System](#20-referral-system)
21. [Testing](#21-testing)
22. [Adding a New Feature — Step-by-Step Guide](#22-adding-a-new-feature--step-by-step-guide)
23. [Known Limitations & Technical Debt](#23-known-limitations--technical-debt)

---

## 1. Project Overview

**SalesHub CRM** (internally called `newpulsecrm`) is a Next.js 16 sales-team management platform. It enables:

- Hierarchical user management (Admin → Team Lead → Agent)
- Lead creation, assignment, tracking, and closure with full audit trail
- LinkedIn outreach tracking per agent
- Referral ingestion from an external public form
- Attendance monitoring with Microsoft 365 presence detection
- In-app announcements & general chat channels
- Technical interview/mock/assessment support tools
- Role-gated feature access (configurable per role in the database)
- Duplicate lead detection across all branches with email alerts

**Backend:** Appwrite (BaaS — database, auth, storage)  
**Email:** Microsoft Graph API (Outlook / Microsoft 365)  
**Error monitoring:** Sentry  
**Deployment:** Docker or direct Node.js

---

## 2. Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 16 (App Router) |
| Language | TypeScript 5 |
| Styling | Tailwind CSS v4 + Vanilla CSS variables |
| UI primitives | Radix UI + custom `components/ui/` |
| Icons | Lucide React |
| Charts | Recharts |
| Forms | React Hook Form + Zod |
| Backend (BaaS) | Appwrite v22 (client SDK) + node-appwrite (server SDK) |
| Auth | Appwrite Email/Password + Azure AD (MSAL) integration |
| Email | Microsoft Graph API (client_credentials flow) |
| Error tracking | Sentry (`@sentry/nextjs`) |
| Tour / Onboarding | Driver.js |
| Testing | Jest + React Testing Library + Vitest |

---

## 3. Local Setup

### Prerequisites

- Node.js ≥ 18
- Bun (or npm — both lock files are present)
- A running Appwrite instance (cloud or self-hosted)
- Azure AD app registration with `Mail.Send` application permission

### Steps

```bash
# 1. Clone the repo
git clone <repo-url>
cd salesdashboard

# 2. Install dependencies
npm install
# or
bun install

# 3. Copy and fill in env vars
cp .env.local.example .env

# 4. Setup Appwrite collections (run once)
npm run setup:appwrite

# 5. Verify setup
npm run verify:appwrite

# 6. Start dev server (runs on port 5000)
npm run dev
```

> The dev server runs on **port 5000** (not 3000), configured in `package.json`.

### Scripts

| Command | Purpose |
|---|---|
| `npm run dev` | Start dev server on port 5000 |
| `npm run build` | Production build |
| `npm run lint` | ESLint |
| `npm run test` | Jest unit tests |
| `npm run test:coverage` | Coverage report |
| `npm run setup:appwrite` | Create all Appwrite collections + indexes |
| `npm run verify:appwrite` | Verify Appwrite schema is correct |
| `npm run promote-admin` | Promote an existing user to admin role |

---

## 4. Environment Variables

All variables must be set in `.env` (or `.env.local`). See `.env.local.example` for the full list.

### Appwrite (Client-side, public)

```env
NEXT_PUBLIC_APPWRITE_ENDPOINT=https://your-appwrite.io/v1
NEXT_PUBLIC_APPWRITE_PROJECT_ID=your-project-id
NEXT_PUBLIC_APPWRITE_DATABASE_ID=crm-database-1

# Collection IDs
NEXT_PUBLIC_APPWRITE_USERS_COLLECTION_ID=users
NEXT_PUBLIC_APPWRITE_LEADS_COLLECTION_ID=leads
NEXT_PUBLIC_APPWRITE_FORM_CONFIG_COLLECTION_ID=form_config
NEXT_PUBLIC_APPWRITE_ACCESS_CONFIG_COLLECTION_ID=access_config
NEXT_PUBLIC_APPWRITE_BRANCHES_COLLECTION_ID=branches
NEXT_PUBLIC_APPWRITE_AUDIT_LOGS_COLLECTION_ID=audit_logs
NEXT_PUBLIC_APPWRITE_LEAD_NOTES_COLLECTION_ID=lead_notes
NEXT_PUBLIC_APPWRITE_COACHING_NOTES_COLLECTION_ID=coaching_notes
NEXT_PUBLIC_APPWRITE_REVIEW_QUEUE_COLLECTION_ID=review_queue
NEXT_PUBLIC_APPWRITE_NOTIFICATIONS_COLLECTION_ID=notifications
NEXT_PUBLIC_APPWRITE_ATTENDANCE_COLLECTION_ID=attendance
NEXT_PUBLIC_APPWRITE_CHAT_MESSAGES_COLLECTION_ID=chat_messages
NEXT_PUBLIC_APPWRITE_CLIENT_PAYMENTS_COLLECTION_ID=client_payments
NEXT_PUBLIC_APPWRITE_LEAD_REQUESTS_COLLECTION_ID=lead_requests
NEXT_PUBLIC_APPWRITE_LINKEDIN_ACCOUNTS_COLLECTION_ID=linkedin_accounts
NEXT_PUBLIC_APPWRITE_LINKEDIN_REQUESTS_COLLECTION_ID=linkedin_requests
NEXT_PUBLIC_APPWRITE_RESUMES_BUCKET_ID=resumes
```

### Appwrite (Server-side, private)

```env
APPWRITE_API_KEY=your-server-api-key
```

### Azure AD / Microsoft Graph

```env
NEXT_PUBLIC_AZURE_TENANT_ID=your-tenant-id
NEXT_PUBLIC_AZURE_CLIENT_ID=your-client-id
AZURE_CLIENT_SECRET=your-client-secret   # SERVER-ONLY — never expose to browser
```

### Email Config

```env
DUPLICATE_ALERT_BCC_EMAIL=admin@yourcompany.com  # BCC for all duplicate alerts
NEXT_PUBLIC_APP_URL=https://your-domain.com       # Used in email links
```

### Sentry

```env
SENTRY_DSN=...
SENTRY_ORG=...
SENTRY_PROJECT=...
```

---

## 5. Project Structure

```
salesdashboard/
├── app/                          # Next.js App Router pages & API routes
│   ├── api/
│   │   ├── auth/                 # Auth endpoints (session sync, MSAL callback)
│   │   ├── cron/                 # Scheduled jobs (payment reminders, LinkedIn reminders)
│   │   ├── assessment/           # Assessment support email endpoints
│   │   └── interview/            # Interview support email endpoints
│   ├── dashboard/                # Dashboard page (role-specific views)
│   ├── leads/                    # Lead list + individual lead detail pages
│   ├── referral/                 # Public referral submission form
│   ├── lead-requests/            # Referral management (admin review)
│   ├── users/                    # User management
│   ├── branches/                 # Branch management
│   ├── audit-logs/               # Audit log viewer
│   ├── linkedin-requests/        # Agent LinkedIn request tracker
│   ├── linkedin-accounts/        # LinkedIn account management
│   ├── linkedin-reports/         # LinkedIn activity reports
│   ├── attendance/               # Attendance tracking
│   ├── chat/                     # Announcement & general chat
│   ├── notifications/            # User notifications
│   ├── coaching-notes/           # Manager coaching notes
│   ├── review-queue/             # Pending item review queue
│   ├── work-queue/               # Agent work queue & follow-ups
│   ├── reports/                  # Weekly performance reports
│   ├── hierarchy/                # Org chart / hierarchy viewer
│   ├── field-management/         # Form field configuration (disabled)
│   ├── settings/                 # User settings
│   ├── mock/                     # Mock interview support
│   ├── assessment-support/       # Assessment email tool
│   ├── interview-support/        # Interview scheduling email tool
│   ├── login/                    # Login page
│   ├── signup/                   # Signup page (disabled)
│   ├── client/                   # Client detail / payment plan pages
│   ├── layout.tsx                # Root layout (providers, fonts)
│   └── globals.css               # Global CSS variables + design tokens
│
├── components/
│   ├── ui/                       # Base UI primitives (Button, Card, Dialog, etc.)
│   ├── dashboard/                # Dashboard-specific components
│   ├── leads/                    # Lead detail components (notes, timeline, follow-up)
│   ├── reports/                  # Weekly report dashboard component
│   ├── navigation.tsx            # Main sidebar navigation
│   ├── navigation-config.ts      # Nav item definitions
│   ├── app-layout.tsx            # App shell layout with sidebar
│   ├── dynamic-lead-form.tsx     # Dynamic form renderer (uses form config)
│   ├── notification-bell.tsx     # Notification badge + dropdown
│   ├── lead-assignment-dropdown.tsx  # Assign lead to user dropdown
│   ├── whats-new-modal.tsx       # Release notes modal
│   ├── protected-route.tsx       # Auth guard component
│   ├── azure-msal-provider.tsx   # MSAL auth context provider
│   ├── error-boundary.tsx        # React error boundary
│   └── attendance-self-toggle.tsx    # Self-attendance toggle
│
├── lib/
│   ├── appwrite.ts               # Appwrite CLIENT SDK instance
│   ├── types/index.ts            # All shared TypeScript types and interfaces
│   ├── contexts/
│   │   ├── auth-context.tsx      # useAuth() — current user, login, logout
│   │   └── access-control-context.tsx  # useAccess() — canAccess() per component key
│   ├── constants/
│   │   ├── appwrite.ts           # DATABASE_ID + COLLECTIONS map
│   │   ├── default-access.ts     # Default role-based access rules table
│   │   ├── default-fields.ts     # Default lead form fields
│   │   ├── component-access.ts   # Component key → access rule helpers
│   │   ├── special-lead-access.ts # Email → special branch access override
│   │   ├── lead-export-access.ts # Roles allowed to export leads
│   │   └── support.ts            # Support email constant
│   ├── services/                 # Client-side business logic (Appwrite client SDK)
│   │   ├── lead-service.ts       # CRUD + list + close/reopen leads
│   │   ├── user-service.ts       # User CRUD, hierarchy queries
│   │   ├── audit-service.ts      # Write & read audit log entries
│   │   ├── form-config-service.ts # Lead form field configuration
│   │   ├── branch-service.ts     # Branch CRUD
│   │   ├── lead-validator.ts     # Duplicate email/phone/LinkedIn detection
│   │   ├── lead-action-service.ts # Lead action tracking
│   │   ├── sop-service.ts        # SOP document service
│   │   ├── client-payment-service.ts  # Client payment plan service
│   │   └── weekly-report-service.ts   # Weekly report aggregation
│   ├── server/                   # Server-only helpers (node-appwrite)
│   │   ├── appwrite.ts           # createSessionClient() + createAdminClient()
│   │   ├── current-user.ts       # Get current user from server session
│   │   ├── email-service.ts      # Microsoft Graph email sender
│   │   ├── notifications.ts      # Server-side notification creation
│   │   ├── appwrite-errors.ts    # Appwrite error code helpers
│   │   └── appwrite-pagination.ts # Paginate Appwrite listDocuments
│   ├── hooks/
│   │   └── use-debounce.ts       # Debounce hook
│   ├── utils/
│   │   ├── lead-status-workflow.ts  # Status transition rules
│   │   ├── appwrite-read-cache.ts   # Read-through caching for Appwrite queries
│   │   ├── appwrite-presences.ts    # Presence (online status) tracking
│   │   ├── linkedin.ts              # LinkedIn URL normalizer
│   │   ├── tour-guide.ts            # Driver.js page tour definitions
│   │   └── ...
│   ├── actions/
│   │   └── lead-actions.ts       # Next.js server actions for lead operations
│   └── msal-config.ts            # MSAL browser configuration
│
├── docs/                         # All project documentation
├── tests/                        # Jest test files
├── scripts/                      # One-off setup scripts (Appwrite provisioning)
├── public/                       # Static assets
├── next.config.ts                # Next.js config (Sentry, redirects)
├── Dockerfile                    # Docker build
└── docker-compose.yml            # Docker compose for local
```

---

## 6. Authentication System

### Overview

Authentication uses **Appwrite Email/Password sessions**. There is no self-service signup — only admins can create accounts for new users. The MSAL (Azure AD) integration is present for presence tracking (Outlook calendar / Teams presence) but is not the primary login mechanism.

### How It Works

```
User enters email/password
      ↓
account.createEmailPasswordSession()  [Appwrite client SDK]
      ↓
account.get() → fetches Appwrite auth account
      ↓
account.createJWT() → creates a short-lived JWT
      ↓
POST /api/auth/appwrite-session  → stores JWT as httpOnly cookie (crm_appwrite_jwt)
      ↓
databases.getDocument(USERS collection, userId) → fetches user profile doc
      ↓
AuthContext stores user in React state
```

### Key Files

| File | Purpose |
|---|---|
| `lib/contexts/auth-context.tsx` | `AuthProvider` + `useAuth()` hook |
| `lib/appwrite.ts` | Appwrite **client** SDK instance |
| `lib/server/appwrite.ts` | `createSessionClient()` + `createAdminClient()` |
| `app/api/auth/appwrite-session/route.ts` | Stores/clears the JWT cookie |
| `app/api/auth/callback/route.ts` | MSAL OAuth callback handler |

### Session Sync

- The client refreshes the server-side JWT cookie every 10 minutes and on window focus.
- `SERVER_SESSION_SYNC_COOLDOWN_MS = 5 minutes` — prevents hammering the server.
- The server reads the cookie in `createSessionClient()` in API routes / server components.

### `useAuth()` Hook Properties

```ts
{
  user: User | null,
  isAdmin: boolean,       // role === 'admin' OR 'developer'
  isDeveloper: boolean,
  isTeamLead: boolean,
  isAgent: boolean,
  isLeadGeneration: boolean,
  loading: boolean,
  login(email, password): Promise<void>,
  logout(): Promise<void>,
  signup(): never,   // Disabled — throws error
}
```

> **Note:** `isManager` and `isAssistantManager` are intentionally `false` in the auth context because those roles have been retired in the active system. The `manager` and `assistant_manager` roles still exist in the type system and DB but new users should not be assigned these roles.

---

## 7. Role & Access Control

### User Roles

| Role | Description |
|---|---|
| `admin` | Full access to everything |
| `developer` | Same access as admin (for dev team) |
| `team_lead` | Manages a team of agents; can see team's leads |
| `agent` | Creates and manages own leads |
| `lead_generation` | Creates leads but no access to closed history or reports |
| `manager` | ⚠️ RETIRED — do not create new managers |
| `assistant_manager` | ⚠️ RETIRED — do not create new assistant managers |

### Access Control System

Access to each navigation section ("component") is controlled by a two-layer system:

1. **Default rules** in `lib/constants/default-access.ts` — a static table of `{ componentKey, role, allowed }` entries.
2. **Database override** in `access_config` collection — admins can override defaults per role via a settings UI.

#### `useAccess()` Hook

```ts
const { canAccess, isLoading } = useAccess();
canAccess('leads');        // true/false for current user's role
canAccess('audit-logs');   // false for agents
```

#### Component Keys

All valid component keys (matching navigation sections and access rules):

```
dashboard, chat, leads, history, user-management, field-management,
settings, branch-management, audit-logs, mock, assessment-support,
interview-support, hierarchy, work-queue, reports, coaching-notes,
review-queue, notifications, attendance, lead-requests,
linkedin-requests, linkedin-account-management, linkedin-reports
```

#### Default Access Matrix (summary)

| Feature | admin | developer | team_lead | agent | lead_generation |
|---|---|---|---|---|---|
| Dashboard | ✅ | ✅ | ✅ | ✅ | ✅ |
| Leads | ✅ | ✅ | ✅ | ✅ | ✅ |
| History | ✅ | ✅ | ✅ | ✅ | ❌ |
| User Management | ✅ | ✅ | ✅ | ❌ | ❌ |
| Branch Management | ✅ | ✅ | ❌ | ❌ | ❌ |
| Audit Logs | ✅ | ✅ | ❌ | ❌ | ❌ |
| Reports | ✅ | ✅ | ❌ | ❌ | ❌ |
| Coaching Notes | ✅ | ✅ | ❌ | ❌ | ❌ |
| LinkedIn Requests | ❌ | ❌ | ❌ | ✅ | ❌ |
| LinkedIn Accounts | ✅ | ✅ | ✅ | ❌ | ❌ |
| Lead Requests | ✅ | ✅ | ❌ | ❌ | ❌ |
| Attendance | ✅ | ✅ | ✅ | ❌ | ❌ |
| Work Queue | ✅ | ✅ | ✅ | ✅ | ❌ |

> Full table: `lib/constants/default-access.ts`

---

## 8. Database Schema (Appwrite Collections)

All collections live in a single Appwrite database. IDs are configured via environment variables.

### `users`

| Field | Type | Notes |
|---|---|---|
| `name` | string | Display name |
| `email` | string | Unique, used for login |
| `role` | enum | See roles above |
| `managerId` | string? | @deprecated — use `managerIds` |
| `managerIds` | string[] | Array of manager user IDs |
| `assistantManagerId` | string? | @deprecated |
| `assistantManagerIds` | string[] | Array of assistant manager IDs |
| `teamLeadId` | string? | Team lead user ID (for agents) |
| `branchIds` | string[] | Assigned branch IDs |
| `branchId` | string? | @deprecated — use `branchIds` |
| `isActive` | boolean | Inactive users cannot log in |

### `leads`

| Field | Type | Notes |
|---|---|---|
| `data` | string | **JSON-serialized** `LeadData` object |
| `status` | string | Current lead status (e.g., "Interested", "Pipeline") |
| `ownerId` | string | User who created the lead |
| `assignedToId` | string? | User currently working the lead |
| `branchId` | string? | Branch this lead belongs to |
| `isClosed` | boolean | Whether the lead has been closed |
| `closedAt` | string? | ISO timestamp of closure |
| `nextFollowUpAt` | string? | ISO timestamp of next follow-up |
| `nextAction` | string? | Text description of next action |
| `lastContactedAt` | string? | ISO timestamp of last contact |
| `followUpStatus` | string? | `pending` / `completed` / `overdue` |

> **Important:** `data` is stored as a JSON string (not a nested object). Always parse it: `JSON.parse(lead.data)`.

### `lead_requests` (Referrals)

| Field | Type | Notes |
|---|---|---|
| `name` | string | Prospect name |
| `email` | string | Required |
| `phone` | string | Required |
| `linkedinProfileUrl` | string | Required |
| `city` | string | |
| `interestedService` | string | |
| `referrerName` | string | Who submitted the referral |
| `notes` | string | |
| `status` | enum | `pending` / `moved` / `rejected` |
| `duplicateMessage` | string? | Set if a duplicate was detected |
| `movedLeadId` | string? | Lead ID if moved to main leads |
| `data` | string | JSON extra data |

### `branches`

| Field | Type | Notes |
|---|---|---|
| `name` | string | Branch display name |
| `isActive` | boolean | |

### `linkedin_accounts`

| Field | Type | Notes |
|---|---|---|
| `assignedUserId` | string | Agent using this account |
| `teamLeadId` | string? | |
| `company` | string | |
| `idName` | string | LinkedIn account display name |
| `accountType` | enum | `main` / `sudo` |
| `mainAccountId` | string? | Parent account if sudo |
| `isActive` | boolean | |
| `licenseType` | string? | |
| `connectionLimit` | number? | |

### `linkedin_requests`

| Field | Type | Notes |
|---|---|---|
| `accountId` | string | Which LinkedIn account sent the request |
| `agentId` | string | |
| `teamLeadId` | string? | |
| `company` | string | Target company |
| `targetUrl` | string | LinkedIn profile URL of target |
| `coldCall` | boolean? | |
| `coldCallPhone` | string? | |
| `dateSent` | string | ISO date |
| `status` | enum | `sent` / `accepted` / `withdrawn` |
| `acceptedAt` | string? | |
| `leadId` | string? | If accepted and converted to lead |
| `withdrawnAt` | string? | |

### `attendance`

| Field | Type | Notes |
|---|---|---|
| `dateKey` | string | `YYYY-MM-DD` |
| `userId` | string | |
| `teamLeadId` | string? | |
| `present` | boolean | |
| `presentAt` | string? | Timestamp when marked present |
| `outlookConnected` | boolean | Whether MS 365 presence was detected |
| `lastSeenAt` | string? | Last activity timestamp |
| `lastSeenPath` | string? | Last page visited |
| `delegateUserId` | string? | Who is covering if absent |
| `absentNotifiedAt` | string? | When TL was notified of absence |
| `adminEscalatedAt` | string? | When escalated to admin |

### `chat_messages`

| Field | Type | Notes |
|---|---|---|
| `channel` | enum | `announcement` / `general` |
| `body` | string | Message text |
| `createdById` | string | |
| `createdByName` | string | |
| `createdAt` | string | |

### `audit_logs`

| Field | Type | Notes |
|---|---|---|
| `action` | string | e.g., `LEAD_CREATE`, `USER_UPDATE` |
| `actorId` | string | |
| `actorName` | string | |
| `targetId` | string? | |
| `targetType` | string | e.g., `LEAD`, `USER` |
| `metadata` | string? | JSON-serialized extra data |
| `performedAt` | string | ISO timestamp |

### `notifications`

| Field | Type | Notes |
|---|---|---|
| `recipientId` | string | |
| `type` | string | Notification type key |
| `title` | string | |
| `body` | string | |
| `targetId` | string? | ID of related entity |
| `targetType` | string? | |
| `readAt` | string? | Null = unread |
| `createdAt` | string | |

### `form_config`

Singleton-pattern collection. Documents accessed by fixed IDs:

| Document ID | Form |
|---|---|
| `current` | Main lead creation form |
| `closure` | Lead closure form |
| `payment_plan` | Payment plan form |
| `client_intake` | Client intake form |

Each document has: `fields` (JSON array of `FormField`), `version` (int), `updatedBy` (userId).

### `lead_notes`, `coaching_notes`, `review_queue`, `client_payments`

See `lib/types/index.ts` for full interfaces.

---

## 9. Core Services

All services in `lib/services/` use the **Appwrite client SDK** (`lib/appwrite.ts`). They are called from client components and Next.js server actions.

### `lead-service.ts`

The most important file. Handles all lead operations.

#### `createLead(ownerId, input, creatingUserId?, creatingUserName?)`

1. Validates uniqueness via `validateLeadUniqueness()`
2. Builds Appwrite permission list (owner + hierarchy managers)
3. Creates document in `leads` collection
4. Logs `LEAD_CREATE` to audit log

#### `updateLead(leadId, data, actorId?, actorName?)`

1. Fetches current lead
2. Merges current data with updates
3. Validates status transition rules (via `isAllowedLeadStatusTransition()`)
4. Re-validates uniqueness (excluding self)
5. Updates document
6. Logs `LEAD_UPDATE`

#### `listLeads(filters, userId, userRole, branchIds?)`

Role-based visibility scoping:
- `admin` / `developer`: see all leads (no filter)
- `team_lead`: own leads + agents' leads
- `manager` / `assistant_manager`: hierarchical visibility (walks user tree)
- `agent`: own leads + leads assigned to them
- `lead_generation`: only own leads

#### `closeLead(leadId, closedStatus, actorId?, actorName?, actorRole?)`

Sets `isClosed=true`, `closedAt`, updates status, restricts permissions to read-only for agent.

#### `reopenLead(leadId, actorId?, actorName?)`

Restores `isClosed=false` and restores agent update permissions.

---

### `user-service.ts`

Manages user CRUD and hierarchy queries.

#### Key functions

| Function | Description |
|---|---|
| `createTeamLead(input, currentUser?)` | Creates a team_lead account + Appwrite auth |
| `createAgent(input, currentUser?)` | Creates an agent account, infers managerId from teamLead |
| `getUserById(userId)` | Fetches user by ID with ID format validation |
| `getUserByIdOrNull(userId)` | Same but returns null on 404 |
| `getAssignableUsers(creatorRole, creatorBranchIds, creatorId?)` | Returns users that the creator can assign a lead to |
| `getAgentsByTeamLead(teamLeadId)` | All agents under a team lead |
| `getUsersByBranches(branchIds)` | All users in given branches |
| `updateUserRole(userId, role)` | Admins can change any user's role |
| `deactivateUser(userId, currentUser)` | Sets `isActive=false` (user cannot log in) |
| `getSubordinates(userId)` | Returns all users below in hierarchy |

> `createManager()` and `createAssistantManager()` both throw immediately — those roles are retired.

---

### `audit-service.ts`

Simple fire-and-log pattern.

```ts
await logAction({
  action: 'LEAD_CREATE',
  actorId: user.$id,
  actorName: user.name,
  targetId: lead.$id,
  targetType: 'LEAD',
  metadata: { leadName: 'John Smith' },
});
```

Audit log actions: `USER_CREATE`, `USER_UPDATE`, `USER_DELETE`, `LEAD_CREATE`, `LEAD_UPDATE`, `LEAD_DELETE`, `FORM_CONFIG_UPDATE`, `SETTINGS_UPDATE`, `BRANCH_CREATE`, `BRANCH_UPDATE`, `LOGIN`, `LOGOUT`, `MOCK_EMAIL_SENT`, `INTERVIEW_EMAIL_SENT`, `ASSESSMENT_EMAIL_SENT`.

---

### `lead-validator.ts`

Checks for duplicates before creating or updating a lead.

- Paginates through ALL leads (up to 10,000 documents)
- Normalizes email (lowercase), phone (strip non-digits, handle US +1 prefix), LinkedIn URL (canonicalize path)
- Returns `{ isValid: false, duplicateField, existingLeadId, existingBranchId }` if a duplicate is found

> **Performance note:** This is O(n) over all leads. For very large databases (>10k leads), consider adding a dedicated index or a background dedup service.

---

### `form-config-service.ts`

Manages the dynamic form field configuration for lead creation/editing.

- `getFormConfig()` — main lead form
- `getClosureFormConfig()` — closure form
- `getPaymentPlanFormConfig()` — payment plan form
- `getClientIntakeFormConfig()` — client intake form
- `updateFormConfig()` — **currently disabled** (throws error)
- Returns defaults if no DB document found (graceful fallback)

---

### `branch-service.ts`

Standard CRUD for branch management (admin only).

---

## 10. API Routes

All routes under `app/api/`.

### Auth

| Route | Method | Description |
|---|---|---|
| `/api/auth/appwrite-session` | POST | Accepts `{ jwt }`, stores as `crm_appwrite_jwt` httpOnly cookie |
| `/api/auth/appwrite-session` | DELETE | Clears the JWT cookie (logout) |
| `/api/auth/login` | POST | Server-side login (alternative flow) |
| `/api/auth/callback` | GET | MSAL OAuth2 callback |
| `/api/auth/status` | GET | Returns current session status |

### Cron Jobs

| Route | Schedule | Description |
|---|---|---|
| `/api/cron/payment-reminders` | Configurable | Sends payment reminder emails for overdue payment plans |
| `/api/cron/linkedin-withdrawal-reminders` | Configurable | Reminds agents to withdraw stale LinkedIn requests |

### Other

| Route | Description |
|---|---|
| `/api/assessment` | Sends assessment support email via Graph API |
| `/api/interview` | Sends interview scheduling email via Graph API |
| `/api/debug-config` | Debug endpoint (dev only) |
| `/api/mock` | Mock interview support email endpoint |

---

## 11. Key Components

### `Navigation` (`components/navigation.tsx`)

The main sidebar. Reads access rules via `useAccess()` to show/hide nav items.

- Collapsible sidebar (icon-only mode)
- Mobile hamburger menu
- Grouped nav sections: "LinkedIn Leads", "Technical Section", "Chatting"
- Per-page tour guide integration (Driver.js)
- Notification bell in header

### `AppLayout` (`components/app-layout.tsx`)

The root shell wrapping all authenticated pages. Renders `Navigation` + main content area.

### `DynamicLeadForm` (`components/dynamic-lead-form.tsx`)

Renders a lead creation/editing form driven by the form config from Appwrite. Field types: `text`, `email`, `phone`, `dropdown`, `textarea`, `checklist`. Handles validation and submission.

### `NotificationBell` (`components/notification-bell.tsx`)

Polls for unread notifications and displays a dropdown list. Clicking a notification marks it read and navigates to the relevant page.

### `LeadAssignmentDropdown` (`components/lead-assignment-dropdown.tsx`)

Dropdown to assign/reassign a lead to a user. Filters assignable users based on the current user's role and branch.

### Dashboard Components (`components/dashboard/`)

| Component | Description |
|---|---|
| `LeadershipDashboard` | High-level stats for admins/team leads — lead counts by status, agent performance |
| `RoleWorkDashboard` | Work queue summary for agents |
| `FollowUpQueue` | Leads with overdue/upcoming follow-ups |
| `FinancialInsightsChart` | Revenue/pipeline chart (Recharts) |

### Lead Components (`components/leads/`)

| Component | Description |
|---|---|
| `LeadActivityTimeline` | Chronological audit trail for a lead |
| `LeadNotesCard` | Create/view lead notes with visibility controls |
| `LeadFollowUpCard` | Set next follow-up date and action |

---

## 12. Pages & Routes

### Public Routes (no auth required)

| Route | Description |
|---|---|
| `/login` | Email/password login |
| `/referral` | Public referral submission form (no login needed) |

### Protected Routes (auth required)

| Route | Description |
|---|---|
| `/dashboard` | Home page after login — role-specific view |
| `/leads` | Lead list with filters |
| `/leads/new` | Create new lead form |
| `/leads/[id]` | Lead detail — edit, close, notes, timeline |
| `/client/[id]` | Client payment plan detail |
| `/history` | Closed leads history |
| `/work-queue` | Agent's pending follow-ups |
| `/users` | User management (admin/team_lead) |
| `/branches` | Branch management (admin) |
| `/hierarchy` | Org chart viewer |
| `/attendance` | Attendance tracking |
| `/lead-requests` | Referral review queue (admin) |
| `/linkedin-requests` | Agent's LinkedIn outreach tracker |
| `/linkedin-accounts` | LinkedIn account management |
| `/linkedin-reports` | LinkedIn activity reports |
| `/chat/announcement` | Announcement channel |
| `/chat/general` | General chat |
| `/notifications` | All notifications |
| `/coaching-notes` | Manager coaching notes |
| `/review-queue` | Pending review items |
| `/reports` | Weekly performance reports |
| `/audit-logs` | System audit log |
| `/mock` | Mock interview support |
| `/assessment-support` | Assessment email tool |
| `/interview-support` | Interview scheduling tool |
| `/settings` | User settings |
| `/field-management` | Form field editor (access-gated; currently disabled) |

---

## 13. Email System

Emails are sent via **Microsoft Graph API** using app-only credentials (client_credentials OAuth2 flow).

### `lib/server/email-service.ts`

The only email type currently implemented:

**`sendDuplicateAlertEmail(input)`**
- Triggered when a user tries to create/update a lead with a duplicate email, phone, or LinkedIn URL
- Sends FROM the acting user's Outlook mailbox
- Sends TO: all admins + team leads (excluding the actor)
- BCCs: `DUPLICATE_ALERT_BCC_EMAIL` env var (default: `abhirupvizva@gmail.com`)
- HTML + plain text format

### How to Add a New Email Type

1. Add a new exported function in `lib/server/email-service.ts`
2. Define the input interface
3. Call `getGraphAccessToken()` to get a bearer token
4. POST to `https://graph.microsoft.com/v1.0/users/{senderEmail}/sendMail`
5. Call your function from a Server Action or API route (never from a client component)

> All email functions must be in server-only files (`lib/server/`). Do not import them in client components.

---

## 14. Lead Lifecycle & Status Workflow

### Statuses

The main lead statuses (set in form config `options` for the `status` field):
- `New` (initial)
- `Interested`
- `Not Interested`
- `Pipeline` / `Pipeline Follow-Up`
- `Prospect`
- `Signed` / `Signed Closure`
- `Backed Out`

### Status Transition Rules

Defined in `lib/utils/lead-status-workflow.ts`. Enforced in `updateLead()`.

Key restriction: certain final statuses (e.g., `Signed Closure`, `Backed Out`) cannot be changed once set, unless the lead is reopened. LinkedIn-sourced leads have stricter transition rules.

### Lead Permissions (Appwrite document-level)

| Event | Owner | Assigned Agent | Managers (hierarchy) |
|---|---|---|---|
| On creation | read + update + delete | read + update | read + update |
| On closure | read + update + delete | read only | read + update |
| On reopen | read + update + delete | read + update | read + update |

---

## 15. LinkedIn Leads Module

Consists of three sections:

1. **LinkedIn Requests** (`/linkedin-requests`) — agents log outreach to LinkedIn profiles. Each request tracks: account used, target URL, date sent, status (`sent` / `accepted` / `withdrawn`), and optionally links to a lead when accepted.

2. **LinkedIn Account Management** (`/linkedin-accounts`) — admins and team leads manage which LinkedIn accounts agents use. Supports `main` and `sudo` account types.

3. **LinkedIn Reports** (`/linkedin-reports`) — aggregated outreach stats.

### Withdrawal Reminder Cron

`/api/cron/linkedin-withdrawal-reminders` — runs on schedule and sends reminders to agents who have LinkedIn requests stuck in `sent` status past a configurable threshold.

---

## 16. Attendance System

Tracks daily attendance per user.

- Each record is keyed by `dateKey` (`YYYY-MM-DD`) + `userId`
- Users can self-mark present via `AttendanceSelfToggle` component
- Team leads can mark agents present
- System tracks `lastSeenAt` and `lastSeenPath` for presence detection
- Microsoft 365 presence is optionally integrated via MSAL
- If absent by a threshold time, TL is notified; escalates to admin if unresolved

---

## 17. Notification System

### Creating a Notification (Server-side)

```ts
// lib/server/notifications.ts
await createNotification({
  recipientId: userId,
  type: 'LEAD_ASSIGNED',
  title: 'New lead assigned to you',
  body: `Lead for John Smith has been assigned to you.`,
  targetId: leadId,
  targetType: 'LEAD',
});
```

### Reading Notifications (Client-side)

The `NotificationBell` component polls the `notifications` collection for unread items (`readAt == null`) for the current user.

Clicking a notification calls `markNotificationRead(notificationId)` and navigates to the relevant entity.

---

## 18. Form Configuration System

The lead form is dynamically driven by the `form_config` Appwrite collection.

### Form Config Document Structure

```json
{
  "fields": "[{\"id\":\"1\",\"type\":\"text\",\"label\":\"First Name\",\"key\":\"firstName\",...}]",
  "version": 3,
  "updatedBy": "userId123"
}
```

### Field Types

| Type | Renders as |
|---|---|
| `text` | `<input type="text">` |
| `email` | `<input type="email">` |
| `phone` | `<input type="tel">` |
| `dropdown` | `<select>` |
| `textarea` | `<textarea>` |
| `checklist` | Multi-checkbox group |

### Adding a New Form Field

1. Update the relevant `DEFAULT_*_FIELDS` array in `lib/services/form-config-service.ts`
2. The field will appear in the form immediately (no DB update needed for defaults)
3. If field management is re-enabled, admin can push updates to the `form_config` collection

> **Note:** `updateFormConfig()` is currently disabled (throws "Field management is disabled"). To re-enable: remove the `throw` statement and `void` suppressors in that function.

---

## 19. Audit Logging

Every significant action is logged via `logAction()` in `lib/services/audit-service.ts`.

### Logged Actions

| Action | Triggered by |
|---|---|
| `LEAD_CREATE` | `createLead()` |
| `LEAD_UPDATE` | `updateLead()`, `closeLead()`, `reopenLead()` |
| `LEAD_DELETE` | `deleteLead()` |
| `USER_CREATE` | `createTeamLead()`, `createAgent()` |
| `USER_UPDATE` | `updateUser()`, `updateUserRole()` |
| `USER_DELETE` | `deactivateUser()` |
| `LOGIN` | Login page |
| `LOGOUT` | Logout handler |
| `MOCK_EMAIL_SENT` | Mock support tool |
| `INTERVIEW_EMAIL_SENT` | Interview support tool |
| `ASSESSMENT_EMAIL_SENT` | Assessment support tool |

### Viewing Logs

`/audit-logs` page (admin/developer only) — searchable, filterable by actor, target type, and date range.

---

## 20. Referral System

### Public Form (`/referral`)

- **No login required** — publicly accessible
- Collects: name, email, phone, LinkedIn URL, city, interested service, referrer name, notes
- Validates on submission:
  - Email, phone, and LinkedIn URL are **required**
  - Checks for duplicates within existing `lead_requests` (pending referrals)
  - Checks for duplicates against existing `leads` in the main database
  - If duplicate found: saves with `duplicateMessage` set; does NOT silently drop
- Includes dark/light mode toggle icon

### Admin Review (`/lead-requests`)

Admins review pending referrals:
- **Move to Leads**: Converts the referral to a full lead in the `leads` collection
- **Reject**: Sets status to `rejected`
- Duplicate referrals are shown with a warning indicator

---

## 21. Testing

### Running Tests

```bash
npm run test             # Run all Jest tests
npm run test:watch       # Watch mode
npm run test:coverage    # With coverage report
```

### Test Files

Located in `tests/` directory. Uses:
- **Jest** as the test runner
- **React Testing Library** for component tests
- **@testing-library/user-event** for interactions
- **Vitest** config also present (`vitest.config.js`) but Jest is primary

### Writing Tests

```ts
// Example: testing a service function
import { validateLeadUniqueness } from '@/lib/services/lead-validator';

jest.mock('@/lib/appwrite', () => ({
  databases: {
    listDocuments: jest.fn().mockResolvedValue({ documents: [], total: 0 }),
  },
  DATABASE_ID: 'test-db',
  COLLECTIONS: { LEADS: 'leads' },
}));

test('returns valid when no duplicates exist', async () => {
  const result = await validateLeadUniqueness({ email: 'new@test.com' });
  expect(result.isValid).toBe(true);
});
```

---

## 22. Adding a New Feature — Step-by-Step Guide

This guide walks through the typical steps for adding a new feature module (e.g., a new reporting section).

### Step 1: Define the Type

Add your interfaces to `lib/types/index.ts`:

```ts
export interface MyNewEntity {
  $id: string;
  name: string;
  // ... other fields
}
```

### Step 2: Create the Appwrite Collection

- Add the collection ID constant to `lib/constants/appwrite.ts`:
  ```ts
  export const COLLECTIONS = {
    // ... existing
    MY_NEW_COLLECTION: process.env.NEXT_PUBLIC_APPWRITE_MY_NEW_COLLECTION_ID ?? 'my_new_collection',
  };
  ```
- Add the env var to `.env` and `.env.local.example`
- Create the collection in Appwrite console or add it to `scripts/setup-appwrite.ts`

### Step 3: Create the Service

Create `lib/services/my-new-service.ts`:

```ts
import { databases, DATABASE_ID, COLLECTIONS } from '@/lib/appwrite';
import { MyNewEntity } from '@/lib/types';

export async function createMyEntity(data: Partial<MyNewEntity>): Promise<MyNewEntity> {
  const doc = await databases.createDocument(
    DATABASE_ID,
    COLLECTIONS.MY_NEW_COLLECTION,
    'unique()',
    data
  );
  return doc as unknown as MyNewEntity;
}

export async function listMyEntities(): Promise<MyNewEntity[]> {
  const res = await databases.listDocuments(DATABASE_ID, COLLECTIONS.MY_NEW_COLLECTION);
  return res.documents as unknown as MyNewEntity[];
}
```

### Step 4: Add the Navigation Item

In `components/navigation-config.ts`, add your entry:

```ts
{ key: 'my-feature', label: 'My Feature', href: '/my-feature', icon: SomeIcon }
```

Add the new `ComponentKey` value to:
- `lib/types/index.ts` — `ComponentKey` union type
- `lib/constants/default-access.ts` — access rules per role

### Step 5: Create the Page

Create `app/my-feature/page.tsx`:

```tsx
import { AppLayout } from '@/components/app-layout';

export default function MyFeaturePage() {
  return (
    <AppLayout>
      <div>
        {/* Your page content */}
      </div>
    </AppLayout>
  );
}
```

### Step 6: Add Access Control

In `lib/constants/default-access.ts`, add access rules:

```ts
{ componentKey: 'my-feature', role: 'admin', allowed: true },
{ componentKey: 'my-feature', role: 'developer', allowed: true },
{ componentKey: 'my-feature', role: 'team_lead', allowed: false },
{ componentKey: 'my-feature', role: 'agent', allowed: false },
{ componentKey: 'my-feature', role: 'lead_generation', allowed: false },
```

### Step 7: Write Tests

Add tests in `tests/my-feature.test.ts`.

### Step 8: Add Audit Logging (if needed)

If your feature modifies important data, add an `AuditLogAction` entry in `lib/types/index.ts` and call `logAction()` in your service.

---

## 23. Known Limitations & Technical Debt

### 1. Duplicate Detection Performance

`lead-validator.ts` fetches ALL leads via pagination and checks client-side. For large datasets (>10k leads) this will be slow. **Fix:** Add a dedicated server action or background job that maintains a deduplication index.

### 2. Retired Roles

`manager` and `assistant_manager` roles are still in the type system and DB schema, but their creation functions throw immediately. The access control logic and hierarchy queries still reference them for legacy data. **Fix:** Eventually migrate all legacy users to active roles and remove the role types.

### 3. Form Field Management Disabled

`updateFormConfig()` always throws. The field management UI exists but is blocked at the service layer. **Fix:** Remove the throw statement when ready to re-enable.

### 4. Search Is Client-Side

The `listLeads()` function applies `searchQuery` filtering client-side after fetching all leads. Appwrite doesn't support full-text search on JSON fields. **Fix:** Consider Appwrite's full-text index feature on extracted fields, or a separate search service.

### 5. Lead Data Is a JSON Blob

All custom lead fields are stored in a single `data` JSON string. This makes indexed filtering on field values impossible at the DB level. **Fix:** For frequently filtered fields (status is already a top-level field), consider promoting them to indexed Appwrite attributes.

### 6. `getHierarchyPermissions()` Walks the Tree in Real-Time

On every lead creation, the system walks up the org hierarchy to build Appwrite document permissions. With deep hierarchies this makes multiple sequential Appwrite reads. **Fix:** Cache or pre-compute hierarchy permissions.

### 7. No Pagination in Lead List

`listLeads()` uses `Query.limit(5000)`. For very large teams this hits Appwrite limits. **Fix:** Implement proper cursor-based pagination in the UI.

---

*Last updated: June 2026 | Maintainer: DevAdvancer team*
