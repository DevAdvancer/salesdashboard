# API & Services Reference

> Quick-access reference for every exported function in the service layer. For architectural context, see `DEVELOPER_GUIDE.md`.

---

## `lib/services/lead-service.ts`

### `createLead(ownerId, input, creatingUserId?, creatingUserName?)`

Creates a new lead with full permission hierarchy and uniqueness validation.

```ts
import { createLead } from '@/lib/services/lead-service';

const lead = await createLead(
  user.$id,                 // ownerId
  {
    data: { firstName: 'John', email: 'john@example.com' },
    status: 'New',
    branchId: 'branch-123',
    assignedToId: 'agent-456', // optional
  },
  user.$id,                 // creatingUserId (for audit)
  user.name,                // creatingUserName (for audit)
);
```

**Throws:** if email/phone/LinkedIn duplicate exists, or if ID format is invalid.

---

### `updateLead(leadId, data, actorId?, actorName?)`

Updates specific fields in a lead's data blob. Merges with existing data.

```ts
await updateLead(
  lead.$id,
  { phone: '555-1234', status: 'Interested' },
  user.$id,
  user.name,
);
```

**Throws:** on invalid status transition or duplicate field value.

---

### `deleteLead(leadId, actorId?, actorName?)`

Permanently deletes a lead.

```ts
await deleteLead(lead.$id, user.$id, user.name);
```

---

### `getLead(leadId)`

Fetches a single lead by ID.

```ts
const lead = await getLead('lead-id-123');
const data = JSON.parse(lead.data); // Always parse the data field!
```

---

### `listLeads(filters, userId, userRole, branchIds?)`

Fetches leads with role-scoped visibility.

```ts
const leads = await listLeads(
  {
    status: 'Interested',
    branchId: 'branch-123',
    dateFrom: '2026-01-01',
    dateTo: '2026-06-01',
    searchQuery: 'John',
    isClosed: false,       // defaults to false if omitted
  },
  user.$id,
  user.role,
  user.branchIds,
);
```

**Filters:**

| Filter | Type | Notes |
|---|---|---|
| `status` | string? | Exact match on status field |
| `assignedToId` | string? | Filter by assigned agent |
| `branchId` | string? | Filter by branch |
| `dateFrom` | string? | ISO date — filter by `$createdAt` |
| `dateTo` | string? | ISO date |
| `searchQuery` | string? | Client-side full-text search |
| `isClosed` | boolean? | Defaults to `false` |

---

### `closeLead(leadId, closedStatus, actorId?, actorName?, actorRole?)`

Closes a lead, sets final status, restricts permissions.

```ts
await closeLead(lead.$id, 'Signed', user.$id, user.name, user.role);
```

---

### `reopenLead(leadId, actorId?, actorName?)`

Reopens a closed lead, restores agent update permissions.

```ts
await reopenLead(lead.$id, user.$id, user.name);
```

---

### `updateLeadFollowUp(leadId, nextFollowUpAt, nextAction, actorId?, actorName?)`

Sets follow-up metadata on a lead.

---

### `assignLead(leadId, assignedToId, actorId?, actorName?)`

Reassigns a lead to a different user, updating Appwrite permissions.

---

## `lib/services/user-service.ts`

### `createTeamLead(input, currentUser?)`

```ts
const teamLead = await createTeamLead({
  name: 'Alice Smith',
  email: 'alice@company.com',
  password: 'SecurePass123!',
  branchIds: ['branch-id-1'],
}, currentUser);
```

---

### `createAgent(input, currentUser?)`

```ts
const agent = await createAgent({
  name: 'Bob Jones',
  email: 'bob@company.com',
  password: 'SecurePass123!',
  role: 'agent',                // or 'lead_generation'
  teamLeadId: 'tl-id-1',
  branchIds: ['branch-id-1'],
}, currentUser);
```

**Validates:** `branchIds` must be a subset of the team lead's `branchIds`.

---

### `getUserById(userId)`

Fetches a user by ID. Validates ID format before calling Appwrite. Throws on invalid format or 404.

---

### `getUserByIdOrNull(userId)`

Same as above but returns `null` instead of throwing on not-found.

---

### `getUserByEmail(email)`

Returns the first user matching the given email, or `null`.

---

### `getAssignableUsers(creatorRole, creatorBranchIds, creatorId?)`

Returns users that `creatorRole` is allowed to assign leads to.

| Creator Role | Assignable Roles |
|---|---|
| `admin` / `developer` | All roles |
| `team_lead` | `agent` only (within same branches) |
| `agent` / `lead_generation` | None (empty array) |

---

### `getAgentsByTeamLead(teamLeadId)`

Returns all agents + lead_generation users under a team lead.

---

### `getAgentsByTeamLead(teamLeadId)`

Returns all agents whose `teamLeadId` matches.

---

### `getUsersByBranch(branchId)` / `getUsersByBranches(branchIds)`

Returns all users in given branch(es).

---

### `updateUser(userId, data)`

Updates `name` and/or `email`.

---

### `updateUserRole(userId, role)`

Changes a user's role.

---

### `updateUserTeamLead(agentId, teamLeadId)`

Reassigns an agent to a different team lead.

---

### `updateUserBranches(userId, branchIds)`

Updates branch assignments.

---

### `deactivateUser(userId, currentUser)`

Sets `isActive = false`. User will be logged out and cannot log in.

---

