# Admin Manager Creation Authorization - Design

## Problem Analysis

The current implementation has an authorization mismatch:

1. **User Signup Flow**: Creates users with `manager` role (see `lib/contexts/auth-context.tsx`)
2. **Manager Creation**: Requires caller to have `admin` role (see `app/actions/user.ts:40`)
3. **No Admin Bootstrap**: No mechanism exists to create the first admin user

This creates a chicken-and-egg problem where:
- Managers cannot create other managers (requires admin role)
- No admin users exist in the system
- The signup flow only creates managers, not admins

## Root Cause

The codebase evolved to support a 4-tier hierarchy (`admin` → `manager` → `team_lead` → `agent`), but:
- The initial setup script only defined `['manager', 'agent']` roles
- Migration scripts added `team_lead` and `admin` support
- No bootstrap mechanism was created for the first admin user
- The authorization check in `createManagerAction` is correct per design, but there's no admin to use it

## Solution Options

### Option 1: Allow Managers to Create Managers (Quick Fix)
Modify `createManagerAction` to allow both `admin` and `manager` roles to create managers.

**Pros:**
- Minimal code change
- Unblocks current users immediately
- Maintains backward compatibility

**Cons:**
- Violates the intended hierarchy design
- Managers could create unlimited managers without oversight
- Reduces admin role significance

### Option 2: Create Admin Bootstrap Script (Recommended)
Create a one-time script to promote an existing manager to admin role.

**Pros:**
- Maintains proper role hierarchy
- Follows security best practices
- One-time operation, no ongoing impact
- Aligns with design intent

**Cons:**
- Requires manual script execution
- Needs database access

### Option 3: First User is Admin
Modify signup to make the first user an admin, subsequent users are managers.

**Pros:**
- Automatic bootstrap
- No manual intervention needed
- Clean user experience

**Cons:**
- Race condition in multi-instance deployments
- Requires checking user count on every signup
- Could be exploited if database is cleared

## Recommended Solution: Option 2 + Option 1 (Hybrid)

Implement both solutions:

1. **Short-term**: Modify `createManagerAction` to allow managers to create managers
2. **Long-term**: Provide an admin bootstrap script for proper role elevation

This approach:
- Unblocks users immediately
- Provides a path to proper role hierarchy
- Maintains flexibility for different deployment scenarios

## Implementation Plan

### Phase 1: Immediate Fix (Allow Manager to Create Manager)

Modify `app/actions/user.ts`:

```typescript
// Before:
if (callerDoc.role !== 'admin') {
    throw new Error("Permission denied: Only admins can create managers");
}

// After:
if (callerDoc.role !== 'admin' && callerDoc.role !== 'manager') {
    throw new Error("Permission denied: Only admins and managers can create managers");
}
```

### Phase 2: Admin Bootstrap Script

Create `scripts/promote-to-admin.ts`:

```typescript
/**
 * Promote a user to admin role
 * Usage: npm run promote-admin <user-email>
 */
import 'dotenv/config';
import { Client, Databases, Query } from 'node-appwrite';

const client = new Client()
  .setEndpoint(process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT!)
  .setProject(process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID!)
  .setKey(process.env.APPWRITE_API_KEY!);

const databases = new Databases(client);
const DATABASE_ID = process.env.NEXT_PUBLIC_APPWRITE_DATABASE_ID!;
const USERS_COLLECTION_ID = process.env.NEXT_PUBLIC_APPWRITE_USERS_COLLECTION_ID!;

async function promoteToAdmin(email: string) {
  try {
    // Find user by email
    const users = await databases.listDocuments(
      DATABASE_ID,
      USERS_COLLECTION_ID,
      [Query.equal('email', email)]
    );

    if (users.total === 0) {
      console.error(`❌ User not found: ${email}`);
      process.exit(1);
    }

    const user = users.documents[0];
    
    // Update role to admin
    await databases.updateDocument(
      DATABASE_ID,
      USERS_COLLECTION_ID,
      user.$id,
      { role: 'admin' }
    );

    console.log(`✅ User ${email} promoted to admin`);
    console.log(`   User ID: ${user.$id}`);
    console.log(`   Previous role: ${user.role}`);
  } catch (error) {
    console.error('❌ Failed to promote user:', error);
    process.exit(1);
  }
}

const email = process.argv[2];
if (!email) {
  console.error('Usage: npm run promote-admin <user-email>');
  process.exit(1);
}

promoteToAdmin(email);
```

### Phase 3: Documentation Update

Update `SETUP.md` and `README.md` to include:
1. How to create the first admin user
2. Role hierarchy explanation
3. When to use admin vs manager accounts

## Testing Strategy

1. **Unit Tests**: Verify authorization logic for both admin and manager
2. **Integration Tests**: Test manager creation flow end-to-end
3. **Manual Testing**: 
   - Create manager as manager
   - Create manager as admin (after promotion)
   - Verify error for team_lead/agent attempting to create manager

## Migration Path

For existing deployments:
1. Apply code fix (Phase 1)
2. Identify primary user who should be admin
3. Run promotion script (Phase 2)
4. Optionally revert Phase 1 change to enforce strict hierarchy

## Security Considerations

- Manager-to-manager creation should be logged
- Consider adding approval workflow for manager creation
- Admin promotion script requires API key (server-side only)
- Document that first manager should be promoted to admin immediately after signup
