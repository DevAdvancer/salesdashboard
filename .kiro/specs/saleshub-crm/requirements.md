# Requirements Document

## Introduction

SalesHub CRM is a manager-controlled customer relationship management system designed for hierarchical sales organizations. The system provides managers with complete control over user access, lead form configuration, and lead lifecycle management, while enabling agents to efficiently work on assigned leads within their permitted scope.

## Glossary

- **Manager**: A user role with full system access, including configuration, user management, and lead assignment capabilities
- **Agent**: A user role with limited access, able to work only on assigned leads and view permitted components
- **Lead**: A potential customer record with configurable fields and lifecycle states
- **Active_Lead**: A lead in an open or working state that can be edited
- **Closed_Lead**: A lead that has been completed, converted, or rejected and is read-only
- **History**: A permanent audit log of all closed leads
- **Form_Builder**: A visual interface for managers to configure lead form fields
- **Component**: A major system module (Dashboard, Leads, History, User Management, Field Management, Settings)
- **Access_Config**: Manager-defined rules controlling which roles/users can access which components
- **Form_Config**: Manager-defined configuration of lead form fields including visibility, order, and validation
- **Owner**: The manager responsible for a lead
- **Assigned_Agent**: The agent currently working on a lead
- **System**: The SalesHub CRM application

## Requirements

### Requirement 1: User Role Management

**User Story:** As a system administrator, I want to enforce a two-tier user hierarchy, so that managers have full control while agents work within defined boundaries.

#### Acceptance Criteria

1. THE System SHALL support exactly two user roles: Manager and Agent
2. WHEN a user signs up directly or is created outside User Management, THE System SHALL assign the Manager role
3. WHEN a user is created through User Management, THE System SHALL assign the Agent role and link them to the creating Manager
4. THE System SHALL enforce role-based permissions at both database and application levels
5. WHEN an Agent is created, THE System SHALL store the creating Manager's ID as the Agent's managerId

### Requirement 2: Component Visibility Control

**User Story:** As a manager, I want to control which system components are visible to different roles and users, so that I can customize the experience based on responsibilities.

#### Acceptance Criteria

1. THE System SHALL provide a component visibility matrix with components as rows and roles/users as columns
2. WHEN a Manager modifies component visibility settings, THE System SHALL persist changes to Access_Config
3. THE System SHALL support visibility control for these components: Dashboard, Leads, History, User Management, Field Management, Settings
4. WHEN an Agent logs in, THE System SHALL display only components marked as visible for their role or user ID
5. WHEN a Manager logs in, THE System SHALL display all components regardless of visibility settings
6. THE System SHALL apply visibility rules before rendering navigation and routing

### Requirement 3: Lead Form Builder

**User Story:** As a manager, I want to design and configure the lead form without writing code, so that I can adapt the form to changing business needs.

#### Acceptance Criteria

1. THE System SHALL provide a visual Form_Builder interface accessible only to Managers
2. WHEN a Manager uses Form_Builder, THE System SHALL allow adding, removing, reordering, and configuring fields
3. THE System SHALL support these field types: Text, Email, Phone, Dropdown, Textarea, Checklist
4. THE System SHALL provide these default fields: First Name, Last Name, Email, Phone, Company, Source, Status, Owner, Assigned To, Legal Name, SSN (last 4), Visa Status, Notes
5. WHEN a Manager configures a field, THE System SHALL allow toggling visibility (visible/hidden) and validation (required/optional)
6. WHEN a Manager configures a Dropdown field, THE System SHALL allow defining custom options for Source, Status, Visa Status, and custom dropdowns
7. WHEN a Manager publishes form changes, THE System SHALL persist the configuration to Form_Config
8. WHEN an Agent views the lead form, THE System SHALL render only fields marked as visible in Form_Config
9. WHEN a user submits a lead form, THE System SHALL validate required fields based on Form_Config
10. THE System SHALL store lead data as dynamic JSON matching the current Form_Config structure

### Requirement 4: Lead Lifecycle Management

**User Story:** As a manager, I want leads to progress through defined lifecycle states, so that I can track lead status and maintain historical records.

#### Acceptance Criteria

1. THE System SHALL support two lead states: Active and Closed
2. WHEN a lead is created, THE System SHALL set its state to Active and isClosed to false
3. WHEN a user closes a lead, THE System SHALL set isClosed to true, record closedAt timestamp, and update status
4. WHEN a lead is closed, THE System SHALL remove it from the Active Leads view
5. WHEN a lead is closed, THE System SHALL add it to the History view
6. WHEN a lead is in History, THE System SHALL make it read-only for all users except for Manager reopen actions
7. WHEN a Manager reopens a lead from History, THE System SHALL set isClosed to false and return it to Active Leads

### Requirement 5: Lead Assignment and Ownership

**User Story:** As a manager, I want to assign leads to specific agents and track ownership, so that accountability is clear and work is distributed effectively.

#### Acceptance Criteria

