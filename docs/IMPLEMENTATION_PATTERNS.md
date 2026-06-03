# Implementation Patterns & Best Practices

> This document codifies the patterns already used in the codebase so that new features stay consistent.

---

## 1. Data Access Patterns

### Client Components → Service Functions

Client components always call service functions in `lib/services/`. **Never** import `databases` or Appwrite SDK directly in a page or component.

```tsx
// ✅ Correct
import { listLeads } from '@/lib/services/lead-service';

function LeadsPage() {
  const [leads, setLeads] = useState([]);
  useEffect(() => {
    listLeads({}, user.$id, user.role).then(setLeads);
  }, []);
}

// ❌ Wrong — don't do this in components
import { databases } from '@/lib/appwrite';
databases.listDocuments(...)
```

### Server Routes / Server Actions → `createSessionClient()` or `createAdminClient()`

API routes and server actions should use the server Appwrite clients.

```ts
// app/api/my-route/route.ts
import { createSessionClient } from '@/lib/server/appwrite';

export async function GET() {
  const { databases } = await createSessionClient(); // authenticated as current user
  const result = await databases.listDocuments(...);
  return Response.json(result);
}
```

---

## 2. Type Safety for Lead Data

The `data` field on `Lead` is always a JSON string. Always parse it before use and type-cast the result.

```ts
// Reading lead data
const leadData = JSON.parse(lead.data) as LeadData;
const firstName = typeof leadData.firstName === 'string' ? leadData.firstName : '';

// Updating specific fields (merge pattern)
const currentData = JSON.parse(lead.data) as LeadData;
const updatedData = { ...currentData, status: 'Interested', phone: '555-9999' };
await updateLead(lead.$id, updatedData, user.$id, user.name);
```

---

## 3. Role-Based UI Gating

Use `useAccess()` for feature-level gating and `useAuth()` for role-specific UI:

```tsx
function MyFeaturePage() {
  const { user, isAdmin } = useAuth();
  const { canAccess } = useAccess();

  // Feature-level gate (respects DB overrides)
  if (!canAccess('my-feature')) return <AccessDenied />;

  return (
    <div>
      <LeadList />
      {/* Admin-only action */}
      {isAdmin && <DeleteButton />}
      {/* Role-specific UI */}
      {user?.role === 'team_lead' && <TeamStats />}
    </div>
  );
}
```

---

## 4. Error Handling Pattern

Services throw `Error` with descriptive messages. Components should catch and display errors:

```tsx
async function handleSave() {
  try {
    await updateLead(lead.$id, updatedData, user.$id, user.name);
    toast({ title: 'Lead updated', variant: 'success' });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'An error occurred';
    toast({ title: 'Failed to update lead', description: message, variant: 'destructive' });
  }
}
```

---

## 5. Audit Logging Pattern

Add audit logging to any service function that mutates important data. Audit logging should NOT block the main operation — wrap in try/catch if needed:

```ts
// Log audit (non-blocking — if logAction fails, main op still succeeds)
if (actorId && actorName) {
  await logAction({
    action: 'MY_ACTION',
    actorId,
    actorName,
    targetId: entity.$id,
    targetType: 'MY_ENTITY',
    metadata: { relevantField: value },
  }).catch(err => console.error('Audit log failed:', err));
}
```

---

## 6. Appwrite Permissions Pattern

When creating a document that should be visible to a user's hierarchy:

```ts
const permissions = [
  Permission.read(Role.user(ownerId)),
  Permission.update(Role.user(ownerId)),
  Permission.delete(Role.user(ownerId)),
];

// Add supervisor permissions (managers, team leads)
const hierarchyPerms = await getHierarchyPermissions(ownerId);
permissions.push(...hierarchyPerms);

await databases.createDocument(DATABASE_ID, COLLECTION_ID, 'unique()', data, permissions);
```

---

## 7. Notification Creation Pattern

