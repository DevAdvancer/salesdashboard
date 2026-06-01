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

## Collection: `client_payments` (NEW)

Display Name: Client Payments

| Attribute       | Type     | Required | Size  | Default | Description                                  |
|----------------|----------|----------|-------|---------|----------------------------------------------|
| leadId         | string   | Yes      | 255   | -       | Lead/client document ID                      |
| personalDetails| string   | No       | 65535 | `{}`    | JSON-serialized closure personal details     |
| paymentPlan    | string   | Yes      | 65535 | -       | JSON-serialized payment plan                 |
| status         | string   | Yes      | 50    | -       | `not_paid`, `partially_paid`, `fully_paid`   |
| updates        | string   | No       | 65535 | `[]`    | JSON-serialized payment updates (latest first) |
| createdAt      | datetime | Yes      | -     | -       | Record creation timestamp                    |
| updatedAt      | datetime | No       | -     | null    | Last update timestamp                        |
| lastReminderAt | datetime | No       | -     | null    | Last reminder sent timestamp                 |
| updatedById    | string   | No       | 255   | null    | Last updater user ID                         |
| updatedByName  | string   | No       | 255   | null    | Last updater display name                    |

Indexes:
- `leadId_idx` — unique on `[leadId]`

Permissions:
- Read: users
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

---

## SOP Upgrade Schema Additions

These changes support the role-based productivity SOP: follow-ups, role dashboards, notes, coaching notes, review queues, notifications, and future reports.

### Update Collection: `leads`

Add these optional attributes:

| Attribute        | Type     | Required | Size | Default | Description |
|------------------|----------|----------|------|---------|-------------|
| nextFollowUpAt   | datetime | No       | -    | null    | Date/time when the next lead action is due |
| nextAction       | string   | No       | 100  | null    | Next action label, such as Call, Email, Meeting, Documents Pending |
| lastContactedAt  | datetime | No       | -    | null    | Last successful contact timestamp |
| followUpStatus   | string   | No       | 50   | pending | Follow-up state: pending, completed, overdue |

Recommended indexes:

- `next_follow_up_idx` - key on `[nextFollowUpAt]`
- `follow_up_status_idx` - key on `[followUpStatus]`

### New Collection: `lead_notes`

Display Name: Lead Notes

| Attribute  | Type     | Required | Size  | Description |
|------------|----------|----------|-------|-------------|
| leadId     | string   | Yes      | 255   | Lead/client document ID |
| authorId   | string   | Yes      | 255   | User ID who wrote the note |
| authorName | string   | Yes      | 255   | User display name |
| body       | string   | Yes      | 10000 | Note content |
| visibility | string   | Yes      | 50    | team, leadership, manager_only |
| createdAt  | datetime | Yes      | -     | Created timestamp |
| updatedAt  | datetime | No       | -     | Last edited timestamp |

Recommended indexes:

- `lead_idx` - key on `[leadId]`
- `author_idx` - key on `[authorId]`
- `created_idx` - key on `[createdAt]`
- `visibility_idx` - key on `[visibility]`

### New Collection: `coaching_notes`

Display Name: Coaching Notes

| Attribute      | Type     | Required | Size  | Description |
|----------------|----------|----------|-------|-------------|
| targetUserId   | string   | Yes      | 255   | User receiving the coaching note |
| targetUserName | string   | No       | 255   | User display name |
| authorId       | string   | Yes      | 255   | User ID who wrote the note |
| authorName     | string   | Yes      | 255   | User display name |
| note           | string   | Yes      | 10000 | Coaching note content |
| visibility     | string   | Yes      | 50    | manager_only or leadership |
| createdAt      | datetime | Yes      | -     | Created timestamp |
| updatedAt      | datetime | No       | -     | Last edited timestamp |

Recommended indexes:

- `target_user_idx` - key on `[targetUserId]`
- `author_idx` - key on `[authorId]`
- `created_idx` - key on `[createdAt]`
- `visibility_idx` - key on `[visibility]`

### New Collection: `review_queue`

Display Name: Review Queue

| Attribute          | Type     | Required | Size  | Description |
|--------------------|----------|----------|-------|-------------|
| type               | string   | Yes      | 100   | Review type, such as lead_reopen, duplicate_warning, high_value_reassignment |
| status             | string   | Yes      | 50    | open, approved, rejected, resolved |
| targetId           | string   | Yes      | 255   | Related lead/user/field/document ID |
| targetType         | string   | Yes      | 100   | LEAD, USER, FORM_FIELD, CLIENT |
| requestedById      | string   | Yes      | 255   | Requesting user ID |
| requestedByName    | string   | Yes      | 255   | Requesting user display name |
| assignedReviewerId | string   | No       | 255   | Manager/Admin reviewer ID |
| reason             | string   | No       | 5000  | Request reason |
| metadata           | string   | No       | 20000 | JSON metadata for the review |
| createdAt          | datetime | Yes      | -     | Created timestamp |
| resolvedAt         | datetime | No       | -     | Resolution timestamp |

Recommended indexes:

- `status_idx` - key on `[status]`
- `type_idx` - key on `[type]`
- `target_idx` - key on `[targetId]`
- `reviewer_idx` - key on `[assignedReviewerId]`
- `created_idx` - key on `[createdAt]`

### New Collection: `notifications`

Display Name: Notifications

| Attribute   | Type     | Required | Size | Description |
|-------------|----------|----------|------|-------------|
| recipientId | string   | Yes      | 255  | User ID who should see the notification |
| type        | string   | Yes      | 100  | Notification type |
| title       | string   | Yes      | 255  | Notification title |
| body        | string   | Yes      | 2000 | Notification body |
| targetId    | string   | No       | 255  | Related document ID |
| targetType  | string   | No       | 100  | Related document type |
| readAt      | datetime | No       | -    | Read timestamp |
| createdAt   | datetime | Yes      | -    | Created timestamp |

Recommended indexes:

- `recipient_idx` - key on `[recipientId]`
- `read_idx` - key on `[readAt]`
- `created_idx` - key on `[createdAt]`
- `type_idx` - key on `[type]`

### Environment Variables

Add these to `.env.local` after creating the collections:

```env
NEXT_PUBLIC_APPWRITE_LEAD_NOTES_COLLECTION_ID=lead_notes
NEXT_PUBLIC_APPWRITE_COACHING_NOTES_COLLECTION_ID=coaching_notes
NEXT_PUBLIC_APPWRITE_REVIEW_QUEUE_COLLECTION_ID=review_queue
NEXT_PUBLIC_APPWRITE_NOTIFICATIONS_COLLECTION_ID=notifications
```
