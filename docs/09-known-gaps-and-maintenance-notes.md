# Known Gaps And Maintenance Notes

This file is intentionally direct. It documents the implementation mismatches and maintenance hazards that a future contributor should know before making changes.

## 1. `docs`, `README`, And Runtime Behavior Are Not Fully Aligned

Examples:

- Older docs mention port `3000`, but `npm run dev` uses port `5000`.
- The checked-in example env file is missing several variables that the code actually reads.

## 2. Some `package.json` Scripts Point To Missing Files

Current scripts reference:

- `scripts/setup-appwrite.ts`
- `scripts/verify-setup.ts`
- `scripts/promote-to-admin.ts`

Those files do not currently exist in the repository.

Impact:

- New developers may assume setup automation exists when it does not.

## 3. Branch Logic Uses Both `branchId` And `branchIds`

Most current user flows store and read `branchIds`, but some branch-service code still checks `branchId`.

Impact:

- branch stats can be misleading
- deletion guards can miss assigned users
- any schema cleanup needs careful migration

## 4. Access Settings UI Does Not Cover Every Component Key Used By The App

`useAccess()` understands these newer keys:

- `mock`
- `assessment-support`
- `interview-support`
- `hierarchy`

But `app/settings/access/page.tsx` only exposes an older subset of components in its editor UI.

Impact:

- some routes are governed by defaults or manual DB seeding, not by the settings screen

## 5. There Is Business-Rule Duplication Between Client Services And Server Actions

Examples:

- lead visibility and permission logic exists in both `lib/services/lead-service.ts` and `app/actions/lead.ts`
- user creation logic exists in both `lib/services/user-service.ts` and `app/actions/user.ts`

Impact:

- fixes can become partial
- one path can silently drift from another

## 6. Interview Attempt Collection Default Name Looks Suspicious

`lib/constants/appwrite.ts` sets the fallback for interview attempts to:

- `interview_attempts_`

There is a trailing underscore in the fallback string.

Impact:

- if env vars are missing, the app can point to the wrong collection name

## 7. Audit Logging Field Naming Is Not Perfectly Uniform

Most audit logic uses `performedAt`, but parts of server action code have comments or inserts that imply slightly different assumptions.

Impact:

- future schema changes to audit logs should be verified across all audit writers, not just one module

## 8. Auth Context Does Not Fully Mirror The Expanded User Schema

`AuthProvider.fetchUserDocument()` returns:

- `managerId`
- `teamLeadId`
- `branchIds`

But it does not fully hydrate every newer field such as:

- `managerIds`
- `assistantManagerIds`

Impact:

- some UI paths rely on direct document reads elsewhere rather than only the auth context

## 9. Special-Case User Access Exists In Code

Lead listing gives special visibility to:

- `shashi.pathak@silverspaceinc.com`

Impact:

- access behavior is not purely role-based
- any security review should include hardcoded exceptions

## 10. Support Workflows Depend On Browser-Side File Conversion

Mock, assessment, and interview pages:

- read attachments in the browser
- convert them to base64
- send them through API routes to Graph

Impact:

- file size matters
- large attachments or browser memory issues can affect UX

## Recommended Maintenance Habits

### Before Changing Hierarchy Logic

- Search for `managerId`
- Search for `managerIds`
- Search for `assistantManagerId`
- Search for `assistantManagerIds`
- Search for `teamLeadId`

### Before Changing Lead Visibility

- Check both `lib/services/lead-service.ts` and `app/actions/lead.ts`
- Run integration and property tests around visibility

### Before Changing Branch Logic

- Review both `branchId` and `branchIds`
- Verify effects in user creation, branch stats, and lead creation

### Before Changing Support Email Flows

- Review all three pages: mock, assessment, interview
- Review the matching action file
- Review the matching `/api/*/send-email` route

### Before Changing Access Rules

- Review:
  - `lib/contexts/access-control-context.tsx`
  - `components/navigation.tsx`
  - `components/protected-route.tsx`
  - `app/settings/access/page.tsx`
