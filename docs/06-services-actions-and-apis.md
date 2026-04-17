# Services, Actions, And APIs

## Why This Layer Matters

Most maintainers will spend their time in one of these places:

- `lib/services/*` for client-side business logic
- `app/actions/*` for server actions
- `app/api/*` for route handlers

Because similar business rules appear in more than one layer, changes here require extra care.

## Client Services In `lib/services`

## `audit-service.ts`

Responsibilities:

- Create audit records.
- Query audit records with filters.

Used by:

- lead operations
- user creation/update operations
- form configuration publishing
- history and audit log pages

## `branch-service.ts`

Responsibilities:

- Create branches
- Read branches
- Update branch name and active status
- Delete branches with guards
- Compute branch stats

Important detail:

- The service currently checks `branchId` for manager-related guards/stats, while most user creation logic stores branch membership in `branchIds`.

## `form-config-service.ts`

Responsibilities:

- Load the singleton form config
- Return default fields when config is missing
- Update and version the configuration
- Diff changes for audit logging
- Add/remove/reorder/toggle fields

## `lead-service.ts`

Responsibilities:

- Create leads
- Update leads
- Delete leads
- Get one lead
- List leads with role-aware visibility
- Close leads
- Reopen leads
- Assign leads

Important behaviors:

- Duplicate email/phone check before create/update
- Hierarchy-based Appwrite permissions on lead documents
- Closed leads reduce assignee access to read-only

## `lead-validator.ts`

Responsibilities:

- Cross-lead duplicate detection for email and phone

Important detail:

- Since lead content is stored inside serialized JSON, the validator first narrows candidates with `Query.contains('data', [value])` and then parses JSON to confirm exact matches.

## `user-service.ts`

Responsibilities:

- Create managers, assistant managers, team leads, and agents
- Update role and reporting fields
- Resolve hierarchy relationships
- Fetch assignable users
- Fetch agents, managers, assistant managers, and team leads
- Fetch subordinates
- Handle manager-to-branch assignment changes
- Build default CC recipient lists for support-request email workflows

Important behaviors:

- Multiple managers are supported through `managerIds`
- Assistant managers can also sit in the manager chain
- Agent creation may inherit hierarchy from assigned team lead
- Support-request CC logic is centralized so mock, assessment, and interview flows stay consistent

## Server Actions In `app/actions`

## `lead.ts`

Contains:

- `createLeadAction`
- `reopenLeadAction`
- `listLeadsAction`

Why it exists:

- Uses `node-appwrite` admin access
- Repeats hierarchy-aware permission logic on the server
- Avoids relying only on browser-side privileges for sensitive operations

## `user.ts`

Contains:

- `createAssistantManagerAction`
- `createManagerAction`
- `createTeamLeadAction`
- `createAgentAction`
- `updateUserAction`

Why it exists:

- Centralizes privileged user creation
- Validates current actor
- Logs audit actions
- Manages multi-manager and multi-assistant-manager relationships

## `mock.ts`

Contains:

- `getMockAttempts`
- `recordMockAttempt`

Purpose:

- Track retry limits and cooldown for mock emails

## `assessment.ts`

Contains:

- `getAssessmentAttempts`
- `checkDuplicateSubject`
- `recordAssessmentAttempt`

Purpose:

- Prevent duplicate assessment requests with identical subjects

## `interview.ts`

Contains:

- `getInterviewAttempts`
- `checkDuplicateInterviewSubject`
- `recordInterviewAttempt`

Purpose:

- Prevent duplicate interview requests with identical subjects

## Route Handlers In `app/api`

## Auth Routes

- `/api/auth/login`
- `/api/auth/callback`
- `/api/auth/status`

These handle Azure/Graph token flow and cookie-based status checking.

## Email Proxy Routes

- `/api/mock/send-email`
- `/api/assessment/send-email`
- `/api/interview/send-email`

These routes:

- read `outlook_access_token` from cookies
- forward request payloads to Microsoft Graph `/me/sendMail`
- return JSON success/error responses

## Debug / Example Routes

- `/api/debug-config`
- `/api/sentry-example-api`

These are support or debug surfaces rather than core business APIs.

## Utility Modules Worth Knowing

## `lib/server/appwrite.ts`

Provides:

- `createSessionClient()`
- `createAdminClient()`

This is the main server-side bridge into Appwrite using either cookies or API key auth.

## `lib/utils/form-schema-generator.ts`

Provides:

- Zod schema generation from stored form config
- default form values
- visible field filtering

## `lib/utils/error-handler.ts`

Provides:

- API error normalization
- permission and network error handling
- toast integration
- Sentry reporting hooks

## `lib/utils/branch-visibility.ts`

Provides:

- filtered branch visibility for showing user branch data to viewers with narrower access

## `lib/actions/lead-actions.ts`

Contains assignment action helpers used from the lead detail page.

## Script Files In `scripts`

## `reopen-lead-worker.ts`

Purpose:

- Manual repair/worker script to reopen a lead and restore permissions using `node-appwrite`

Typical use:

- Emergency repair or one-off maintenance

## `update-role-enum.ts`

Purpose:

- Update the Appwrite `role` enum attribute to include:
  - `admin`
  - `manager`
  - `assistant_manager`
  - `team_lead`
  - `agent`

## How To Decide Where A Change Belongs

Use this rule of thumb:

- UI-only change: component or page
- Shared browser-side business logic: `lib/services`
- Privileged Appwrite mutation or server trust boundary: `app/actions`
- External HTTP integration or OAuth callback: `app/api`

## Important Maintenance Warning

Lead and user business rules are duplicated between client services and server actions. Before shipping changes to:

- visibility rules
- permission building
- hierarchy traversal
- duplicate checks

search both `lib/services` and `app/actions` so the behavior does not drift further.
