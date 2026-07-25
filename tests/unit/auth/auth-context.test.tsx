import { renderHook, act, waitFor } from '@testing-library/react';
import { AuthProvider, useAuth } from '@/lib/contexts/auth-context';
import { account, databases } from '@/lib/appwrite';
import { ReactNode } from 'react';

// Mock Appwrite modules
jest.mock('@/lib/appwrite', () => ({
  account: {
    create: jest.fn(),
    createEmailPasswordSession: jest.fn(),
    createJWT: jest.fn(),
    get: jest.fn(),
    deleteSession: jest.fn(),
  },
  databases: {
    createDocument: jest.fn(),
    getDocument: jest.fn(),
  },
  DATABASE_ID: 'test-db',
  COLLECTIONS: {
    USERS: 'test-users-collection',
    LEADS: 'test-leads-collection',
    FORM_CONFIG: 'test-form-config-collection',
    ACCESS_CONFIG: 'test-access-config-collection',
  },
}));

const mockAccount = account as jest.Mocked<typeof account>;
const mockDatabases = databases as jest.Mocked<typeof databases>;

describe('AuthContext', () => {
  const mockFetch = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    mockFetch.mockResolvedValue({ ok: true });
    global.fetch = mockFetch as unknown as typeof fetch;
    mockAccount.createJWT.mockResolvedValue({ jwt: 'jwt-token' } as any);
  });

  const wrapper = ({ children }: { children: ReactNode }) => (
    <AuthProvider>{children}</AuthProvider>
  );

  describe('useAuth hook', () => {
    it('should throw error when used outside AuthProvider', () => {
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

      expect(() => {
        renderHook(() => useAuth());
      }).toThrow('useAuth must be used within an AuthProvider');

      consoleSpy.mockRestore();
    });

    it('should provide auth context when used within AuthProvider', async () => {
      mockAccount.get.mockRejectedValue(new Error('No session'));

      const { result } = renderHook(() => useAuth(), { wrapper });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.user).toBeNull();
      expect(result.current.isTeamLead).toBe(false);
      expect(result.current.isAgent).toBe(false);
      expect(typeof result.current.login).toBe('function');
      expect(typeof result.current.logout).toBe('function');
      expect(typeof result.current.signup).toBe('function');
    });
  });

  // Self-service signup was deliberately removed from the product: /signup
  // redirects to /login, the login page renders no signup link, and
  // AuthProvider.signup rejects. Accounts are created by an admin instead.
  describe('signup', () => {
    it('should reject because self-service signup is disabled', async () => {
      mockAccount.get.mockRejectedValue(new Error('No session'));

      const { result } = renderHook(() => useAuth(), { wrapper });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      await expect(
        result.current.signup('Test TeamLead', 'teamLead@test.com', 'password123')
      ).rejects.toThrow('Signup is disabled. Ask an admin to create the user account.');

      expect(mockAccount.create).not.toHaveBeenCalled();
      expect(mockDatabases.createDocument).not.toHaveBeenCalled();
      expect(mockAccount.createEmailPasswordSession).not.toHaveBeenCalled();
      expect(result.current.user).toBeNull();
      expect(result.current.isTeamLead).toBe(false);
    });
  });

  describe('login', () => {
    it('should login with valid credentials and set agent role', async () => {
      const mockAccountData = {
        $id: 'user-456',
        email: 'agent@test.com',
        name: 'Test Agent',
      };

      const mockUserDoc = {
        $id: 'user-456',
        name: 'Test Agent',
        email: 'agent@test.com',
        role: 'agent',
        teamLeadId: 'teamLead-123',
        branchIds: [],
        branchId: null,
        $createdAt: '2024-01-01T00:00:00.000Z',
        $updatedAt: '2024-01-01T00:00:00.000Z',
      };

      mockAccount.get.mockRejectedValueOnce(new Error('No session'));
      mockAccount.createEmailPasswordSession.mockResolvedValue({} as any);
      mockAccount.get.mockResolvedValueOnce(mockAccountData as any);
      mockDatabases.getDocument.mockResolvedValue(mockUserDoc as any);

      const { result } = renderHook(() => useAuth(), { wrapper });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      await act(async () => {
        await result.current.login('agent@test.com', 'password123');
      });

      expect(mockAccount.createEmailPasswordSession).toHaveBeenCalledWith(
        'agent@test.com',
        'password123'
      );

      expect(result.current.user).toMatchObject(mockUserDoc);
      expect(result.current.isAgent).toBe(true);
      expect(result.current.isTeamLead).toBe(false);
    });

    it('should not resync the server session again on immediate window focus', async () => {
      const mockAccountData = {
        $id: 'user-focus',
        email: 'focus@test.com',
        name: 'Focus User',
      };

      const mockUserDoc = {
        $id: 'user-focus',
        name: 'Focus User',
        email: 'focus@test.com',
        role: 'agent',
        teamLeadId: null,
        branchIds: [],
        branchId: null,
        $createdAt: '2024-01-01T00:00:00.000Z',
        $updatedAt: '2024-01-01T00:00:00.000Z',
      };

      mockAccount.get.mockRejectedValueOnce(new Error('No session'));
      mockAccount.createEmailPasswordSession.mockResolvedValue({} as any);
      mockAccount.get.mockResolvedValueOnce(mockAccountData as any);
      mockDatabases.getDocument.mockResolvedValue(mockUserDoc as any);

      const { result } = renderHook(() => useAuth(), { wrapper });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      await act(async () => {
        await result.current.login('focus@test.com', 'password123');
      });

      const postCallsAfterLogin = mockFetch.mock.calls.filter(
        ([url, options]) => url === '/api/auth/appwrite-session' && options?.method === 'POST'
      );
      expect(postCallsAfterLogin).toHaveLength(1);

      await waitFor(() => {
        expect(result.current.user?.$id).toBe('user-focus');
      });

      await act(async () => {
        window.dispatchEvent(new Event('focus'));
      });

      const postCallsAfterFocus = mockFetch.mock.calls.filter(
        ([url, options]) => url === '/api/auth/appwrite-session' && options?.method === 'POST'
      );
      expect(postCallsAfterFocus).toHaveLength(1);
    });
  });

  describe('logout', () => {
    it('should logout and clear user state', async () => {
      const mockUserDoc = {
        $id: 'user-789',
        name: 'Test User',
        email: 'user@test.com',
        role: 'team_lead' as const,
        teamLeadId: null,
        branchIds: [],
        branchId: null,
        $createdAt: '2024-01-01T00:00:00.000Z',
        $updatedAt: '2024-01-01T00:00:00.000Z',
      };

      mockAccount.get.mockResolvedValue({ $id: 'user-789' } as any);
      mockDatabases.getDocument.mockResolvedValue(mockUserDoc as any);

      const { result } = renderHook(() => useAuth(), { wrapper });

      await waitFor(() => {
        expect(result.current.user).toMatchObject(mockUserDoc);
      });

      mockAccount.deleteSession.mockResolvedValue({} as any);

      await act(async () => {
        await result.current.logout();
      });

      expect(mockAccount.deleteSession).toHaveBeenCalledWith('current');
      expect(result.current.user).toBeNull();
      expect(result.current.isTeamLead).toBe(false);
      expect(result.current.isAgent).toBe(false);
    });
  });

  describe('role-based helpers', () => {
    it('should correctly identify teamLead role', async () => {
      const mockUserDoc = {
        $id: 'user-teamLead',
        name: 'TeamLead User',
        email: 'teamLead@test.com',
        role: 'team_lead' as const,
        teamLeadId: null,
        branchIds: [],
        branchId: null,
        $createdAt: '2024-01-01T00:00:00.000Z',
        $updatedAt: '2024-01-01T00:00:00.000Z',
      };

      mockAccount.get.mockResolvedValue({ $id: 'user-teamLead' } as any);
      mockDatabases.getDocument.mockResolvedValue(mockUserDoc as any);

      const { result } = renderHook(() => useAuth(), { wrapper });

      await waitFor(() => {
        expect(result.current.user).toMatchObject(mockUserDoc);
      });

      expect(result.current.isTeamLead).toBe(true);
      expect(result.current.isAgent).toBe(false);
    });

    it('should correctly identify agent role', async () => {
      const mockUserDoc = {
        $id: 'user-agent',
        name: 'Agent User',
        email: 'agent@test.com',
        role: 'agent' as const,
        teamLeadId: 'teamLead-123',
        branchIds: [],
        branchId: null,
        $createdAt: '2024-01-01T00:00:00.000Z',
        $updatedAt: '2024-01-01T00:00:00.000Z',
      };

      mockAccount.get.mockResolvedValue({ $id: 'user-agent' } as any);
      mockDatabases.getDocument.mockResolvedValue(mockUserDoc as any);

      const { result } = renderHook(() => useAuth(), { wrapper });

      await waitFor(() => {
        expect(result.current.user).toMatchObject(mockUserDoc);
      });

      expect(result.current.isAgent).toBe(true);
      expect(result.current.isTeamLead).toBe(false);
    });
  });

  describe('department helpers', () => {
    it('should treat users with department="resume" as the resume team', async () => {
      const mockUserDoc = {
        $id: 'user-resume',
        name: 'Resume User',
        email: 'resume@test.com',
        role: 'agent' as const,
        department: 'resume',
        teamLeadId: null,
        branchIds: [],
        branchId: null,
        $createdAt: '2024-01-01T00:00:00.000Z',
        $updatedAt: '2024-01-01T00:00:00.000Z',
      };

      mockAccount.get.mockResolvedValue({ $id: 'user-resume' } as any);
      mockDatabases.getDocument.mockResolvedValue(mockUserDoc as any);

      const { result } = renderHook(() => useAuth(), { wrapper });

      await waitFor(() => {
        expect(result.current.user).toMatchObject(mockUserDoc);
      });

      expect(result.current.user?.department).toBe('resume');
      expect(result.current.isResumeTeam).toBe(true);
      expect(result.current.isSalesTeam).toBe(false);
    });

    it('should default to the sales team when the department field is missing', async () => {
      const mockUserDoc = {
        $id: 'user-legacy',
        name: 'Legacy User',
        email: 'legacy@test.com',
        role: 'agent' as const,
        teamLeadId: null,
        branchIds: [],
        branchId: null,
        $createdAt: '2024-01-01T00:00:00.000Z',
        $updatedAt: '2024-01-01T00:00:00.000Z',
      };

      mockAccount.get.mockResolvedValue({ $id: 'user-legacy' } as any);
      mockDatabases.getDocument.mockResolvedValue(mockUserDoc as any);

      const { result } = renderHook(() => useAuth(), { wrapper });

      await waitFor(() => {
        expect(result.current.user).toMatchObject(mockUserDoc);
      });

      expect(result.current.user?.department).toBe('sales');
      expect(result.current.isResumeTeam).toBe(false);
      expect(result.current.isSalesTeam).toBe(true);
    });
  });
});
