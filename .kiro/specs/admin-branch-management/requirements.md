# Requirements Document

## Introduction

This feature introduces an Admin role and a Branch management system to the SalesHub CRM. The Admin sits above the Manager in the role hierarchy (Admin > Manager > Agent). Admins can create branches, assign managers to branches, and perform all actions a manager can. Managers are scoped to their assigned branch and can only see leads and users within that branch. Lead validation for duplicate email and phone number checking operates globally across all branches to prevent duplicate leads system-wide.

## Glossary

- **Admin**: A user with the highest-level role who can create branches, assign managers, and perform all manager-level operations across all branches.
- **Manager**: A user assigned to a specific branch who can manage leads and agents within that branch only.
- **Agent**: A user linked to a manager who handles leads assigned to them within the manager's branch.
- **Branch**: An organizational unit within the CRM that groups managers, agents, and leads together.
- **Branch_Service**: The service responsible for creating, updating, deleting, and listing branches.
- **User_Service**: The service responsible for creating, updating, and managing user accounts and role assignments.
- **Lead_Service**: The service responsible for creating, updating, listing, and validating leads.
- **Lead_Validator**: The component responsible for checking duplicate email and phone number entries across all branches.
- **Access_Control**: The component responsible for determining what resources and pages a user can access based on their role and branch assignment.
- **Auth_Context**: The authentication context that provides the current user's identity, role, and branch information.

## Requirements

### Requirement 1: Admin Role

**User Story:** As a system owner, I want an Admin role that sits above Manager in the hierarchy, so that I can manage the entire CRM including branches and manager assignments.

#### Acceptance Criteria

1. THE User_Service SHALL support three roles: admin, manager, and agent with a hierarchy where admin has the highest privileges.
2. WHEN an admin user logs in, THE Auth_Context SHALL identify the user as admin and grant access to all system features.
3. WHEN an admin accesses any manager-level feature, THE Access_Control SHALL permit the operation without restriction.
4. WHEN a new user signs up, THE Auth_Context SHALL assign the admin role only through a controlled process, not through the public signup flow.

### Requirement 2: Branch Management

**User Story:** As an admin, I want to create and manage branches, so that I can organize the CRM into distinct operational units.

#### Acceptance Criteria

1. WHEN an admin creates a branch, THE Branch_Service SHALL store the branch with a unique name and an active status.
2. WHEN an admin updates a branch, THE Branch_Service SHALL modify the branch name or status as specified.
3. WHEN an admin deletes a branch, THE Branch_Service SHALL prevent deletion if the branch has assigned managers or active leads.
4. WHEN an admin lists branches, THE Branch_Service SHALL return all branches with their assigned manager count and lead count.
5. IF a branch name already exists, THEN THE Branch_Service SHALL reject the creation and return a duplicate name error.

### Requirement 3: Manager-to-Branch Assignment

**User Story:** As an admin, I want to assign managers to branches, so that each branch has a responsible manager overseeing its operations.

#### Acceptance Criteria

1. WHEN an admin assigns a manager to a branch, THE User_Service SHALL update the manager's branchId to the specified branch.
2. WHEN an admin reassigns a manager to a different branch, THE User_Service SHALL update the manager's branchId and move all agents linked to that manager to the new branch.
3. IF a manager is assigned to a branch that already has a manager, THEN THE User_Service SHALL allow the assignment, supporting multiple managers per branch.
4. WHEN an admin removes a manager from a branch, THE User_Service SHALL clear the manager's branchId and unlink all agents associated with that manager from the branch.

### Requirement 4: Branch-Scoped Data Visibility

**User Story:** As a manager, I want to see only the leads and users within my assigned branch, so that I can focus on my branch's operations without seeing other branches' data.

#### Acceptance Criteria

1. WHEN a manager lists leads, THE Lead_Service SHALL return only leads belonging to the manager's assigned branch.
2. WHEN a manager lists agents, THE User_Service SHALL return only agents within the manager's assigned branch.
3. WHEN an admin lists leads, THE Lead_Service SHALL return leads from all branches.
4. WHEN an admin lists agents, THE User_Service SHALL return agents from all branches.
5. WHEN a lead is created, THE Lead_Service SHALL associate the lead with the creating user's branch by storing the branchId on the lead.

### Requirement 5: Global Lead Validation

**User Story:** As a system owner, I want lead duplicate checking to work across all branches, so that the same lead is not entered in multiple branches.

#### Acceptance Criteria

1. WHEN a new lead is created with an email address, THE Lead_Validator SHALL check for duplicate email addresses across all branches.
2. WHEN a new lead is created with a phone number, THE Lead_Validator SHALL check for duplicate phone numbers across all branches.
3. IF a duplicate email or phone number is found in any branch, THEN THE Lead_Validator SHALL reject the lead creation and return an error identifying the duplicate field.
4. WHEN a lead is updated with a new email or phone number, THE Lead_Validator SHALL perform the same cross-branch duplicate check excluding the lead being updated.

### Requirement 6: Admin Performs Manager Operations

**User Story:** As an admin, I want to perform all operations that a manager can, so that I can step in and manage any branch when needed.

#### Acceptance Criteria

1. WHEN an admin creates a lead, THE Lead_Service SHALL allow the admin to specify which branch the lead belongs to.
2. WHEN an admin creates an agent, THE User_Service SHALL allow the admin to specify which manager and branch the agent belongs to.
3. WHEN an admin manages leads in a specific branch, THE Lead_Service SHALL apply the same business rules as for a manager within that branch.
4. WHEN an admin accesses the dashboard, THE Access_Control SHALL display aggregated data across all branches.

### Requirement 7: Branch Management UI

**User Story:** As an admin, I want a dedicated branch management page, so that I can create, edit, and manage branches through the application interface.

#### Acceptance Criteria

1. WHEN an admin navigates to the branch management page, THE Access_Control SHALL display the page only for users with the admin role.
2. WHEN the branch management page loads, THE Branch_Service SHALL display a list of all branches with their name, status, assigned managers, and lead count.
3. WHEN an admin submits the create branch form with a valid name, THE Branch_Service SHALL create the branch and update the displayed list.
4. WHEN an admin clicks edit on a branch, THE Branch_Service SHALL display a form pre-filled with the branch details for modification.
5. WHEN an admin assigns a manager to a branch from the UI, THE User_Service SHALL present a dropdown of unassigned managers and managers from other branches.

### Requirement 8: Updated Navigation and Access Control

**User Story:** As a user of any role, I want the navigation and access control to reflect the new role hierarchy, so that I see only the features relevant to my role.

#### Acceptance Criteria

1. THE Access_Control SHALL support three roles in access rules: admin, manager, and agent.
2. WHEN an admin user is logged in, THE Access_Control SHALL show navigation items for branch management, user management, lead management, field management, settings, dashboard, and history.
3. WHEN a manager user is logged in, THE Access_Control SHALL hide the branch management navigation item.
4. WHEN the Access_Control evaluates permissions, THE Access_Control SHALL treat admin as having all permissions that manager has plus branch management permissions.
