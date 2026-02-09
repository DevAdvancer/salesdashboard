# Implementation Plan: SalesHub CRM

## Overview

This implementation plan breaks down the SalesHub CRM system into incremental, testable steps. The approach follows a bottom-up strategy: starting with core infrastructure (Appwrite setup, authentication), then building data layers (collections, services), followed by UI components, and finally integration. Each major component includes property-based tests to validate correctness properties from the design document.

## Tasks

- [x] 1. Project setup and Appwrite configuration
  - Initialize Next.js 16 project with TypeScript
  - Install dependencies: shadcn/ui, Tailwind CSS v4, react-hook-form, zod, fast-check
  - Configure Appwrite SDK with environment variables
  - Set up Appwrite database (crm-database-1) and collections
  - Create collection schemas: users, leads, form_config, access_config
  - Configure collection indexes and permissions
  - Seed default access_config rules
  - Seed default form_config with DEFAULT_FIELDS
  - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.7, 9.8_

- [ ] 2. Authentication system
  - [x] 2.1 Create authentication context and hooks
    - Implement AuthProvider with user state management
    - Create useAuth() hook with login, logout, signup methods
    - Add role-based helper properties (isManager, isAgent)
    - _Requirements: 1.1, 1.4_

  - [x] 2.2 Write property test for user role constraint
    - **Property 1: User role must be 'manager' or 'agent'**
    - **Validates: Requirements 1.1**

  - [x] 2.3 Implement signup flow with manager role assignment
    - Create signup page with form validation
    - Implement Appwrite account creation
    - Create user document with role='manager' and managerId=null
    - _Requirements: 1.2, 12.1, 12.2, 12.3, 12.4_

  - [x] 2.4 Write property test for default user creation
    - **Property 3: Default user creation assigns manager role**
    - **Validates: Requirements 1.2, 12.1, 12.2, 12.3**

  - [x] 2.5 Implement login flow with session management
    - Create login page with email/password form
    - Implement Appwrite session creation
    - Fetch and store user document in context
    - Add session persistence and restoration
    - _Requirements: 1.4, 10.5_

  - [~] 2.6 Write unit tests for authentication flows
    - Test login with valid credentials
    - Test login with invalid credentials
    - Test signup creates manager account
    - Test session expiration handling
    - _Requirements: 1.2, 1.4_

- [x] 3. Checkpoint - Verify authentication works
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 4. Access control system
  - [x] 4.1 Create access control service and context
    - Implement AccessControlProvider with rule caching
    - Create useAccess() hook for component visibility checks
    - Implement canAccess(componentKey, role) function
    - Add default rule logic (manager=true, agent=false)
    - _Requirements: 2.1, 2.3, 2.6_

  - [x] 4.2 Write property test for agent component visibility
    - **Property 5: Agent component visibility enforcement**
    - **Validates: Requirements 2.4, 10.8**

  - [x] 4.3 Write property test for manager full access
    - **Property 6: Manager full component access**
    - **Validates: Requirements 2.5**

  - [x] 4.4 Create ProtectedRoute component
    - Implement route wrapper that checks access permissions
    - Add redirect logic for unauthorized access
    - Display toast notification for permission errors
    - _Requirements: 2.6, 6.1_

  - [x] 4.5 Create access configuration page (manager only)
    - Build visibility matrix UI (components × roles)
    - Implement checkbox toggles for access rules
    - Add immediate persistence to access_config collection
    - _Requirements: 2.1, 2.2, 2.3_

  - [x] 4.6 Write property test for access config persistence
    - **Property 4: Access config persistence round-trip**
    - **Validates: Requirements 2.2**

  - [~] 4.7 Write unit tests for access control
    - Test default rules apply correctly
    - Test custom rules override defaults
    - Test manager always has access
    - Test agent respects rules
    - _Requirements: 2.4, 2.5, 2.6_

