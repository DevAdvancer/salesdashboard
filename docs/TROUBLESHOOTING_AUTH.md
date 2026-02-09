# Authentication Troubleshooting Guide

## Issue: User Document Not Created with Correct Auth ID

### Symptoms
- User account is created in Appwrite Auth
- User document is not created in the `users` collection
- Or user document is created with wrong ID
- Redirect to dashboard doesn't work after signup

### Root Causes and Solutions

#### 1. Database/Collection Permissions Issue

**Check Appwrite Console:**
1. Go to your Appwrite project
2. Navigate to Databases → `crm-database-1` → `users` collection
3. Click on "Settings" tab
4. Check "Permissions"

**Required Permissions:**
```
Collection-level permissions:
- Read: Any
- Create: Users
- Update: Users
- Delete: Users
```

**To Fix:**
1. In Appwrite Console, go to the `users` collection
2. Click "Settings" → "Permissions"
3. Add these permissions:
   - Click "+ Add Role"
   - Select "Any" for Read permission
   - Select "Users" for Create, Update, Delete permissions
4. Save changes

#### 2. Document ID Mismatch

**The Issue:**
The user document ID must match the Appwrite Auth account ID exactly.

**Current Implementation (Correct):**
```typescript
const newAccount = await account.create(ID.unique(), email, password, name);
const userDoc = await databases.createDocument(
  DATABASE_ID,
  COLLECTIONS.USERS,
  newAccount.$id,  // ✅ Using account ID as document ID
  { name, email, role: 'manager', managerId: null }
);
```

**Verify in Console:**
1. Check browser console for logs showing the account ID
2. Check Appwrite Console → Auth → Users for the created user
3. Check Appwrite Console → Databases → users collection for matching document

#### 3. Environment Variables Not Loaded

**Check Configuration:**
```bash
# Visit this URL after starting dev server:
http://localhost:3000/api/debug-config
```

**Expected Output:**
```json
{
  "databaseId": "crm-database-1",
  "collections": {
    "users": "users",
    "leads": "leads",
    "formConfig": "form_config",
    "accessConfig": "access_config"
  }
}
```

**To Fix:**
1. Stop the dev server (Ctrl+C)
2. Verify `.env.local` has correct values
3. Restart dev server: `npm run dev`
4. Clear browser cache or use incognito mode

#### 4. Collection Attributes Not Created

**Check Appwrite Console:**
1. Go to Databases → `crm-database-1` → `users` collection
2. Click "Attributes" tab
3. Verify these attributes exist:
   - `name` (String, 255, Required)
   - `email` (Email, Required)
   - `role` (Enum: ['manager', 'agent'], Required)
   - `managerId` (String, 255, Optional)

**To Fix:**
Run the setup script again:
```bash
npm run setup:appwrite
```

#### 5. API Key Permissions

**For Setup Script:**
The `APPWRITE_API_KEY` in `.env.local` must have these scopes:
- `databases.read`
- `databases.write`
- `collections.read`
- `collections.write`
- `attributes.read`
- `attributes.write`
- `indexes.read`
- `indexes.write`
- `documents.read`
- `documents.write`

**To Create API Key:**
1. Go to Appwrite Console → Overview → Integrations
2. Click "API Keys" → "Create API Key"
3. Name it "Setup Script"
4. Select all database-related scopes
5. Copy the key to `.env.local` as `APPWRITE_API_KEY`

## Debugging Steps

### Step 1: Check Browser Console
Open browser DevTools (F12) and look for:
```
Starting signup process...
Database ID: crm-database-1
Users Collection ID: users
Creating Appwrite account...
Account created successfully: [ACCOUNT_ID]
Creating user document with ID: [ACCOUNT_ID]
User document created successfully: [DOCUMENT_ID]
Creating session...
Session created successfully
Setting user state: {...}
Signup completed successfully
Submitting signup form...
Signup successful, redirecting to dashboard...
```

### Step 2: Check for Errors
Look for error messages in console:
- `401 Unauthorized` → Permission issue
- `404 Not Found` → Database or collection doesn't exist
- `409 Conflict` → Document with that ID already exists
- `500 Server Error` → Appwrite server issue

### Step 3: Verify Database Structure
```bash
# Run setup script to verify/create structure
npm run setup:appwrite
```

Expected output:
```
✅ Database created successfully
✅ Collection users created with attributes and indexes
✅ Collection leads created with attributes and indexes
✅ Collection form_config created with attributes and indexes
✅ Collection access_config created with attributes and indexes
✅ Default form configuration created
✅ Created 6 default access rules
```

### Step 4: Test with Curl
Test document creation directly:
```bash
curl -X POST \
  https://[YOUR-ENDPOINT]/v1/databases/crm-database-1/collections/users/documents \
  -H "Content-Type: application/json" \
  -H "X-Appwrite-Project: [YOUR-PROJECT-ID]" \
  -H "X-Appwrite-Key: [YOUR-API-KEY]" \
  -d '{
    "documentId": "unique()",
    "data": {
      "name": "Test User",
      "email": "test@example.com",
      "role": "manager",
      "managerId": null
    }
  }'
```

## Common Error Messages

### "Document with the requested ID already exists"
**Cause:** Trying to create a user document with an ID that already exists.

**Solution:**
1. Check Appwrite Console → Databases → users collection
2. Delete the existing document with that ID
3. Or use a different email address

### "Unauthorized permissions"
**Cause:** Collection permissions not set correctly.

**Solution:**
1. Go to Appwrite Console → Databases → crm-database-1 → users
2. Settings → Permissions
3. Add: Read (Any), Create/Update/Delete (Users)

### "Database not found"
**Cause:** Database `crm-database-1` doesn't exist.

**Solution:**
```bash
npm run setup:appwrite
```

### "Collection not found"
**Cause:** `users` collection doesn't exist.

**Solution:**
```bash
npm run setup:appwrite
```

## Verification Checklist

- [ ] Database `crm-database-1` exists in Appwrite Console
- [ ] Collection `users` exists with correct attributes
- [ ] Collection permissions are set correctly (Read: Any, Create/Update/Delete: Users)
- [ ] Environment variables are loaded (check `/api/debug-config`)
- [ ] Dev server has been restarted after env changes
- [ ] Browser cache cleared or using incognito mode
- [ ] API key has correct permissions (for setup script)
- [ ] Email/Password auth is enabled in Appwrite Console

## Still Having Issues?

1. **Check Appwrite Status:** https://status.appwrite.io
2. **Check Appwrite Logs:** Console → Overview → Logs
3. **Enable Verbose Logging:** Check all console logs in browser DevTools
4. **Try Incognito Mode:** Rules out browser cache issues
5. **Recreate Database:** Delete and run setup script again
6. **Check Network Tab:** Look for failed API requests

## Contact Information

If issues persist, check:
- Appwrite Documentation: https://appwrite.io/docs
- Appwrite Discord: https://appwrite.io/discord
- GitHub Issues: https://github.com/appwrite/appwrite/issues
