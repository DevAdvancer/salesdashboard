# Implementation Plan: Team Lead Role Hierarchy

## Overview

Introduce the `team_lead` role into SalesHub CRM, migrate from single `branchId` to multi-branch `branchIds`, update user creation hierarchy, lead assignment logic, access control, and the lead form. Tasks are ordered to build foundational changes first (types, schema), then services, then contexts, then UI.

## Tasks

- [x] 1. Update TypeScript types and constants
  - [x] 1.1 Update `lib/types/index.ts` with new role, User interface (branchIds, teamLeadId), CreateTeamLeadInput, updated CreateAgentInput, and updated AuthContext interface
    - Add `'team_lead'` to `UserRole` union
    - Change `branchId: string | null` to `branchIds: string[]` and add `teamLeadId: string | null` on `User`
    - Add `CreateTeamLeadInput` interface with name, email, password, managerId, branchIds
    - Update `CreateAgentInput` to use teamLeadId and branchIds instead of managerId
    - Add `isTeamLead: boolean` to `AuthContext` interface
    - _Requirements: 1.1, 8.1, 8.2, 8.3, 8.4_

  - [x]* 1.2 Write property test for role validation (Property 1)
    - **Property 1: Role validation**
    - Generate random strings with fast-check, verify only 'admin', 'manager', 'team_lead', 'agent' pass a `isValidRole` helper
    - **Validates: Requirements 1.1, 1.2**

- [x] 2. Database schema migration via Appwrite MCP
  - [x] 2.1 Create migration script `scripts/migrate-team-lead.ts` that uses Appwrite SDK to update the database schema
    - Update `users` collection: add `team_lead` to role enum attribute
    - Update `users` collection: add `branchIds` string array attribute
    - Update `users` collection: add `teamLeadId` string attribute
    - Update `access_config` collection: add `team_lead` to role enum attribute
    - Migrate existing user documents: convert `branchId` to single-element `branchIds` array
    - Seed default access_config rules for team_lead role
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 2.4_

- [x] 3. Update user-service with team lead creation and multi-branch support
  - [x] 3.1 Update `mapDocToUser` in `lib/services/user-service.ts` to map `branchIds` and `teamLeadId` fields
    - _Requirements: 2.1_

  - [x] 3.2 Add `createTeamLead` function to `lib/services/user-service.ts`
    - Fetch manager, validate input branchIds ⊆ manager.branchIds
    - Create Appwrite auth account and user document with role='team_lead', managerId, branchIds
    - _Requirements: 3.2, 3.5_

  - [x] 3.3 Update `createAgent` function to accept teamLeadId and branchIds
    - Fetch team lead, validate input branchIds ⊆ teamLead.branchIds
    - Set managerId = teamLead.managerId, teamLeadId = input.teamLeadId
    - _Requirements: 3.3, 3.6_

  - [x] 3.4 Add `getAssignableUsers` function to `lib/services/user-service.ts`
    - Manager: return team_leads + agents with overlapping branchIds
    - Team Lead: return agents with overlapping branchIds
    - Agent: return empty array
    - _Requirements: 4.2, 4.3, 4.4_

  - [x] 3.5 Update `getUsersByBranch` to query `branchIds` array and add `getUsersByBranches` function
    - _Requirements: 2.3, 5.5, 5.6_

  - [x] 3.6 Write property test for branch subset validation (Property 5)
    - **Property 5: Branch subset validation on user creation**
    - Generate random creator branchIds and target branchIds, verify subset acceptance/rejection
    - **Validates: Requirements 3.2, 3.3, 3.4**

  - [x] 3.7 Write property test for hierarchy chain correctness (Property 6)
    - **Property 6: Hierarchy chain correctness**
    - Generate random manager→team_lead and team_lead→agent creation pairs, verify managerId/teamLeadId
    - **Validates: Requirements 3.5, 3.6**

  - [x] 3.8 Write property test for assignable users filtering (Property 8)
    - **Property 8: Assignable users filtering**
    - Generate random user sets with various roles and branchIds, verify getAssignableUsers returns correct filtered set
    - **Validates: Requirements 4.2, 4.3, 4.4**