Create notifications from **server-side** code (API routes, server actions, or services):

```ts
// From a service file (client-side):
// Import from lib/server/notifications — only works in server context
// If you're in a client service, trigger a server action instead

// From an API route:
import { createNotification } from '@/lib/server/notifications';

await createNotification({
  recipientId: targetUserId,
  type: 'MY_EVENT_TYPE',
  title: 'Something happened',
  body: 'Here is what happened: ...',
  targetId: entityId,
  targetType: 'MY_ENTITY',
});
```

---

## 8. Form Field Key Convention

When adding fields to lead data, use camelCase keys that match what's defined in form config:

```ts
// In form config DEFAULT_FIELDS:
{ key: 'firstName', label: 'First Name', ... }

// In lead data:
const data = { firstName: 'John', lastName: 'Smith' }

// These keys are what gets stored in the JSON blob
// and referenced in duplicate detection, exports, etc.
```

---

## 9. Component Structure Pattern

Page components should be thin orchestrators. Put business logic in services:

```tsx
// app/my-feature/page.tsx — thin page component
export default function MyFeaturePage() {
  return (
    <AppLayout>
      <MyFeatureContainer />
    </AppLayout>
  );
}

// components/my-feature/my-feature-container.tsx — business logic
'use client';
function MyFeatureContainer() {
  const { user } = useAuth();
  const [data, setData] = useState([]);

  // Call service functions here
  useEffect(() => {
    myFeatureService.list(user.$id).then(setData);
  }, [user]);

  return <MyFeatureView data={data} />;
}

// components/my-feature/my-feature-view.tsx — pure UI
function MyFeatureView({ data }: { data: MyEntity[] }) {
  return <div>...</div>;
}
```

---

## 10. Navigation & Access Integration

Every new page needs:

1. A nav item in `components/navigation-config.ts`
2. A `ComponentKey` in `lib/types/index.ts` and `lib/constants/default-access.ts`
3. Default access rules for **every role** in `lib/constants/default-access.ts`
4. The page component wrapped in `AppLayout`

```ts
// navigation-config.ts
import { SomeIcon } from 'lucide-react';

export const NAV_ITEMS = [
  // ... existing items
  { key: 'my-feature', label: 'My Feature', href: '/my-feature', icon: SomeIcon },
];
```

```ts
// default-access.ts — add ALL 5 roles
{ componentKey: 'my-feature', role: 'admin', allowed: true },
{ componentKey: 'my-feature', role: 'developer', allowed: true },
{ componentKey: 'my-feature', role: 'team_lead', allowed: false },
{ componentKey: 'my-feature', role: 'agent', allowed: false },
{ componentKey: 'my-feature', role: 'lead_generation', allowed: false },
```

---

## 11. Cron Job Pattern

Cron endpoints live in `app/api/cron/`. They should:
1. Verify a secret token to prevent unauthorized execution
2. Use `createAdminClient()` for DB access
3. Be idempotent (safe to run multiple times)

```ts
// app/api/cron/my-job/route.ts
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const token = searchParams.get('token');

  if (token !== process.env.CRON_SECRET) {
    return new Response('Unauthorized', { status: 401 });
  }

  const { databases } = await createAdminClient();
  // ... do work ...
  return Response.json({ success: true, processed: count });
}
```

---

## 12. TypeScript Conventions

- Use the types in `lib/types/index.ts` — don't define local ad-hoc interfaces for shared data shapes
- Use `unknown` not `any` when type is genuinely unknown; cast with `as` only after runtime validation
- Mark `@deprecated` fields with JSDoc when replacing them
- Server-only imports (node-appwrite, email service, etc.) should only be in `lib/server/` files

---

*For the full developer guide, see [DEVELOPER_GUIDE.md](./DEVELOPER_GUIDE.md)*  
*For function signatures, see [API_REFERENCE.md](./API_REFERENCE.md)*
