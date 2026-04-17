# Routes And User Flows

## Route Inventory

## Public And Entry Routes

| Route | Purpose | Notes |
| --- | --- | --- |
| `/` | Entry redirect page | Sends users to dashboard, login, or Azure callback continuation |
| `/login` | CRM login | Uses Appwrite email/password auth |
| `/signup` | Initial manager signup | Creates a manager by default |

## Main Protected Routes

| Route | Component Key | Purpose | Notes |
| --- | --- | --- | --- |
| `/dashboard` | `dashboard` | Main landing page after login | Combines metrics, role summary, hierarchy stats, and Outlook check |
| `/leads` | `leads` | Active leads list | Filtering, pagination, optional CSV export for one hardcoded user |
| `/leads/new` | `leads` | Lead creation | Dynamic form + duplicate check + assignment |
| `/leads/[id]` | `leads` | Lead detail/edit page | Edit, assign, close, reopen |
| `/client` | `history` | Closed lead history | Read-only list of closed leads |
| `/client/[id]` | `history` | Closed lead detail | Read-only client record with reopen flow |
| `/users` | `user-management` | User management | Create and update hierarchy users |
| `/branches` | `branch-management` | Branch management | Create/edit/toggle/delete branches |
| `/field-management` | `field-management` | Dynamic field configuration | Publish versioned form config |
| `/settings` | `settings` | Redirects to access settings | No UI by itself |
| `/settings/access` | `settings` | Access-rule editor | Admin and manager-oriented access configuration |
| `/audit-logs` | `audit-logs` | Audit log viewer | Admin-focused |
| `/mock` | `mock` | Mock interview support workflow | Outlook email flow |
| `/assessment-support` | `assessment-support` | Assessment support workflow | Outlook email flow with subject dedupe |
| `/interview-support` | `interview-support` | Interview support workflow | Outlook email flow with subject dedupe |
| `/hierarchy` | `hierarchy` | Hierarchy tree view | Manager/admin visualization |

## Utility / Debug Routes

| Route | Purpose | Notes |
| --- | --- | --- |
| `/auth-test` | Inspect auth context state | Manual debug page |
| `/test-auth` | Manual Appwrite auth/db test harness | Development-only helper |
| `/sentry-example-page` | Sentry sample page | Monitoring test surface |

## API Routes

| Route | Method | Purpose |
| --- | --- | --- |
| `/api/auth/login` | `GET` | Starts Azure auth code flow |
| `/api/auth/callback` | `GET` | Exchanges code for Graph token and stores cookies |
| `/api/auth/status` | `GET` | Returns whether Outlook token cookie exists |
| `/api/mock/send-email` | `POST` | Proxies Graph `sendMail` for mock emails |
| `/api/assessment/send-email` | `POST` | Proxies Graph `sendMail` for assessment emails |
| `/api/interview/send-email` | `POST` | Proxies Graph `sendMail` for interview emails |
| `/api/debug-config` | `GET` | Debug config endpoint |
| `/api/sentry-example-api` | `POST/GET depending on sample` | Sentry sample endpoint |

## Primary User Flows

## 1. Login Flow

1. User opens `/login`.
2. `useAuth().login()` calls Appwrite `createEmailPasswordSession`.
3. The auth context fetches the matching user document from the `users` collection.
4. The page redirects to `/dashboard`.

## 2. Initial Signup Flow

1. User opens `/signup`.
2. The form validates name, email, password, and confirmation.
3. `AuthProvider.signup()` creates:
   - an Appwrite auth account
   - a `users` collection document with role `manager`
4. A session is created and the user is redirected to `/dashboard`.

This means self-signup is currently a manager bootstrap path.

## 3. Create Lead Flow

1. User opens `/leads/new`.
2. Page loads current form config from Appwrite.
3. `DynamicLeadForm` builds validation from the stored field configuration.
4. Assignment dropdown is shown only for non-agents.
5. Duplicate email/phone check runs before creation.
6. Lead is created through `createLeadAction`.
7. Owner and assignment permissions are generated.
8. User is redirected back to `/leads`.

## 4. Active Lead Lifecycle

1. Lead is listed in `/leads`.
2. User opens `/leads/[id]`.
3. User may edit dynamic fields.
4. Manager can change assignee.
5. User can close the lead with a final status.
6. Closed leads move to `/client`.
7. Manager/admin can reopen the lead.

## 5. Closed Lead / Client History Flow

1. `/client` loads only `isClosed = true` leads.
2. The page resolves who closed a lead by inspecting audit log metadata.
3. `/client/[id]` shows a read-only detail view.
4. Manager can reopen the lead from the client detail page.

## 6. User Management Flow

The `/users` screen supports:

- Creating managers
- Creating assistant managers
- Creating team leads
- Creating agents
- Editing role and reporting relationships
- Selecting branches

The page behavior changes based on the current viewer's role:

- Admin sees all users.
- Manager sees users in their branches, with filtering.
- Assistant manager sees subordinates.
- Team lead sees their agents.

## 7. Branch Management Flow

The `/branches` page supports:

- Branch creation
- Branch rename
- Active/inactive toggle
- Delete with guard checks
- Viewing assigned managers and lead counts

## 8. Dynamic Form Builder Flow

The `/field-management` page supports:

- Adding custom fields
- Editing label, key, type, placeholder, options, and validation
- Reordering fields
- Hiding or requiring fields
- Previewing the visible form
- Publishing the config with version increment

Important implementation detail:

- Core fields such as `firstName`, `email`, `phone`, `amount`, `legalName`, and `ssnLast4` are protected from removal in the manager UI flow.

## 9. Access Configuration Flow

The `/settings/access` page:

- Loads access rules from `access_config`
- Shows effective defaults when no explicit rule exists
- Updates Appwrite documents immediately on toggle
- Refreshes access context after writes

## 10. Outlook Support Email Flows

All three support pages follow the same shape:

1. User visits mock/assessment/interview support page.
2. Page checks `/api/auth/status`.
3. User connects Outlook if needed.
4. Page loads visible leads.
5. User opens a dialog for a selected lead.
6. Form pre-fills candidate data from lead JSON.
7. Attachments are converted to base64 in the browser.
8. Payload is sent to a Next API route.
9. API route forwards the message to Microsoft Graph.
10. Attempt tracking is written back to Appwrite.

Differences:

- If the sender is a `manager`, the CC list defaults to empty.
- If the sender is an `assistant_manager`, the CC list defaults to that assistant manager's manager email(s).
- For other roles, the existing broader CC behavior is retained.
- Mock flow enforces cooldown and max attempts.
- Assessment flow allows repeats but blocks duplicate subjects.
- Interview flow allows repeats but blocks duplicate subjects.

## 11. Hierarchy Visualization Flow

The `/hierarchy` page builds a tree from user documents and presents:

- Managers at the root for admins
- Current manager as the root for a manager
- Assistant managers, team leads, and agents nested below
- Unassigned agents in a separate card
