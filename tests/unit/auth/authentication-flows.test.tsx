/**
 * Task 2.6: Unit Tests for Authentication Flows
 * 
 * This test suite covers the complete authentication flows including:
 * - Login with valid credentials
 * - Login with invalid credentials
 * - Signup creates manager account
 * - Session expiration handling
 * 
 * Requirements: 1.2, 1.4
 */

import { renderHook, waitFor, act } from '@testing-library/react';
import { AuthProvider, useAuth } from '@/lib/contexts/auth-context';
import { account, databases } from '@/lib/appwrite';
import { ReactNode } from 'react';

// Mock Appwrite SDK
jest.mock('@/lib/appwrite', () => ({
  account: {
    get: jest.fn(),
    create: jest.fn(),
    createEmailPasswordSession: jest.fn(),
    deleteSession: jest.fn(),
  },
  databases: {
    getDocument: jest.fn(),
    createDocument: jest.fn(),
  },
  DATABASE_ID: 'test-db',
  COLLECTIONS: {
    USERS: 'test-users-collection',
  },
}));

const mockAccount = account as jest.Mocked<typeof account>;
const mockDatabases = databases as jest.Mocked<typeof databases>;

describe('Task 2.6: Authentication Flows', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Default: no existing session
    mockAccount.get.mockRejectedValue(new Error('No session'));
  });

  const wrapper = ({ children }: { children: ReactNode }) => (
    <AuthProvider>{children}</AuthProvider>
  );

  describe('Login with valid credentials', () => {
    it('should successfully login with valid email and password', async () => {
      const { result } = renderHook(() => useAuth(), { wrapper });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      const mockUserDoc = {
        $id: 'user-123',
        name: 'Test Manager',
        email: 'manager@test.com',
        role: 'manager',
        managerId: null,
        $createdAt: '2024-01-01T00:00:00.000Z',
        $updatedAt: '2024-01-01T00:00:00.000Z',
      };

      mockAccount.createEmailPasswordSession.mockResolvedValue({} as any);
      mockAccount.get.mockResolvedValue({ $id: 'user-123' } as any);
      mockDatabases.getDocument.mockResolvedValue(mockUserDoc as any);

      await act(async () => {
        await result.current.login('manager@test.com', 'password123');
      });

      expect(mockAccount.createEmailPasswordSession).toHaveBeenCalledWith(
        'manager@test.com',
        'password123'
      );
      expect(result.current.user).toEqual(mockUserDoc);
      expect(result.current.isManager).toBe(true);
      expect(result.current.isAgent).toBe(false);
    });

    it('should fetch user document after successful login', async () => {
      const { result } = renderHook(() => useAuth(), { wrapper });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      const mockUserDoc = {
        $id: 'agent-456',
        name: 'Test Agent',
        email: 'agent@test.com',
        role: 'agent',
        managerId: 'manager-123',
        $createdAt: '2024-01-01T00:00:00.000Z',
        $updatedAt: '2024-01-01T00:00:00.000Z',
      };

      mockAccount.createEmailPasswordSession.mockResolvedValue({} as any);
      mockAccount.get.mockResolvedValue({ $id: 'agent-456' } as any);
      mockDatabases.getDocument.mockResolvedValue(mockUserDoc as any);

      await act(async () => {
        await result.current.login('agent@test.com', 'password123');
      });

      expect(mockDatabases.getDocument).toHaveBeenCalledWith(
        'test-db',
        'test-users-collection',
        'agent-456'
      );
      expect(result.current.user).toEqual(mockUserDoc);
      expect(result.current.isAgent).toBe(true);
      expect(result.current.isManager).toBe(false);
    });
  });

  describe('Login with invalid credentials', () => {
    it('should throw error when credentials are invalid', async () => {
      const { result } = renderHook(() => useAuth(), { wrapper });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      const authError = new Error('Invalid credentials');
      mockAccount.createEmailPasswordSession.mockRejectedValue(authError);

      await expect(async () => {
        await act(async () => {
          await result.current.login('wrong@test.com', 'wrongpassword');
        });
      }).rejects.toThrow('Invalid credentials');

      expect(result.current.user).toBeNull();
    });

    it('should throw error when user document not found', async () => {
      const { result } = renderHook(() => useAuth(), { wrapper });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      mockAccount.createEmailPasswordSession.mockResolvedValue({} as any);
      mockAccount.get.mockResolvedValue({ $id: 'user-999' } as any);
      mockDatabases.getDocument.mockRejectedValue(new Error('Document not found'));

      await expect(async () => {
        await act(async () => {
          await result.current.login('test@test.com', 'password123');
        });
      }).rejects.toThrow('User document not found');

      expect(result.current.user).toBeNull();
    });

    it('should not set user state when login fails', async () => {
      const { result } = renderHook(() => useAuth(), { wrapper });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      mockAccount.createEmailPasswordSession.mockRejectedValue(
        new Error('user_invalid_credentials')
      );

      try {
        await act(async () => {
          await result.current.login('invalid@test.com', 'wrongpass');
        });
      } catch (error) {
        // Expected to throw
      }

      expect(result.current.user).toBeNull();
      expect(result.current.isManager).toBe(false);
      expect(result.current.isAgent).toBe(false);
    });
  });

  describe('Signup creates manager account', () => {
    it('should create manager account with role="manager" and managerId=null', async () => {
      const { result } = renderHook(() => useAuth(), { wrapper });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      const mockAccountResponse = {
        $id: 'new-user-123',
        email: 'newmanager@test.com',
        name: 'New Manager',
      };

      const mockUserDoc = {
        $id: 'new-user-123',
        name: 'New Manager',
        email: 'newmanager@test.com',
        role: 'manager',
        managerId: null,
        $createdAt: '2024-01-01T00:00:00.000Z',
        $updatedAt: '2024-01-01T00:00:00.000Z',
      };

      mockAccount.create.mockResolvedValue(mockAccountResponse as any);
      mockDatabases.createDocument.mockResolvedValue(mockUserDoc as any);
      mockAccount.createEmailPasswordSession.mockResolvedValue({} as any);

      await act(async () => {
        await result.current.signup('New Manager', 'newmanager@test.com', 'password123');
      });

      // Verify account creation
      expect(mockAccount.create).toHaveBeenCalledWith(
        expect.any(String),
        'newmanager@test.com',
        'password123',
        'New Manager'
      );

      // Verify user document creation with manager role
      expect(mockDatabases.createDocument).toHaveBeenCalledWith(
        'test-db',
        'test-users-collection',
        'new-user-123',
        {
          name: 'New Manager',
          email: 'newmanager@test.com',
          role: 'manager',
          managerId: null,
        }
      );

      // Verify session creation
      expect(mockAccount.createEmailPasswordSession).toHaveBeenCalledWith(
        'newmanager@test.com',
        'password123'
      );

      // Verify user state
      expect(result.current.user).toEqual(mockUserDoc);
      expect(result.current.isManager).toBe(true);
      expect(result.current.isAgent).toBe(false);
    });

    it('should use account ID as document ID for user document', async () => {
      const { result } = renderHook(() => useAuth(), { wrapper });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      const accountId = 'account-789';
      mockAccount.create.mockResolvedValue({ $id: accountId } as any);
      mockDatabases.createDocument.mockResolvedValue({
        $id: accountId,
        name: 'Test User',
        email: 'test@test.com',
        role: 'manager',
        managerId: null,
      } as any);
      mockAccount.createEmailPasswordSession.mockResolvedValue({} as any);

      await act(async () => {
        await result.current.signup('Test User', 'test@test.com', 'password123');
      });

      expect(mockDatabases.createDocument).toHaveBeenCalledWith(
        'test-db',
        'test-users-collection',
        accountId, // Document ID should match account ID
        expect.any(Object)
      );
    });

    it('should handle existing session during signup', async () => {
      const { result } = renderHook(() => useAuth(), { wrapper });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      mockAccount.create.mockResolvedValue({ $id: 'user-999' } as any);
      mockDatabases.createDocument.mockResolvedValue({
        $id: 'user-999',
        name: 'Test',
        email: 'test@test.com',
        role: 'manager',
        managerId: null,
      } as any);

      // First session creation fails with existing session error
      mockAccount.createEmailPasswordSession
        .mockRejectedValueOnce({
          code: 401,
          type: 'user_session_already_exists',
        })
        .mockResolvedValueOnce({} as any);

      mockAccount.deleteSession.mockResolvedValue({} as any);

      await act(async () => {
        await result.current.signup('Test', 'test@test.com', 'password123');
      });

      // Should delete existing session and create new one
      expect(mockAccount.deleteSession).toHaveBeenCalledWith('current');
      expect(mockAccount.createEmailPasswordSession).toHaveBeenCalledTimes(2);
    });
  });

  describe('Session expiration handling', () => {
    it('should detect expired session on mount', async () => {
      const sessionExpiredError = {
        code: 401,
        type: 'general_unauthorized_scope',
        message: 'User (role: guests) missing scope (account)',
      };

      mockAccount.get.mockRejectedValue(sessionExpiredError);

      const { result } = renderHook(() => useAuth(), { wrapper });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.user).toBeNull();
      expect(mockAccount.get).toHaveBeenCalled();
    });

    it('should handle session expiration during active use', async () => {
      // Start with valid session
      const mockUserDoc = {
        $id: 'user-123',
        name: 'Test User',
        email: 'test@test.com',
        role: 'manager',
        managerId: null,
        $createdAt: '2024-01-01T00:00:00.000Z',
        $updatedAt: '2024-01-01T00:00:00.000Z',
      };

      mockAccount.get.mockResolvedValue({ $id: 'user-123' } as any);
      mockDatabases.getDocument.mockResolvedValue(mockUserDoc as any);

      const { result } = renderHook(() => useAuth(), { wrapper });

      await waitFor(() => {
        expect(result.current.user).toEqual(mockUserDoc);
      });

      // Simulate session expiration
      const expiredError = {
        code: 401,
        type: 'general_unauthorized_scope',
      };

      mockAccount.get.mockRejectedValue(expiredError);
      mockAccount.deleteSession.mockResolvedValue({} as any);

      // Attempt to logout (which would happen when session expires)
      await act(async () => {
        await result.current.logout();
      });

      expect(result.current.user).toBeNull();
    });

    it('should clear user state when session expires', async () => {
      const mockUserDoc = {
        $id: 'user-456',
        name: 'Test User',
        email: 'test@test.com',
        role: 'agent',
        managerId: 'manager-123',
        $createdAt: '2024-01-01T00:00:00.000Z',
        $updatedAt: '2024-01-01T00:00:00.000Z',
      };

      mockAccount.get.mockResolvedValue({ $id: 'user-456' } as any);
      mockDatabases.getDocument.mockResolvedValue(mockUserDoc as any);

      const { result } = renderHook(() => useAuth(), { wrapper });

      await waitFor(() => {
        expect(result.current.user).toEqual(mockUserDoc);
      });

      // Session expires
      mockAccount.deleteSession.mockResolvedValue({} as any);

      await act(async () => {
        await result.current.logout();
      });

      expect(result.current.user).toBeNull();
      expect(result.current.isManager).toBe(false);
      expect(result.current.isAgent).toBe(false);
    });

    it('should handle 401 errors gracefully', async () => {
      const unauthorizedError = {
        code: 401,
        message: 'Unauthorized',
      };

      mockAccount.get.mockRejectedValue(unauthorizedError);

      const { result } = renderHook(() => useAuth(), { wrapper });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      // Should not crash, should set user to null
      expect(result.current.user).toBeNull();
    });

    it('should allow re-login after session expiration', async () => {
      // Start with expired session
      mockAccount.get.mockRejectedValue({ code: 401 });

      const { result } = renderHook(() => useAuth(), { wrapper });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.user).toBeNull();

      // Now login again
      const mockUserDoc = {
        $id: 'user-789',
        name: 'Returning User',
        email: 'returning@test.com',
        role: 'manager',
        managerId: null,
        $createdAt: '2024-01-01T00:00:00.000Z',
        $updatedAt: '2024-01-01T00:00:00.000Z',
      };

      mockAccount.createEmailPasswordSession.mockResolvedValue({} as any);
      mockAccount.get.mockResolvedValue({ $id: 'user-789' } as any);
      mockDatabases.getDocument.mockResolvedValue(mockUserDoc as any);

      await act(async () => {
        await result.current.login('returning@test.com', 'password123');
      });

      expect(result.current.user).toEqual(mockUserDoc);
      expect(result.current.isManager).toBe(true);
    });
  });

  describe('Role-based helper properties', () => {
    it('should set isManager=true for manager users', async () => {
      const mockUserDoc = {
        $id: 'manager-1',
        name: 'Manager User',
        email: 'manager@test.com',
        role: 'manager' as const,
        managerId: null,
        $createdAt: '2024-01-01T00:00:00.000Z',
        $updatedAt: '2024-01-01T00:00:00.000Z',
      };

      mockAccount.get.mockResolvedValue({ $id: 'manager-1' } as any);
      mockDatabases.getDocument.mockResolvedValue(mockUserDoc as any);

      const { result } = renderHook(() => useAuth(), { wrapper });

      await waitFor(() => {
        expect(result.current.user).toEqual(mockUserDoc);
      });

      expect(result.current.isManager).toBe(true);
      expect(result.current.isAgent).toBe(false);
    });

    it('should set isAgent=true for agent users', async () => {
      const mockUserDoc = {
        $id: 'agent-1',
        name: 'Agent User',
        email: 'agent@test.com',
        role: 'agent' as const,
        managerId: 'manager-123',
        $createdAt: '2024-01-01T00:00:00.000Z',
        $updatedAt: '2024-01-01T00:00:00.000Z',
      };

      mockAccount.get.mockResolvedValue({ $id: 'agent-1' } as any);
      mockDatabases.getDocument.mockResolvedValue(mockUserDoc as any);

      const { result } = renderHook(() => useAuth(), { wrapper });

      await waitFor(() => {
        expect(result.current.user).toEqual(mockUserDoc);
      });

      expect(result.current.isAgent).toBe(true);
      expect(result.current.isManager).toBe(false);
    });
  });
});
