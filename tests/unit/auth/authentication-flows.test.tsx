/**
 * Task 2.6: Unit Tests for Authentication Flows
 *
 * This test suite covers the complete authentication flows including:
 * - Login with valid credentials
 * - Login with invalid credentials
 * - Signup is disabled (admins create accounts instead)
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
    createJWT: jest.fn(),
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

// The provider normalizes every user document it reads from Appwrite: a missing
// `department` defaults to 'sales' and a missing `isActive` defaults to true.
const normalized = <T extends Record<string, unknown>>(doc: T) => ({
  department: 'sales',
  isActive: true,
  ...doc,
});

describe('Task 2.6: Authentication Flows', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Default: no existing session
    mockAccount.get.mockRejectedValue(new Error('No session'));
    // login()/checkSession() mint a JWT and POST it to /api/auth/appwrite-session.
    mockAccount.createJWT.mockResolvedValue({ jwt: 'test-jwt' } as any);
    global.fetch = jest.fn().mockResolvedValue({ ok: true }) as unknown as typeof fetch;
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
        name: 'Test TeamLead',
        email: 'teamLead@test.com',
        role: 'team_lead',
        teamLeadId: null,
        branchIds: [],
        branchId: null,
        $createdAt: '2024-01-01T00:00:00.000Z',
        $updatedAt: '2024-01-01T00:00:00.000Z',
      };

      mockAccount.createEmailPasswordSession.mockResolvedValue({} as any);
      mockAccount.get.mockResolvedValue({ $id: 'user-123' } as any);
      mockDatabases.getDocument.mockResolvedValue(mockUserDoc as any);

      await act(async () => {
        await result.current.login('teamLead@test.com', 'password123');
      });

      expect(mockAccount.createEmailPasswordSession).toHaveBeenCalledWith(
        'teamLead@test.com',
        'password123'
      );
      expect(result.current.user).toEqual(normalized(mockUserDoc));
      expect(result.current.isTeamLead).toBe(true);
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
        teamLeadId: 'teamLead-123',
        branchIds: [],
        branchId: null,
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
      expect(result.current.user).toEqual(normalized(mockUserDoc));
      expect(result.current.isAgent).toBe(true);
      expect(result.current.isTeamLead).toBe(false);
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
      expect(result.current.isTeamLead).toBe(false);
      expect(result.current.isAgent).toBe(false);
    });
  });

  // Self-service signup was deliberately removed from the product: /signup
  // redirects to /login, the login page renders no signup link, and
  // AuthProvider.signup rejects. Admins create accounts instead.
  describe('Signup is disabled', () => {
    const SIGNUP_DISABLED_MESSAGE =
      'Signup is disabled. Ask an admin to create the user account.';

    it('should reject with a message pointing the caller at an admin', async () => {
      const { result } = renderHook(() => useAuth(), { wrapper });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      await expect(
        result.current.signup('New TeamLead', 'newmanager@test.com', 'password123')
      ).rejects.toThrow(SIGNUP_DISABLED_MESSAGE);
    });

    it('should not create an account or a user document', async () => {
      const { result } = renderHook(() => useAuth(), { wrapper });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      await expect(
        result.current.signup('Test User', 'test@test.com', 'password123')
      ).rejects.toThrow(SIGNUP_DISABLED_MESSAGE);

      expect(mockAccount.create).not.toHaveBeenCalled();
      expect(mockDatabases.createDocument).not.toHaveBeenCalled();
      expect(result.current.user).toBeNull();
    });

    it('should not touch the existing session', async () => {
      const { result } = renderHook(() => useAuth(), { wrapper });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      await expect(
        result.current.signup('Test', 'test@test.com', 'password123')
      ).rejects.toThrow(SIGNUP_DISABLED_MESSAGE);

      expect(mockAccount.createEmailPasswordSession).not.toHaveBeenCalled();
      expect(mockAccount.deleteSession).not.toHaveBeenCalled();
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
        role: 'team_lead',
        teamLeadId: null,
        branchIds: [],
        branchId: null,
        $createdAt: '2024-01-01T00:00:00.000Z',
        $updatedAt: '2024-01-01T00:00:00.000Z',
      };

      mockAccount.get.mockResolvedValue({ $id: 'user-123' } as any);
      mockDatabases.getDocument.mockResolvedValue(mockUserDoc as any);

      const { result } = renderHook(() => useAuth(), { wrapper });

      await waitFor(() => {
        expect(result.current.user).toEqual(normalized(mockUserDoc));
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
        teamLeadId: 'teamLead-123',
        branchIds: [],
        branchId: null,
        $createdAt: '2024-01-01T00:00:00.000Z',
        $updatedAt: '2024-01-01T00:00:00.000Z',
      };

      mockAccount.get.mockResolvedValue({ $id: 'user-456' } as any);
      mockDatabases.getDocument.mockResolvedValue(mockUserDoc as any);

      const { result } = renderHook(() => useAuth(), { wrapper });

      await waitFor(() => {
        expect(result.current.user).toEqual(normalized(mockUserDoc));
      });

      // Session expires
      mockAccount.deleteSession.mockResolvedValue({} as any);

      await act(async () => {
        await result.current.logout();
      });

      expect(result.current.user).toBeNull();
      expect(result.current.isTeamLead).toBe(false);
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
        role: 'team_lead',
        teamLeadId: null,
        branchIds: [],
        branchId: null,
        $createdAt: '2024-01-01T00:00:00.000Z',
        $updatedAt: '2024-01-01T00:00:00.000Z',
      };

      mockAccount.createEmailPasswordSession.mockResolvedValue({} as any);
      mockAccount.get.mockResolvedValue({ $id: 'user-789' } as any);
      mockDatabases.getDocument.mockResolvedValue(mockUserDoc as any);

      await act(async () => {
        await result.current.login('returning@test.com', 'password123');
      });

      expect(result.current.user).toEqual(normalized(mockUserDoc));
      expect(result.current.isTeamLead).toBe(true);
    });
  });

  describe('Role-based helper properties', () => {
    it('should set isManager=true for teamLead users', async () => {
      const mockUserDoc = {
        $id: 'teamLead-1',
        name: 'TeamLead User',
        email: 'teamLead@test.com',
        role: 'team_lead' as const,
        teamLeadId: null,
        branchIds: [],
        branchId: null,
        $createdAt: '2024-01-01T00:00:00.000Z',
        $updatedAt: '2024-01-01T00:00:00.000Z',
      };

      mockAccount.get.mockResolvedValue({ $id: 'teamLead-1' } as any);
      mockDatabases.getDocument.mockResolvedValue(mockUserDoc as any);

      const { result } = renderHook(() => useAuth(), { wrapper });

      await waitFor(() => {
        expect(result.current.user).toEqual(normalized(mockUserDoc));
      });

      expect(result.current.isTeamLead).toBe(true);
      expect(result.current.isAgent).toBe(false);
    });

    it('should set isAgent=true for agent users', async () => {
      const mockUserDoc = {
        $id: 'agent-1',
        name: 'Agent User',
        email: 'agent@test.com',
        role: 'agent' as const,
        teamLeadId: 'teamLead-123',
        branchIds: [],
        branchId: null,
        $createdAt: '2024-01-01T00:00:00.000Z',
        $updatedAt: '2024-01-01T00:00:00.000Z',
      };

      mockAccount.get.mockResolvedValue({ $id: 'agent-1' } as any);
      mockDatabases.getDocument.mockResolvedValue(mockUserDoc as any);

      const { result } = renderHook(() => useAuth(), { wrapper });

      await waitFor(() => {
        expect(result.current.user).toEqual(normalized(mockUserDoc));
      });

      expect(result.current.isAgent).toBe(true);
      expect(result.current.isTeamLead).toBe(false);
    });
  });
});
