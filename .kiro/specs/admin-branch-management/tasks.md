# Implementation Plan: Admin & Branch Management

## Overview

Incrementally extend the SalesHub CRM with an admin role, branch management, branch-scoped data visibility, and cross-branch lead validation. Each task builds on the previous, starting with types and data layer, then services, then UI, then wiring everything together.

## Tasks

- [x] 1. Update core types and constants
  - [x] 1.1 Update `lib/types/index.ts` to extend `UserRole` to `'admin' | 'manager' | 'agent'`, add `branchId: string | null` to `User` and `Lead` interfaces, add `Branch`, `CreateBranchInput`, `UpdateBranchInput`, and `LeadValidationResult` interfaces
    - _Requirements: 1.1, 2.1, 4.5, 5.3_
  - [x] 1.2 Update `lib/constants/default-access.ts` to add `'admin'` to `UserRole`, add `'branch-management'` to `ComponentKey`, and add default access rules for admin role (all allowed) and branch-management (manager: false, agent: false)
    - _Requirements: 8.1, 8.2, 8.3_
  - [x] 1.3 Update `lib/appwrite.ts` to add `BRANCHES` to the `COLLECTIONS` object pointing to a new env variable `NEXT_PUBLIC_APPWRITE_BRANCHES_COLLECTION_ID`
    - _Requirements: 2.1_

- [x] 2. Implement Branch Service
  - [x] 2.1 Create `lib/services/branch-service.ts` with `createBranch`, `getBranch`, `updateBranch`, `deleteBranch`, `listBranches`, and `getBranchStats` functions. `createBranch` sets `isActive: true`. `deleteBranch` checks for assigned managers and active leads before allowing deletion. Use Appwrite `Query.equal('name', name)` to enforce unique branch names in `createBranch`.
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_
  - [x]* 2.2 Write property tests for Branch Service in `tests/property/branch-properties.test.ts`
    - **Property 4: Branch creation sets active status**
    - **Property 5: Branch name uniqueness**
    - **Property 6: Branch deletion guard**
    - **Property 7: Branch listing includes correct stats**
    - **Property 9: Multiple managers per branch**
    - **Property 20: Branch update modifies specified fields only**
    - **Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5, 3.3**

- [x] 3. Implement Lead Validator
  - [x] 3.1 Create `lib/services/lead-validator.ts` with `validateLeadUniqueness(data: LeadData, excludeLeadId?: string): Promise<LeadValidationResult>`. Query the leads collection globally (no branch filter) for matching email or phone in the `data` JSON field. Return `{ isValid: true }` or `{ isValid: false, duplicateField, existingLeadId, existingBranchId }`.
    - _Requirements: 5.1, 5.2, 5.3, 5.4_
  - [x]* 3.2 Write property tests for Lead Validator in `tests/property/branch-lead-properties.test.ts`
    - **Property 16: Cross-branch duplicate detection for email and phone**
    - **Property 17: Duplicate check excludes self on update**
    - **Validates: Requirements 5.1, 5.2, 5.3, 5.4**

- [x] 4. Update User Service for branch awareness
  - [x] 4.1 Update `lib/services/user-service.ts`: add `branchId` field to `createAgent` (inherit from manager's branch), add `assignManagerToBranch(managerId, branchId)` that updates manager's branchId and cascades to all linked agents, add `removeManagerFromBranch(managerId)` that clears branchId for manager and all linked agents, add `getUsersByBranch(branchId)`, add `getUnassignedManagers()`, update `getAgentsByManager` to include branchId in returned data
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 4.2, 4.4, 6.2_
  - [x]* 4.2 Write property tests for User Service branch features in `tests/property/branch-user-properties.test.ts`
    - **Property 8: Manager-to-branch assignment cascades to agents**
    - **Property 10: Manager removal cascades to agents**
    - **Property 12: Manager sees only branch agents**
    - **Property 14: Admin sees all agents across branches**
    - **Property 19: Admin can specify manager and branch on agent creation**
    - **Validates: Requirements 3.1, 3.2, 3.4, 4.2, 4.4, 6.2**

- [x] 5. Update Lead Service for branch awareness
  - [x] 5.1 Update `lib/services/lead-service.ts`: add `branchId` to `createLead` (auto-set from user's branch, or allow admin to specify), update `listLeads` to filter by `branchId` for managers (using `Query.equal('branchId', branchId)`) and show all for admins, integrate `validateLeadUniqueness` call before creating or updating leads
    - _Requirements: 4.1, 4.3, 4.5, 5.1, 5.2, 6.1_
  - [x]* 5.2 Write property tests for Lead Service branch features in `tests/property/branch-lead-properties.test.ts`
    - **Property 11: Manager sees only branch leads**
    - **Property 13: Admin sees all leads across branches**
    - **Property 15: Lead creation inherits creator's branchId**
    - **Property 18: Admin can specify branchId on lead creation**
    - **Validates: Requirements 4.1, 4.3, 4.5, 6.1**

- [x] 6. Checkpoint - Ensure all service-layer tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 7. Update Auth Context and Access Control
  - [x] 7.1 Update `lib/contexts/auth-context.tsx`: add `isAdmin` property (`user?.role === 'admin'`), update `isManager` to return `true` for both admin and manager roles, add `branchId` from user document to the context, update `fetchUserDocument` to include `branchId` in the returned User object
    - _Requirements: 1.2, 1.3_
  - [x] 7.2 Update `lib/contexts/access-control-context.tsx`: add `'branch-management'` to `ComponentKey` type, update `canAccess` to grant admin users access to all components including branch-management, ensure manager users cannot access branch-management
    - _Requirements: 1.3, 8.2, 8.3, 8.4_
  - [ ]* 7.3 Write property tests for access control in `tests/property/branch-access-properties.test.ts`
    - **Property 1: Admin access is a superset of manager access**
    - **Property 2: Manager is excluded from branch management**
    - **Property 3: Signup never creates admin accounts**
    - **Validates: Requirements 1.2, 1.3, 1.4, 8.2, 8.3, 8.4**

- [x] 8. Create Branch Management UI
  - [x] 8.1 Create `app/branches/page.tsx` with a `ProtectedRoute` wrapper using `componentKey="branch-management"`. Include a branch list table showing name, status, manager count, and lead count. Add a create branch form with name input and zod validation. Add edit and delete actions per branch row. Add a manager assignment dropdown per branch (showing unassigned managers and managers from other branches).
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5_

- [x] 9. Update Navigation and existing pages
  - [x] 9.1 Update `components/navigation.tsx`: add a `branch-management` nav item with `Building2` icon from lucide-react, positioned after dashboard in the nav list. The item is filtered by `canAccess('branch-management')` like all other items.
    - _Requirements: 8.2, 8.3_
  - [x] 9.2 Update `app/signup/page.tsx` (or the signup logic) to ensure the signup flow always creates users with role `'manager'` and never `'admin'`. Admin accounts are created only through direct database operations or a separate admin seeding script.
    - _Requirements: 1.4_
  - [x] 9.3 Update `app/leads/new/page.tsx` and lead creation flow to call `validateLeadUniqueness` before submitting, and display duplicate errors inline. For admin users, add a branch selector dropdown to the lead creation form.
    - _Requirements: 5.1, 5.2, 5.3, 6.1_
  - [x] 9.4 Update `app/users/page.tsx` to show branch information for each user, and for admin users, allow creating agents with a branch/manager selector.
    - _Requirements: 4.2, 6.2_

- [x] 10. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties
- Unit tests validate specific examples and edge cases
- The `branches` Appwrite collection must be created manually or via the setup script before running the app