1. WHEN a lead is created, THE System SHALL require an Owner (Manager) and optionally an Assigned_Agent
2. THE System SHALL allow Managers to assign or reassign any lead to any Agent
3. THE System SHALL prevent Agents from reassigning leads
4. WHEN an Agent views leads, THE System SHALL display only leads where they are the Assigned_Agent
5. WHEN a Manager views leads, THE System SHALL display all leads regardless of assignment
6. THE System SHALL store ownerId and assignedToId as foreign keys in the leads collection

### Requirement 6: Permission Enforcement

**User Story:** As a system architect, I want permissions enforced at the database level, so that security cannot be bypassed through API manipulation.

#### Acceptance Criteria

1. THE System SHALL configure Appwrite collection-level permissions for all collections
2. WHEN an Agent attempts to read a lead, THE System SHALL grant access only if the Agent is the Assigned_Agent or the lead's Owner
3. WHEN an Agent attempts to update a lead, THE System SHALL grant access only if the Agent is the Assigned_Agent and the lead is Active
4. WHEN a Manager attempts any lead operation, THE System SHALL grant full access
5. THE System SHALL restrict Form_Config and Access_Config operations to Managers only
6. WHEN an Agent attempts to close a lead, THE System SHALL grant access only if component visibility allows it
7. THE System SHALL enforce document-level permissions using Appwrite's permission system with user IDs and role labels

### Requirement 7: History and Audit Trail

**User Story:** As a manager, I want a permanent record of all closed leads with filtering capabilities, so that I can review past activities and outcomes.

#### Acceptance Criteria

1. THE System SHALL provide a History view displaying all Closed_Leads
2. WHEN displaying History, THE System SHALL show leads in read-only mode
3. THE System SHALL allow filtering History by Date, Agent, and Status
4. WHEN a lead is closed, THE System SHALL preserve all field data and metadata in the leads collection
5. THE System SHALL display closedAt timestamp for all leads in History
6. WHEN a Manager reopens a lead, THE System SHALL maintain the historical closedAt timestamp while setting isClosed to false

### Requirement 8: User Management Module

**User Story:** As a manager, I want to create and manage agent accounts, so that I can control team access and maintain the user hierarchy.

#### Acceptance Criteria

1. THE System SHALL provide a User Management interface accessible only to Managers
2. WHEN a Manager creates a user through User Management, THE System SHALL assign the Agent role
3. WHEN a Manager creates an Agent, THE System SHALL automatically set the Agent's managerId to the creating Manager's ID
4. THE System SHALL allow Managers to view all Agents linked to them
5. THE System SHALL prevent Agents from accessing User Management
6. WHEN a Manager creates an Agent, THE System SHALL require name, email, and initial password

### Requirement 9: Data Model and Storage

**User Story:** As a system architect, I want a flexible data model that supports dynamic form configurations, so that the system can adapt without schema migrations.

#### Acceptance Criteria

1. THE System SHALL store user data in a users collection with fields: id, name, email, role, managerId
2. THE System SHALL store lead data in a leads collection
JSON and map to current Form_Config structure

### Requirement 10: User Interface and Experience

**User Story:** As a user, I want a responsive, intuitive interface with consistent design, so that I can work efficiently across devices.

#### Acceptance Criteria

1. THE System SHALL implement a dark theme using Tailwind CSS v4
2. THE System SHALL use shadcn/ui components for consistent UI patterns
3. THE System SHALL implement responsive layouts with desktop-first design
4. WHEN rendering forms, THE System SHALL use react-hook-form for form state management
5. WHEN validating forms, THE System SHALL use zod schemas generated from Form_Config
6. THE System SHALL provide loading states for all asynchronous operations
7. THE System SHALL display error messages for validation failures and API errors
8. WHEN a user navigates, THE System SHALL show only permitted components in navigation

### Requirement 11: Form Validation and Data Integrity

**User Story:** As a manager, I want form validation enforced based on my configuration, so that data quality is maintained.

#### Acceptance Criteria

1. WHEN a Manager marks a field as required in Form_Builder, THE System SHALL enforce required validation on form submission
2. WHEN a field type is Email, THE System SHALL validate email format
3. WHEN a field type is Phone, THE System SHALL validate phone number format
4. WHEN a user submits invalid data, THE System SHALL display field-level error messages
5. THE System SHALL prevent form submission until all required fields contain valid data
6. WHEN a Manager changes field requirements, THE System SHALL apply new validation rules to all subsequent form submissions

### Requirement 12: Default User Creation

**User Story:** As a system administrator, I want users created through signup to be Managers by default, so that the system supports self-service manager onboarding.

#### Acceptance Criteria

1. WHEN a user signs up through the registration form, THE System SHALL create a user account with role set to Manager
2. WHEN a user is created via direct API call outside User Management, THE System SHALL set role to Manager
3. THE System SHALL set managerId to null for all Manager accounts
4. WHEN a Manager account is created, THE System SHALL grant full system access immediately
