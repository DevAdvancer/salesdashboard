# Appwrite Database Schema — SalesHub CRM

Database ID: `crm-database-1`

---

## Collection: `users`

Display Name: Users

| Attribute | Type     | Required | Size | Default | Description                                                                 |
|-----------|----------|----------|------|---------|-----------------------------------------------------------------------------|
| name      | string   | Yes      | 255  | -       | User's display name                                                         |
| email     | email    | Yes      | -    | -       | User's email (unique index)                                                 |
| role      | enum     | Yes      | -    | -       | `admin`, `manager`, or `agent`                                              |
| managerId | string   | No       | 255  | null    | ID of the user's manager (for agents)                                       |
| branchIds | string[] | No       | 255  | []      | Array of assigned branch IDs. Managers can have multiple; agents inherit.    |

Indexes:
- `email_idx` — unique on `[email]`
- `role_idx` — key on `[role]`
- `manager_idx` — key on `[managerId]`
- `branch_idx` — key on `[branchIds]` (array index for querying users by branch)

Permissions:
- Read: any
- Create: guests, users
- Update: users
- Delete: users

---

## Collection: `leads`

Display Name: Leads

| Attribute    | Type     | Required | Size  | Default | Description                           |
|--------------|----------|----------|-------|---------|---------------------------------------|
| data         | string   | Yes      | 65535 | -       | JSON-serialized lead data             |
| status       | string   | Yes      | 50    | -       | Lead status (New, Contacted, etc.)    |
| ownerId      | string   | Yes      | 255   | -       | Manager who owns this lead            |
| assignedToId | string   | No       | 255   | null    | Agent assigned to this lead           |
| branchId     | string   | No       | 255   | null    | Branch this lead belongs to           |
| isClosed     | boolean  | No       | -     | false   | Whether the lead is closed            |
| closedAt     | datetime | No       | -     | null    | Timestamp when the lead was closed    |

Indexes:
- `owner_idx` — key on `[ownerId]`
- `assigned_idx` — key on `[assignedToId]`
- `status_idx` — key on `[status]`
- `closed_idx` — key on `[isClosed]`
- `branch_idx` — key on `[branchId]`

Permissions:
- Read: any
- Create: users
- Update: users
- Delete: users

---

## Collection: `branches` (NEW)

Display Name: Branches

| Attribute | Type    | Required | Size | Default | Description                  |
|-----------|---------|----------|------|---------|------------------------------|
| name      | string  | Yes      | 255  | -       | Unique branch name           |
| isActive  | boolean | Yes      | -    | true    | Whether the branch is active |

Indexes:
- `name_idx` — unique on `[name]`
- `active_idx` — key on `[isActive]`

Permissions:
- Read: any
- Create: users
- Update: users
- Delete: users

---

## Collection: `form_config`

Display Name: Form Configuration

| Attribute | Type    | Required | Size  | Default | Description                          |
|-----------|---------|----------|-------|---------|--------------------------------------|
| fields    | string  | Yes      | 65535 | -       | JSON-serialized FormField[] array    |
| version   | integer | Yes      | -     | -       | Config version number (0–999999)     |
| updatedBy | string  | Yes      | 255   | -       | User ID who last updated the config  |

Indexes:
- `version_idx` — key on `[version]`

Permissions:
- Read: any
- Create: users
- Update: users
- Delete: users

---

## Collection: `access_config`

Display Name: Access Configuration

| Attribute    | Type    | Required | Size | Default | Description                                  |
|--------------|---------|----------|------|---------|----------------------------------------------|
| componentKey | string  | Yes      | 50   | -       | UI component key (dashboard, leads, etc.)    |
| role         | enum    | Yes      | -    | -       | `admin`, `manager`, or `agent`               |
| allowed      | boolean | Yes      | -    | false   | Whether the role can access this component   |

Indexes:
- `component_role_idx` — unique on `[componentKey, role]`

Permissions:
- Read: any
- Create: users
- Update: users
- Delete: users

---

## Migration Notes (Admin & Branch Management)

Changes from the previous schema:

1. **`users` collection**:
   - `role` enum now includes `admin` (was: `manager | agent`)
   - New `branchIds` attribute (string array) — replaces the single `branchId` from the initial design. A manager can be assigned to multiple branches. Agents inherit their manager's branch assignments.
   - New `branch_idx` index on `[branchIds]`

2. **`leads` collection**:
   - New `branchId` attribute (string) — each lead belongs to one branch
   - New `branch_idx` index on `[branchId]`

3. **`branches` collection** (entirely new):
   - Create this collection with `name` (string, unique) and `isActive` (boolean, default true)

4. **`access_config` collection**:
   - `role` enum now includes `admin`
   - Add default rules for admin role (all components allowed) and `branch-management` component key

### Appwrite Console Steps

To apply these changes in the Appwrite Console:

1. **Create `branches` collection**:
   - Go to Databases → crm-database-1 → Create Collection
   - Collection ID: use the value from `NEXT_PUBLIC_APPWRITE_BRANCHES_COLLECTION_ID`
   - Add `name` (string, required, size 255)
   - Add `isActive` (boolean, required, default true)
   - Create unique index `name_idx` on `[name]`
   - Create key index `active_idx` on `[isActive]`

2. **Update `users` collection**:
   - Add `branchIds` attribute: type string[], size 255, not required, default `[]`
   - Create key index `branch_idx` on `[branchIds]`
   - Update `role` enum to include `admin`

3. **Update `leads` collection**:
   - Add `branchId` attribute: type string, size 255, not required, default null
   - Create key index `branch_idx` on `[branchId]`

4. **Update `.env.local`**:
   - Add `NEXT_PUBLIC_APPWRITE_BRANCHES_COLLECTION_ID=<your-collection-id>`