- [x] 4. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Update lead-service with multi-branch filtering
  - [x] 5.1 Update `listLeads` in `lib/services/lead-service.ts` to accept `branchIds: string[]` and filter by role
    - Admin: no branch filter
    - Manager/Team_Lead: filter leads where branchId is in user's branchIds
    - Agent: filter by assignedToId
    - _Requirements: 5.1, 5.2, 5.3, 5.4_

  - [x] 5.2 Update `createLead` to auto-set ownerId from the creating user
    - _Requirements: 4.1_

  - [x]* 5.3 Write property test for lead visibility scoping (Property 9)
    - **Property 9: Lead visibility scoping**
    - Generate random leads across branches and querying users of each role, verify correct filtering
    - **Validates: Requirements 5.1, 5.2, 5.3, 5.4**

  - [x]* 5.4 Write property test for auto-ownership (Property 7)
    - **Property 7: Auto-ownership on lead creation**
    - Generate random users and lead data, verify ownerId equals creator's ID
    - **Validates: Requirements 4.1**

- [x] 6. Update form-config-service and lead form
  - [x] 6.1 Remove Owner (id='8') and Assigned To (id='9') from `DEFAULT_FIELDS` in `lib/services/form-config-service.ts`
    - _Requirements: 4.5_

  - [x] 6.2 Create `components/lead-assignment-dropdown.tsx` component
    - Fetch assignable users via `getAssignableUsers`
    - Render dropdown for Manager and Team_Lead roles
    - Hide for Agent role
    - _Requirements: 4.2, 4.3, 4.4_

  - [x] 6.3 Update `components/dynamic-lead-form.tsx` to integrate the lead assignment dropdown and auto-set ownerId
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5_

- [x] 7. Update auth context and access control context
  - [x] 7.1 Update `lib/contexts/auth-context.tsx` to add `isTeamLead` helper and map `branchIds`/`teamLeadId` from user document
    - _Requirements: 1.3, 8.4_

  - [x] 7.2 Update `lib/contexts/access-control-context.tsx` to include team_lead role in access rules and default permissions
    - Add team_lead to AccessRule role type
    - Set default access: dashboard, leads, history, user-management = true; field-management, settings, branch-management = false
    - _Requirements: 6.1, 6.2, 6.3_

- [x] 8. Update user management page
  - [x] 8.1 Update `app/users/page.tsx` to support creating Team Leads (by Managers) and Agents (by Team Leads)
    - Manager sees "Create Team Lead" button with branch multi-select (from their branchIds)
    - Team Lead sees "Create Agent" button with branch multi-select (from their branchIds)
    - Display role column in user table
    - _Requirements: 3.1, 3.2, 3.3_

  - [x] 8.2 Update user list to show users scoped to the current user's branches
    - Use `getUsersByBranches` for Manager and Team_Lead roles
    - _Requirements: 5.5, 5.6_

- [x] 9. Update navigation and lead list pages
  - [x] 9.1 Update `components/navigation.tsx` to display `team_lead` role label properly
    - _Requirements: 6.4_

  - [x] 9.2 Update lead list page to pass `branchIds` array instead of single `branchId` to `listLeads`
    - _Requirements: 5.2, 5.3_

  - [x]* 9.3 Write property test for user visibility scoping (Property 10)
    - **Property 10: User visibility scoping**
    - Generate random user sets with various branchIds, verify getUsersByBranches returns only users with overlapping branches
    - **Validates: Requirements 5.5, 5.6**

- [x] 10. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties using fast-check
- Unit tests validate specific examples and edge cases
- The migration script (task 2.1) should be run against the Appwrite instance using Appwrite MCP tools or the Appwrite SDK directly
