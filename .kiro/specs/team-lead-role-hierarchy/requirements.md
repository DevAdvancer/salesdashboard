# Requirements Document

## Introduction

This feature introduces a "Team Lead" role into the SalesHub CRM, restructuring the user hierarchy from Admin → Manager → Agent to Admin → Manager → Team Lead → Agent. It also migrates from single-branch assignment (branchId) to multi-branch assignment (branchIds) for all users, updates lead assignment logic to be role-aware and branch-scoped, and removes Owner/Assigned To from configurable form fields in favor of automatic and dynamic assignment.

## Glossary

- **CRM**: The SalesHub Customer Relationship Management application
- **Admin**: The highest-privilege role with full system access
- **Manager**: A role that manages Team Leads and has access to multiple branches
- **Team_Lead**: A new mid-level role between Manager and Agent that manages Agents within assigned branches
- **Agent**: The lowest-privilege role that works on assigned leads
- **Branch**: An organizational unit representing a business location or division
- **BranchIds**: A string array field on the User document storing multiple branch assignments (replaces the single branchId field)
- **Lead**: A sales prospect record containing customer data, ownership, and assignment information
- **Owner**: The user who created a lead (automatically set on creation)
- **Assigned_To**: The user a lead is delegated to for follow-up (dynamically selected based on role and branch)
- **Role_Hierarchy**: The chain of authority: Admin → Manager → Team_Lead → Agent
- **Appwrite**: The backend-as-a-service platform used for database, authentication, and access control
- **Form_Config**: The configurable form field definitions used to render the lead creation/edit form
- **Access_Config**: The database collection storing per-role component access rules

## Requirements

### Requirement 1: Role Enum Extension

**User Story:** As an admin, I want the system to support a team_lead role, so that I can establish a four-tier management hierarchy.

#### Acceptance Criteria

1. THE CRM SHALL support four user roles: admin, manager, team_lead, and agent
2. WHEN a user document is created or updated, THE CRM SHALL validate that the role field contains one of the four allowed values (admin, manager, team_lead, agent)
3. WHEN the Auth_Context loads a user, THE CRM SHALL expose an isTeamLead boolean helper alongside the existing isAdmin, isManager, and isAgent helpers

### Requirement 2: Multi-Branch Assignment

**User Story:** As a manager, I want to be assigned to multiple branches, so that I can oversee operations across several locations.

#### Acceptance Criteria

1. THE CRM SHALL store branch assignments as a branchIds string array field on each User document, replacing the single branchId string field
2. WHEN a user is assigned branches, THE CRM SHALL accept an array of one or more branch IDs
3. WHEN the system queries users by branch, THE CRM SHALL match users whose branchIds array contains the queried branch ID
4. WHEN migrating existing data, THE CRM SHALL convert each existing branchId value into a single-element branchIds array

### Requirement 3: User Creation Hierarchy

**User Story:** As a manager, I want to create team leads and assign them branches from my own branch set, so that I can delegate branch-level management.

#### Acceptance Criteria

1. WHEN an Admin creates a Manager, THE CRM SHALL allow assigning any combination of active branches to the Manager
2. WHEN a Manager creates a Team_Lead, THE CRM SHALL restrict the assignable branches to a subset of the Manager's own branchIds
3. WHEN a Team_Lead creates an Agent, THE CRM SHALL restrict the assignable branches to a subset of the Team_Lead's own branchIds
4. IF a user attempts to assign a branch that is not in the creator's own branchIds, THEN THE CRM SHALL reject the operation with a descriptive error message
5. WHEN a Manager creates a Team_Lead, THE CRM SHALL set the Team_Lead's managerId to the Manager's user ID
6. WHEN a Team_Lead creates an Agent, THE CRM SHALL set the Agent's teamLeadId to the Team_Lead's user ID and the Agent's managerId to the Team_Lead's managerId

### Requirement 4: Lead Ownership and Assignment

**User Story:** As a team lead, I want leads I create to be automatically owned by me and to assign them to agents in my branches, so that lead tracking is accurate and scoped.

#### Acceptance Criteria

1. WHEN any user creates a lead, THE CRM SHALL automatically set the ownerId to the creating user's ID
2. WHEN a Manager creates a lead, THE CRM SHALL display an Assigned_To dropdown containing Team_Leads and Agents whose branchIds overlap with the Manager's branchIds
3. WHEN a Team_Lead creates a lead, THE CRM SHALL display an Assigned_To dropdown containing only Agents whose branchIds overlap with the Team_Lead's branchIds
4. WHEN an Agent creates a lead, THE CRM SHALL omit the Assigned_To dropdown and set assignedToId to the Agent's own ID
5. THE CRM SHALL remove the Owner (ownerId) and Assigned_To (assignedToId) fields from the configurable Form_Config field list

### Requirement 5: Branch-Scoped Data Visibility

**User Story:** As a team lead, I want to see leads and users only from my assigned branches, so that I can focus on my area of responsibility.

#### Acceptance Criteria

1. THE CRM SHALL grant Admin users visibility to all leads and users across all branches
2. WHEN a Manager queries leads, THE CRM SHALL return only leads whose branchId matches any of the Manager's branchIds
3. WHEN a Team_Lead queries leads, THE CRM SHALL return only leads whose branchId matches any of the Team_Lead's branchIds
4. WHEN an Agent queries leads, THE CRM SHALL return only leads where the assignedToId matches the Agent's user ID
5. WHEN a Manager queries users, THE CRM SHALL return only users whose branchIds overlap with the Manager's branchIds
6. WHEN a Team_Lead queries users, THE CRM SHALL return only users whose branchIds overlap with the Team_Lead's branchIds

### Require
d, THE CRM SHALL include team_lead as a valid role value alongside admin, manager, and agent
4. WHEN a Team_Lead navigates the application, THE CRM SHALL display only the navigation items the team_lead role is permitted to access

### Requirement 7: Database Schema Migration

**User Story:** As a developer, I want the Appwrite database schema updated to support the new role and multi-branch structure, so that the backend correctly stores and validates the new data model.

#### Acceptance Criteria

1. WHEN the schema migration runs, THE CRM SHALL update the users collection role attribute enum to include the value team_lead
2. WHEN the schema migration runs, THE CRM SHALL add a branchIds string array attribute to the users collection
3. WHEN the schema migration runs, THE CRM SHALL add a teamLeadId string attribute to the users collection
4. WHEN the schema migration runs, THE CRM SHALL update the access_config collection role attribute enum to include the value team_lead
5. WHEN the schema migration runs, THE CRM SHALL populate branchIds from existing branchId values for all current user documents

### Requirement 8: TypeScript Type Updates

**User Story:** As a developer, I want the TypeScript type definitions updated to reflect the new role and data model, so that the codebase has compile-time safety for the new structure.

#### Acceptance Criteria

1. THE CRM SHALL define UserRole as the union type 'admin' | 'manager' | 'team_lead' | 'agent'
2. THE CRM SHALL define the User interface with a branchIds field of type string[] and a teamLeadId field of type string | null
3. THE CRM SHALL define a CreateTeamLeadInput interface with fields: name, email, password, managerId, and branchIds
4. THE CRM SHALL update the AuthContext interface to include an isTeamLead boolean property
