# Appwrite Database Schema — SalesHub CRM

Database ID: `crm-database-1`

---

## Collection: `users`

Display Name: Users

| Attribute   | Type   | Required | Size | Default | Description                        |
|-------------|--------|----------|------|---------|------------------------------------|
| name        | string | Yes      | 255  | -       | User's display name                |
| email       | email  | Yes      | -    | -       | User's email (unique index)        |
| role        | enum   | Yes      | -    | -       | `manager` or `agent`               |
| managerId   | string | No       | 255  | null    | ID of the user's manager           |

Indexes:
- `email_idx` — unique on `[email]`
- `role_idx` — key on `[role]`
- `manager_idx` — key on `[managerId]`

Permissions:
- Read: any
- Create: guests, users
- Update: users
- Delete: users

---

## Collection: `leads`

Display Name: Leads

| Attribute    | Type     | Required | Size  | Default | Description                          |
|--------------|----------|----------|-------|---------|--------------------------------------|
| data         | string   | Yes      | 65535 | -       | JSON-serialized lead data            |
| status       | string   | Yes      | 50    | -       | Lead status (New, Contacted, etc.)   |
| ownerId      | string   | Yes      | 255   | -       | Manager who owns this lead           |
| assignedToId | string   | No       | 255   | null    | Agent assigned to this lead          |
| isClosed     | boolean  | No       | -     | false   | Whether the lead is closed           |
| closedAt     | datetime | No       | -     | null    | Timestamp when the lead was closed   |

Indexes:
- `owner_idx` — key on `[ownerId]`
- `assigned_idx` — key on `[assignedToId]`
- `status_idx` — key on `[status]`
- `closed_idx` — key on `[isClosed]`

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
| role         | enum    | Yes      | -    | -       | `manager` or `agent`                         |
| allowed      | boolean | Yes      | -    | false   | Whether the role can access this component   |

Indexes:
- `component_role_idx` — unique on `[componentKey, role]`

Permissions:
- Read: any
- Create: users
- Update: users
- Delete: users

---

## Checklist for Manual Verification

Use the Appwrite Console to verify each collection has the correct attributes:

1. Go to **Databases → crm-database-1**
2. For each collection, open **Attributes** tab and confirm all attributes exist with correct types
3. Pay special attention to:
   - `leads.isClosed` — must be a **boolean** attribute (this was the source of the 400 error)
   - `leads.closedAt` — must be a **datetime** attribute
   - `users.email` — must have a **unique** index
   - `access_config` — must have a **unique composite** index on `[componentKey, role]`

If `isClosed` is missing from the `leads` collection, create it manually:
- Attribute key: `isClosed`
- Type: Boolean
- Required: No
- Default value: `false`

Then create the index:
- Index key: `closed_idx`
- Type: Key
- Attributes: `[isClosed]`
