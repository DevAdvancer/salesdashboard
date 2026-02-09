# Quick Fix Guide - Authentication Issues

## Problem
- User document not created with correct auth ID
- Not redirecting to dashboard after signup

## Quick Fix (5 Steps)

### 1. Verify Setup
```bash
npm run verify:appwrite
```

If you see errors, continue to step 2. If all checks pass, skip to step 4.

### 2. Fix Appwrite Permissions

**Go to Appwrite Console:**
1. Open https://cloud.appwrite.io
2. Select your project
3. Go to: **Databases** → **crm-database-1** → **users**
4. Click **Settings** tab → **Permissions**
5. Add these permissions if missing:
   - Click **"+ Add Role"**
   - Select **"Any"** → Check **"Read"** → Save
   - Click **"+ Add Role"** again
   - Select **"Users"** → Check **"Create"** → Save
   - Click **"+ Add Role"** again
   - Select **"Users"** → Check **"Update"** → Save
   - Click **"+ Add Role"** again
   - Select **"Users"** → Check **"Delete"** → Save

### 3. Restart Dev Server
```bash
# Press Ctrl+C to stop
npm run dev
```

### 4. Test Authentication
1. Open: http://localhost:3000/test-auth
2. Click **"Test Full Signup Flow"**
3. Watch the logs - they will show exactly what's happening

### 5. Try Signup
1. Clear browser cache or open incognito window
2. Go to: http://localhost:3000/signup
3. Open browser DevTools (F12) → Console tab
4. Fill in the signup form
5. Submit and watch the console logs

## Expected Console Output

You should see:
```
Starting signup process...
Database ID: crm-database-1
Users Collection ID: users
Creating Appwrite account...
Account created successfully: [ACCOUNT_ID]
Creating user document with ID: [ACCOUNT_ID]
User document created successfully: [ACCOUNT_ID]
Creating session...
Session created successfully
Setting user state: {...}
Signup completed successfully
Submitting signup form...
Signup successful, redirecting to dashboard...
```

## Still Not Working?

### Check 1: Database Exists
```bash
npm run setup:appwrite
```

### Check 2: Environment Variables
Visit: http://localhost:3000/api/debug-config

Should show:
```json
{
  "databaseId": "crm-database-1",
  "collections": {
    "users": "users"
  }
}
```

### Check 3: Appwrite Console
1. Go to **Auth** → **Users**
2. Check if user account was created
3. Go to **Databases** → **crm-database-1** → **users**
4. Check if user document exists with same ID as auth user

## Common Errors

### "Unauthorized permissions"
→ Fix permissions (see Step 2 above)

### "Document with the requested ID already exists"
→ Delete the existing document in Appwrite Console → Databases → users

### "Database not found"
→ Run: `npm run setup:appwrite`

### "Collection not found"
→ Run: `npm run setup:appwrite`

## Tools Available

1. **Test Tool**: http://localhost:3000/test-auth
   - Tests full signup flow
   - Shows detailed logs
   - Tests permissions

2. **Debug Config**: http://localhost:3000/api/debug-config
   - Shows environment variables
   - Verifies configuration

3. **Verify Script**: `npm run verify:appwrite`
   - Checks database structure
   - Checks permissions
   - Checks default data

4. **Setup Script**: `npm run setup:appwrite`
   - Creates database
   - Creates collections
   - Sets up attributes
   - Seeds default data

## Need More Help?

See detailed guides:
- `docs/AUTH_FIX_SUMMARY.md` - Complete fix summary
- `docs/TROUBLESHOOTING_AUTH.md` - Comprehensive troubleshooting