- [ ] 5. User management module
  - [x] 5.1 Create user management service
    - Implement createAgent(name, email, password) function
    - Add Appwrite account creation logic
    - Create user document with role='agent' and managerId
    - Set up document-level permissions for agent
    - _Requirements: 1.3, 1.5, 8.2, 8.3, 8.6_

  - [x] 5.2 Write property test for agent creation
    - **Property 2: Agent creation sets role and manager link**
    - **Validates: Requirements 1.3, 1.5, 8.2, 8.3**

  - [x] 5.3 Create user management page UI
    - Build agent list table with name, email, created date
    - Add create agent dialog with form
    - Implement form validation (name, email, password)
    - Add error handling for duplicate emails
    - Filter agents by current manager's ID
    - _Requirements: 8.1, 8.4, 8.5, 8.6_

  - [x] 5.4 Write unit tests for user management
    - Test agent creation flow
    - Test duplicate email handling
    - Test manager can only see their agents
    - Test agent cannot access user management
    - _Requirements: 8.2, 8.3, 8.5_

- [ ] 6. Form builder system
  - [~] 6.1 Create form configuration service
    - Implement getFormConfig() to fetch current config
    - Implement updateFormConfig(fields) with version increment
    - Add singleton pattern using 'current' document ID
    - Implement field operations: add, remove, reorder
    - _Requirements: 3.1, 3.2, 3.7, 9.3_

  - [~] 6.2 Write property test for form config operations
    - **Property 7: Form config field operations**
    - **Validates: Requirements 3.2**

  - [ ] 6.3 Write property test for form confi
ement form config publish functionality
    - Add publish button with confirmation
    - Persist changes to form_config collection
    - Increment version number
    - Show success notification
    - _Requirements: 3.7_

  - [~] 6.6 Write unit tests for form builder
    - Test adding field updates config
    - Test removing field updates config
    - Test reordering fields updates order
    - Test toggling visibility
    - Test toggling required
    - Test editing dropdown options
    - Test version increments on publish
    - _Requirements: 3.2, 3.5, 3.6, 3.7_

- [~] 7. Checkpoint - Verify form builder works
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 8. Dynamic form rendering system
  - [~] 8.1 Create form schema generator
    - Implement generateZodSchema(formConfig) function
    - Map field types to zod validators
    - Apply required/optional based on field config
    - Add email and phone format validation
    - Add dropdown enum validation
    - _Requirements: 3.9, 10.4, 10.5, 11.1, 11.2, 11.3_

  - [~] 8.2 Write property test for required field validation
    - **Property 9: Required field validation enforcement**
    - **Validates: Requirements 3.9, 11.1**

  - [~] 8.3 Write property test for email validation
    - **Property 19: Email format validation**
    - **Validates: Requirements 11.2**

  - [~] 8.4 Write property test for phone validation
    - **Property 20: Phone format validation**
    - **Validates: Requirements 11.3**

  - [~] 8.5 Write property test for dropdown constraint
    - **Property 21: Dropdown options constraint**
    - **Validates: Requirements 3.6**

  - [~] 8.6 Create dynamic form component
    - Implement DynamicLeadForm component with react-hook-form
    - Filter fields by visible=true for agents
    - Sort fields by order property
    - Render fields based on type (text, email, phone, dropdown, textarea, checklist)
    - Apply generated zod schema for validation
    - Display field-level error messages
    - _Requirements: 3.8, 3.9, 10.4, 10.5, 11.4, 11.5_

  - [~] 8.6 Write property test for field visibility filtering
    - **Property 8: Field visibility filtering for agents**
    - **Validates: Requirements 3.8**

  - [~] 8.7 Write unit tests for form rendering
    - Test fields render in correct order
    - Test only visible fields shown to agents
    - Test all fields shown to managers
    - Test validation errors display correctly
    - Test form submission disabled when invalid
    - _Requirements: 3.8, 3.9, 11.4, 11.5_

