# Admin Manager Creation Authorization - Implementation

## Changes Made

### 1. Authorization Fix (`app/actions/user.ts`)

Modified `createManagerAction` to allow both admin and manager roles to create managers:

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

This immediately unblocks managers from creating other managers.

### 2. Admin Promotion Script (`scripts/promote-to-admin.ts`)

Created a new script to promote existing users to admin role:

**Features:**
- Validates environment variables
- Searches for user by email
- Shows current user details before promotion
- Updates role to admin
- Provides clear success/error messages

**Usage:**
```bash
npm run promote-admin <user-email>
```

**Example:**
```bash
npm run promote-admin john@example.com
```

### 3. Package.json Update

Added npm script for easy access:
```json
"promote-admin": "tsx scripts/promote-to-admin.ts"
```

## How to Use

### For Immediate Fix (Already Applied)

The authorization fix is already in place. Managers can now create other managers without errors.

### To Create Your First Admin (Recommended)

1. Sign up through the normal flow (creates a manager account)
2. Run the promotion script:
   ```bash
   npm run promote-admin your-email@example.com
   ```
3. Refresh your browser to see admin privileges

### Verification

After promotion, the admin user should be able to:
- ✅ Create managers
- ✅ Create team leads (if they have branches)
- ✅ Access all system features
- ✅ See admin-specific UI elements

## Testing

### Manual Testing Steps

1. **Test Manager Creating Manager:**
   - Log in as a manager
   - Navigate to User Management
   - Click "Create Manager"
   - Fill in the form and submit
   - Verify: Should succeed without "Unauthorized" error

2. **Test Admin Promotion:**
   - Run: `npm run promote-admin test@example.com`
   - Check database: User role should be 'admin'
   - Log in as that user
   - Verify: Should see admin-level access

3. **Test Role Restrictions:**
   - Log in as team_lead or agent
   - Try to access User Management
   - Verify: Should not see "Create Manager" option

### Expected Behavior

| Role | Can Create Manager | Error Message |
|------|-------------------|---------------|
| Admin | ✅ Yes | - |
| Manager | ✅ Yes | - |
| Team Lead | ❌ No | "Permission denied: Only admins and managers can create managers" |
| Agent | ❌ No | "Permission denied: Only admins and managers can create managers" |

## Rollback Plan

If issues arise, revert the authorization change:

```typescript
// Revert to strict admin-only:
if (callerDoc.role !== 'admin') {
    throw new Error("Permission denied: Only admins can create managers");
}
```

Then ensure at least one admin user exists via the promotion script.

## Future Considerations

### Option 1: Strict Hierarchy (Recommended for Production)
After creating admin users, revert to admin-only manager creation for better security.

### Option 2: Flexible Hierarchy (Current Implementation)
Keep manager-to-manager creation enabled for easier team scaling.

### Option 3: Approval Workflow
Add an approval step where manager-created managers require admin approval.

## Security Notes

- The promotion script requires `APPWRITE_API_KEY` (server-side only)
- API key should never be exposed to client-side code
- Consider logging all manager creation events for audit trail
- Review and promote users to admin carefully
- Limit the number of admin users to maintain security

## Documentation Updates Needed

Update the following files:
- [ ] `README.md` - Add admin promotion instructions
- [ ] `SETUP.md` - Include admin bootstrap in setup steps
- [ ] `docs/QUICK_START.md` - Mention admin vs manager roles
- [ ] `.env.example` - Ensure APPWRITE_API_KEY is documented