### `getSubordinates(userId)`

Returns all users below the given user in the hierarchy (recursive).

---

## `lib/services/audit-service.ts`

### `logAction(input)`

```ts
import { logAction } from '@/lib/services/audit-service';

await logAction({
  action: 'LEAD_CREATE',      // AuditLogAction
  actorId: user.$id,
  actorName: user.name,
  targetId: lead.$id,         // optional
  targetType: 'LEAD',
  metadata: { extra: 'data' }, // will be JSON.stringify'd
});
```

---

### `getAuditLogs(filters?)`

```ts
const { logs, total } = await getAuditLogs({
  actorId: 'user-id',     // optional
  targetType: 'LEAD',     // optional
  targetId: 'lead-id',    // optional
  limit: 50,              // default 50
  offset: 0,              // default 0
});
```

---

## `lib/services/form-config-service.ts`

### `getFormConfig()`

Returns the current lead creation form fields.

```ts
const { fields, version, updatedBy } = await getFormConfig();
// fields: FormField[]
```

### `getClosureFormConfig()`
### `getPaymentPlanFormConfig()`
### `getClientIntakeFormConfig()`

Same as above for their respective forms.

---

### `FormField` interface

```ts
interface FormField {
  id: string;
  type: 'text' | 'email' | 'phone' | 'dropdown' | 'textarea' | 'checklist';
  label: string;
  key: string;         // The key used in the lead's data JSON
  required: boolean;
  visible: boolean;
  order: number;
  options?: string[];  // For dropdown / checklist
  placeholder?: string;
  validation?: {
    pattern?: string;
    minLength?: number;
    maxLength?: number;
  };
}
```

---

## `lib/services/lead-validator.ts`

### `validateLeadUniqueness(data, excludeLeadId?)`

```ts
const result = await validateLeadUniqueness(
  { email: 'test@example.com', phone: '5551234567' },
  existingLeadId  // optional — pass when updating to exclude self
);

if (!result.isValid) {
  console.log(result.duplicateField);   // 'email' | 'phone' | 'linkedinProfileUrl'
  console.log(result.existingLeadId);   // ID of the conflicting lead
}
```

---

## `lib/services/branch-service.ts`

### `createBranch(input)` / `updateBranch(branchId, input)` / `deleteBranch(branchId)` / `listBranches()` / `getBranch(branchId)`

Standard CRUD for branches. `createBranch` and `updateBranch` require `{ name }` and optionally `{ isActive }`.

---

## `lib/server/appwrite.ts`

### `createSessionClient()`

Creates a server-side Appwrite client authenticated as the current user (from JWT cookie or session cookie). Use this in API routes and server components to make requests on behalf of the logged-in user.

```ts
// In an API route or server action:
const { databases, account } = await createSessionClient();
const user = await account.get();
```

**Throws `Error("No session")`** if no valid session cookie is found.

---

### `createAdminClient()`

Creates a server-side Appwrite client with the API key (full admin access). Use only in API routes that need to bypass user-level permissions (e.g., cron jobs, admin operations).

```ts
const { databases, users } = await createAdminClient();
// Can read/write anything — use carefully
```

---

## `lib/server/email-service.ts`

### `sendDuplicateAlertEmail(input)`

```ts
import { sendDuplicateAlertEmail } from '@/lib/server/email-service';

await sendDuplicateAlertEmail({
  actorEmail: 'agent@company.com',
  actorName: 'Agent Name',
  leadId: 'lead-123',
  clientName: 'John Smith',
  clientEmail: 'john@example.com',
  clientPhone: '555-1234',
  duplicateFields: [
    { field: 'email', existingLeadId: 'existing-lead-id' }
  ],
  attemptCount: 1,
  recipientEmails: ['admin@company.com', 'tl@company.com'],
  context: 'create',  // or 'update'
});
```

---

## `lib/server/notifications.ts`

### `createNotification(input)`

```ts
import { createNotification } from '@/lib/server/notifications';

await createNotification({
  recipientId: 'user-id',
  type: 'LEAD_ASSIGNED',
  title: 'Lead assigned to you',
  body: 'You have a new lead: John Smith',
  targetId: 'lead-id',
  targetType: 'LEAD',
});
```

---

## `lib/contexts/auth-context.tsx`

### `useAuth()`

```tsx
import { useAuth } from '@/lib/contexts/auth-context';

function MyComponent() {
  const { user, isAdmin, isTeamLead, isAgent, loading, login, logout } = useAuth();

  if (loading) return <Spinner />;
  if (!user) return <Redirect to="/login" />;

  return <div>Hello, {user.name}</div>;
}
```

---

## `lib/contexts/access-control-context.tsx`

### `useAccess()`

```tsx
import { useAccess } from '@/lib/contexts/access-control-context';

function MyComponent() {
  const { canAccess, isLoading } = useAccess();

  if (isLoading) return null;

  return (
    <div>
      {canAccess('audit-logs') && <AuditLogSection />}
      {canAccess('reports') && <ReportsSection />}
    </div>
  );
}
```

---

## `lib/hooks/use-debounce.ts`

### `useDebounce(value, delay)`

```ts
import { useDebounce } from '@/lib/hooks/use-debounce';

const debouncedSearch = useDebounce(searchQuery, 300);
```

---

*For the full architecture overview and setup instructions, see [DEVELOPER_GUIDE.md](./DEVELOPER_GUIDE.md)*