- [ ] 9. Lead management service
  - [~] 9.1 Create lead service with CRUD operations
    - Implement createLead(data, ownerId, assignedToId) function
    - Implement updateLead(leadId, data) function
    - Implement deleteLead(leadId) function
    - Implement getLead(leadId) function
    - Implement listLeads(filters) with role-based filtering
    - Add JSON serialization for lead data field
    - Set document-level permissions on create/update
    - _Requirements: 4.1, 4.2, 5.1, 5.6, 6.2, 9.5, 9.6_

  - [~] 9.2 Write property test for lead data serialization
    - **Property 11: Lead data JSON serialization round-trip**
    - **Validates: Requirements 3.10, 9.5, 9.6**

  - [~] 9.3 Implement lead closure functionality
    - Create closeLead(leadId, closedStatus) function
    - Set isClosed=true and closedAt timestamp
    - Update status field
    - Update permissions to read-only for agent
    - _Requirements: 4.3, 4.5, 4.6_

  - [~] 9.4 Write property test for lead closure
    - **Property 12: Lead closure state transition**
    - **Validates: Requirements 4.3, 4.4, 4.5**

  - [~] 9.5 Write property test for closed lead read-only
    - **Property 17: Closed lead read-only enforcement**
    - **Validates: Requirements 4.6, 6.3**

  - [~] 9.6 Implement lead reopen functionality (manager only)
    - Create reopenLead(leadId) function
    - Set isClosed=false
    - Preserve closedAt timestamp
    - Restore update permissions for assigned agent
    - _Requirements: 4.7, 7.6_

  - [~] 9.7 Write property test for lead reopen
    - **Property 13: Lead reopen preserves history**
    - **Validates: Requirements 4.7, 7.6**

  - [~] 9.8 Implement lead assignment functionality
    - Create assignLead(leadId, agentId) function
    - Update assignedToId field
    - Update document permissions to include new agent
    - Remove old agent from permissions if changed
    - _Requirements: 5.2, 5.3, 5.6_

  - [~] 9.9 Write property test for lead assignment permissions
    - **Property 16: Lead assignment permission update**
    - **Validates: Requirements 5.2, 6.2, 6.3**

  - [~] 9.10 Write unit tests for lead service
    - Test lead creation with valid data
    - Test lead creation with missing required fields fails
    - Test lead update
    - Test lead deletion
    - Test lead closure sets correct fields
    - Test lead reopen restores state
    - Test assignment updates permissions
    - _Requirements: 4.2, 4.3, 4.7, 5.2_

- [ ] 10. Lead list and filtering UI
  - [~] 10.1 Create leads page with active leads list
    - Build leads table with columns: name, email, status, assigned to, created date
    - Implement role-based filtering (agent sees only assigned, manager sees all owned)
    - Add filter controls: status, assigned agent, date range, search
    - Add create lead button
    - Add pagination for large lists
    - _Requirements: 5.4, 5.5, 10.1, 10.2, 10.3_

  - [~] 10.2 Write property test for agent lead visibility
    - **Property 14: Agent lead visibility restriction**
    - **Validates: Requirements 5.4, 6.2**

  - [~] 10.3 Write property test for manager lead visibility
    - **Property 15: Manager lead visibility**
    - **Validates: Requirements 5.5, 6.4**

  - [~] 10.4 Create lead detail view
    - Build lead detail page with all field data
    - Add edit mode for active leads
    - Add close lead button with confirmation dialog
    - Add assignment selector for managers
    - Display read-only view for closed leads
    - _Requirements: 4.6, 5.2, 10.3_

  - [~] 10.5 Create lead form dialog
    - Build create/edit lead dialog with dynamic form
    - Integrate DynamicLeadForm component
    - Add owner and assigned agent selectors
    - Handle form submission and validation
    - Show success/error notifications
    - _Requirements: 4.1, 4.2, 5.1, 10.5, 11.4, 11.5_

  - [~] 10.6 Write unit tests for lead UI
    - Test agent sees only assigned leads
    - Test manager sees all owned leads
    - Test filters work correctly
    - Test create lead dialog
    - Test edit lead updates data
    - Test close lead moves to history
    - _Requirements: 5.4, 5.5, 4.3, 4.5_

- [~] 11. Checkpoint - Verify lead management works
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 12. History and audit system
  - [~] 12.1 Create history page with closed leads list
    - Build history table with columns: name, email, status, closed date, assigned to
    - Query leads where isClosed=true
    - Apply role-based filtering (agent sees assigned, manager sees owned)
    - Add filter controls: date range, agent, status
    - Sort by closedAt descending
    - _Requirements: 7.1, 7.2, 7.3, 7.5_

  - [~] 12.2 Write property test for history filtering
    - **Property 18: History filtering correctness**
    - **Validates: Requirements 7.3, 7.4**

  - [~] 12.3 Create history detail view
    - Build read-only lead detail view
    - Display all field data including hidden fields
    - Show closure metadata (closedAt, status)
    - Add reopen button for managers only
    - Disable all form inputs
    - _Requirements: 7.2, 7.4, 7.6_

  - [~] 12.4 Write unit tests for history
    - Test only closed leads appear in history
    - Test filters work correctly
    - Test read-only enforcement
    - Test manager can reopen leads
    - Test agent cannot reopen leads
    - _Requirements: 7.1, 7.2, 7.6_

