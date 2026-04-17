# Data Model And Permissions

## Core Collections

The application relies on Appwrite collections more than on a traditional backend API.

## `users`

Purpose:

- Stores CRM profile metadata for Appwrite auth users.

Important fields used in code:

| Field | Type | Notes |
| --- | --- | --- |
| `$id` | string | Usually matches the Appwrite auth user ID |
| `name` | string | Display name |
| `email` | string | Login and display identity |
| `role` | enum/string | `admin`, `manager`, `assistant_manager`, `team_lead`, `agent` |
| `managerId` | string or null | Legacy primary manager |
| `managerIds` | string[] | New multi-manager support |
| `assistantManagerId` | string or null | Legacy field |
| `assistantManagerIds` | string[] | New multi-assistant-manager support |
| `teamLeadId` | string or null | Agent-to-team-lead link |
| `branchIds` | string[] | Main branch linkage used by current code |
| `branchId` | string or null | Legacy single-branch field still read in some places |

## `leads`

Purpose:

- Stores active and closed lead/client records.

Important fields:

| Field | Type | Notes |
| --- | --- | --- |
| `$id` | string | Lead document ID |
| `data` | string | JSON-serialized dynamic lead payload |
| `status` | string | Business status |
| `ownerId` | string | Creator / owner |
| `assignedToId` | string or null | Current assignee |
| `branchId` | string or null | Branch context |
| `isClosed` | boolean | Active vs client history |
| `closedAt` | string or null | Closure timestamp |
| `$permissions` | string[] | Important for Appwrite document visibility |

## `form_config`

Purpose:

- Stores the dynamic lead form configuration.

Important details:

- Implemented as a singleton document with ID `current`.
- Field definitions are stored as a JSON string in `fields`.
- Versioning is tracked with `version`.
- `updatedBy` stores the actor.

## `access_config`

Purpose:

- Stores component-level access overrides by role.

Important fields:

| Field | Type |
| --- | --- |
| `componentKey` | string |
| `role` | string |
| `allowed` | boolean |

## `branches`

Purpose:

- Stores the branch catalog.

Important fields:

| Field | Type |
| --- | --- |
| `name` | string |
| `isActive` | boolean |

## `audit_logs`

Purpose:

- Stores historical action records.

Important fields:

| Field | Type |
| --- | --- |
| `action` | string |
| `actorId` | string |
| `actorName` | string |
| `targetId` | string or null |
| `targetType` | string |
| `metadata` | string or null |
| `performedAt` | ISO string |

## Attempt Collections

Purpose:

- Track outbound support workflow attempts for leads.

Collections referenced by code:

- `mock_attempts`
- `assessment_attempts`
- `interview_attempts`

The exact schema is inferred from usage and includes:

- `leadId`
- `userId`
- `attemptCount`
- `lastAttemptAt`
- `sentSubjects` for assessment/interview flows

## Role Model

### `admin`

- Full UI access
- Broad management authority
- Can view and manage all users and leads

### `manager`

- Broad CRM access
- Can create team leads, assistant managers, agents, and managers through current actions
- Can configure forms and access rules

### `assistant_manager`

- Intermediate management layer
- Visibility depends on direct ownership, manager links, subordinate links, and sometimes branch count

### `team_lead`

- Manages assigned agents
- Sees team-scoped leads

### `agent`

- Mostly works on self-owned or assigned leads
- Cannot use assignment dropdown in lead creation

## Lead Permission Model

Lead permissions are built dynamically in code.

At creation time:

- Owner gets read, update, delete.
- Assigned user gets read and update.
- Supervisors discovered through hierarchy traversal are also granted permissions.

At close time:

- Owner keeps full access.
- Assigned user is reduced to read-only.

At reopen time:

- Assigned user regains update access.

At reassignment time:

- New assignee gets access.
- Closed leads keep the assignee as read-only.

## Visibility Rules For Lead Listing

Current code behavior in `lead-service.ts` and `app/actions/lead.ts`:

- `admin`: sees all leads.
- `manager`: sees all leads.
- `agent`: sees leads assigned to them or owned by them.
- `team_lead`: sees leads owned by or assigned to themselves or their agents.
- `assistant_manager`: sees a mix of own leads, subordinate leads, manager-owned leads, and sometimes branch-wide leads.

There is also a hardcoded special-case email:

- `shashi.pathak@silverspaceinc.com` is treated as global lead access.

## Dynamic Form Field Model

Each form field includes:

| Field | Meaning |
| --- | --- |
| `id` | Stable field ID |
| `type` | `text`, `email`, `phone`, `dropdown`, `textarea`, `checklist` |
| `label` | User-facing label |
| `key` | Data key stored inside lead `data` JSON |
| `required` | Required validation |
| `visible` | Whether shown in normal agent-facing forms |
| `order` | Display order |
| `options` | Dropdown/checklist options |
| `placeholder` | Placeholder text |
| `validation` | Optional pattern/min/max rules |

## Access-Control Component Keys

The code recognizes these component keys:

- `dashboard`
- `leads`
- `history`
- `user-management`
- `field-management`
- `settings`
- `branch-management`
- `audit-logs`
- `mock`
- `assessment-support`
- `interview-support`
- `hierarchy`

## Important Data And Permission Caveats

### 1. Legacy Single-Field And New Array-Based Hierarchy Fields Coexist

Many reads still use `managerId` even when writes also set `managerIds`.

### 2. Branch Storage Is Not Fully Consistent

Most current user logic uses `branchIds`, but some branch-service checks still query `branchId`. That can make branch stats and deletion guards inaccurate.

### 3. Lead Data Search And Duplicate Checks Are JSON-Based

Because lead business fields live inside serialized JSON:

- Search is partly done in memory.
- Duplicate email/phone checks query candidate rows and then parse JSON.

This is flexible, but not as cheap or strict as indexed top-level columns.
