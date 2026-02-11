# Implementation Plan: Admin Manager Creation Authorization Fix

## Overview

Fix the authorization issue where administrators are unable to create manager accounts. The issue is in the `createManagerAction` function in `app/actions/user.ts` where it checks `callerDoc.role !== 'admin'`. This fix should follow the same patterns used for other role creation functions (team lead, agent) and ensure consistency across all 4 roles.

## Tasks

- [x] 1. Debug the current issue
  - [x] 1.1 Add console logging to `createManagerAction` to debug authentication
    - Log current user ID and session status
    - Log retrieved caller document
    - Log role check result
    - _Requirements: 1.1, 1.2_

- [ ] 2. Fix createManagerAction to match other creation functions
  - [x] 2.1 Make `createManagerAction` consistent with `createTeamLeadAction` and `createAgentAction`
    - Use same error handling pattern
    - Use same permission structure
    - Follow same validation flow
    - _Requirements: 1.1, 1.3, 4.1_

  - [x] 2.2 Fix role validation logic
    - Ensure `getUserDoc` retrieves correct user document
    - Fix role comparison logic
    - Add proper error messages
    - _Requirements: 1.1, 2.1, 2.3_

  - [x] 2.3 Remove unnecessary branch validation for admin
    - Admin can assign any branches (no subset validation)
    - Keep branch existence validation
    - _Requirements: 3.1_

- [ ] 3. Test the fix
  - [x] 3.1 Test admin creating manager
    - Verify successful creation
    - Test error cases
    - _Requirements: 1.1, 1.3_

  - [x] 3.2 Ensure no regressions in other user creation flows
    - Test team lead creation
    - Test agent creation
    - _Requirements: 4.1, 4.2_

## Implementation Notes

1. **Minimal fix**: Only change what's necessary to fix the authorization issue.

2. **Consistency**: Make `createManagerAction` follow the same patterns as `createTeamLeadAction` and `createAgentAction`.

3. **Branch assignment**: Admin can assign any active branches to managers (no restrictions).

## Expected Outcome

After fixing, admins can create managers and assign any branches.