- [ ] 13. Navigation and layout
  - [~] 13.1 Create main layout with navigation
    - Build sidebar navigation with component links
    - Implement useAccess() to filter visible components
    - Add user menu with logout
    - Display current user name and role
    - Apply dark theme styling
    - _Requirements: 2.4, 2.6, 10.1, 10.2, 10.8_

  - [~] 13.2 Create dashboard page
    - Build dashboard with key metrics cards
    - Show active leads count
    - Show closed leads count
    - Show agents count (managers only)
    - Add quick action buttons
    - _Requirements: 2.3, 10.1, 10.2_

  - [~] 13.3 Write unit tests for navigation
    - Test agent sees only permitted components
    - Test manager sees all components
    - Test navigation links work correctly
    - Test logout clears session
    - _Requirements: 2.4, 2.6, 10.8_

- [ ] 14. Error handling and loading states
  - [~] 14.1 Implement error boundaries
    - Create ErrorBoundary component for route wrapping
    - Add fallback UI with reload button
    - Implement error logging
    - _Requirements: 10.6_

  - [~] 14.2 Add loading states to all async operations
    - Add loading spinners to forms
    - Add skeleton loaders to lists
    - Add loading states to buttons
    - Implement optimistic UI updates where appropriate
    - _Requirements: 10.6_

  - [~] 14.3 Implement error notifications
    - Create toast notification system
    - Add error messages for validation failures
    - Add error messages for API errors
    - Add error messages for permission errors
    - Add network error handling with retry
    - _Requirements: 10.7, 11.4_

  - [~] 14.4 Write unit tests for error handling
    - Test error boundary catches crashes
    - Test validation errors display correctly
    - Test API errors show notifications
    - Test permission errors redirect
    - Test network errors show retry option
    - _Requirements: 10.6, 10.7_

- [ ] 15. Responsive design and styling
  - [~] 15.1 Apply Tailwind CSS v4 dark theme
    - Configure Tailwind with dark theme colors
    - Apply consistent spacing and typography
    - Style all forms with dark theme
    - Style all tables with dark theme
    - Add hover and focus states
    - _Requirements: 10.1, 10.2_

  - [~] 15.2 Implement responsive layouts
    - Make navigation responsive (mobile menu)
    - Make tables responsive (horizontal scroll or cards)
    - Make forms responsive (stack on mobile)
    - Make dialogs responsive (full screen on mobile)
    - Test on desktop, tablet, and mobile viewports
    - _Requirements: 10.3_

- [ ] 16. Integration and final wiring
  - [~] 16.1 Wire all components together
    - Connect authentication to all protected routes
    - Connect access control to navigation
    - Connect form builder to lead forms
    - Connect lead service to all lead UI components
    - Connect user management to agent creation
    - Verify all data flows work end-to-end
    - _Requirements: All_

  - [~] 16.2 Write integration tests for complete flows
    - Test complete lead lifecycle (create → assign → edit → close → reopen)
    - Test user management flow (signup → create agent → agent login → agent sees assigned leads)
    - Test form builder flow (create field → publish → agent sees field → create lead with field)
    - Test access control flow (manager restricts component → agent cannot access)
    - _Requirements: All_

- [~] 17. Final checkpoint - Ensure all tests pass
  - Run all unit tests
  - Run all property tests (100 iterations each)
  - Run all integration tests
  - Verify test coverage is above 80%
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Property tests validate universal correctness properties with 100+ iterations
- Unit tests validate specific examples and edge cases
- Integration tests validate complete user flows
- Checkpoints ensure incremental validation at major milestones
- All property tests must include the tag format: `Feature: saleshub-crm, Property {number}: {property_text}`
