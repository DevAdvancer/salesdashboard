# Task 2.1: Authentication Context and Hooks

## Overview

This task implements the authentication context and hooks for the SalesHub CRM system, providing user state management and role-based authentication functionality.

## Implementation Details

### Files Created

1. **`lib/contexts/auth-context.tsx`**
   - Main authentication context provider
   - Implements user state management
   - Provides authentication methods (login, logout, signup)
   - Includes role-based helper properties (isManager, isAgent)

2. **`tests/unit/auth/auth-context.test.tsx`**
   - Comprehensive unit tests for authentication context
   - Tests all authentication flows (signup, login, logout)
   - Validates role-based helpers
   - Tests session restoration

3. **`app/auth-test/page.tsx`**
   - Demo page to visualize authentication context
   - Shows current user state and role information

### Files Modified

1. **`app/layout.tsx`**
   - Wrapped application with AuthProvider
   - Updated metadata for SalesHub CRM

2. **`package.json`**
   - Added test scripts (test, test:watch, test:coverage)

### Testing Setup

Created Jest configuration for the project:
- **`jest.config.js`** - Jest configuration with Next.js support
- **`jest.setup.js`** - Jest setup file with testing-library/jest-dom

Installed testing dependencies:
- jest
- jest-environment-jsdom
- @testing-library/react
- @testing-library/jest-dom
- @testing-library/user-event
- @types/jest

## Features Implemented

### AuthProvider Component

The `AuthProvider` component wraps the application and provides authentication state to all child components.

**Key Features:**
- User state management
- Session persistence and restoration
- Automatic session checking on mount
- Error handling for authentication operations

### useAuth Hook

The `useAuth` hook provides access to authentication state and methods throughout the application.

**Returns:**
```typescript
{
  user: User | null;           // Current user object or null
  isManager: boolean;          // True if user role is 'manager'
  isAgent: boolean;            // True if user role is 'agent'
  loading: boolean;            // True while checking session
  login: (email, password) => Promise<void>;
  logout: () => Promise<void>;
  signup: (name, email, password) => Promise<void>;
}
```

### Authentication Methods

#### signup(name, email, password)
- Creates a new Appwrite account
- Creates user document with role='manager' and managerId=null
- Automatically logs in the new user
- **Validates Requirements:** 1.2, 12.1, 12.2, 12.3

#### login(email, password)
- Creates email/password session with Appwrite
- Fetches user document from database
- Updates context with user data
- **Validates Requirements:** 1.1, 1.4

#### logout()
- Deletes current session
- Clears user state from context

### Role-Based Helpers

#### isManager
- Returns `true` if current user has role='manager'
- Returns `false` otherwise

#### isAgent
- Returns `true` if current user has role='agent'
- Returns `false` otherwise

## Requirements Validated

This implementation validates the following requirements:

- **Requirement 1.1**: System supports exactly two user roles (Manager and Agent)
- **Requirement 1.4**: System enforces role-based permissions at application level

## Test Results

All 7 unit tests pass successfully:

```
✓ should throw error when used outside AuthProvider
✓ should provide auth context when used within AuthProvider
✓ should create manager account by default
✓ should login with valid credentials and set agent role
✓ should logout and clear user state
✓ should correctly identify manager role
✓ should correctly identify agent role
```

## Usage Example

```typescript
'use client';

import { useAuth } from '@/lib/contexts/auth-context';

export default function MyComponent() {
  const { user, isManager, isAgent, login, logout, signup } = useAuth();

  if (!user) {
    return <LoginForm onLogin={login} />;
  }

  return (
    <div>
      <h1>Welcome, {user.name}!</h1>
      <p>Role: {user.role}</p>
      {isManager && <ManagerDashboard />}
      {isAgent && <AgentDashboard />}
      <button onClick={logout}>Logout</button>
    </div>
  );
}
```

## Testing the Implementation

### Run Unit Tests
```bash
npm test
```

### Run Tests in Watch Mode
```bash
npm test:watch
```

### Run Tests with Coverage
```bash
npm test:coverage
```

### View Demo Page
Navigate to `/auth-test` to see the authentication context in action.

## Next Steps

The following tasks depend on this authentication context:

- **Task 2.2**: Write property test for user role constraint
- **Task 2.3**: Implement signup flow with manager role assignment
- **Task 2.4**: Write property test for default user creation
- **Task 2.5**: Implement login flow with session management
- **Task 2.6**: Write unit tests for authentication flows

## Notes

- The authentication context uses Appwrite's built-in session management
- Sessions are automatically restored on page refresh
- All authentication errors are logged to console and re-thrown for handling by UI components
- The context follows React best practices with proper memoization using useCallback
- Type safety is enforced throughout with TypeScript interfaces
