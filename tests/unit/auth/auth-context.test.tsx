import { renderHook, act, waitFor } from '@testing-library/react';
import { AuthProvider, useAuth } from '@/lib/contexts/auth-context';
import { account, databases } from '@/lib/appwrite';
import { ReactNode } from 'react';

// Mock Appwrite modules
jest.mock('@/lib/appwrite', () => ({
  account: {
    create: jest.fn(),
    createEmailPasswordSession: jest.fn(),
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
  beforeEach(() => {
    jest.clearAllMocks();
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
      expect(result.current.isManager).toBe(false);
      expect(result.current.isAgent).toBe(false);
      expect(typeof result.current.login).toBe('function');
      expect(typeof result.current.logout).toBe('function');
      expect(typeof result.current.signup).toBe('function');
    });
  });

  describe('signup', () => {
    it('should create manager account by default', async () => {
      const mockAccountData = {
        $id: 'user-123',
        email: 'manager@test.com',
        name: 'Test Manager',
      };

      const mockUserDoc = {
        $id: 'user-123',
        name: 'Test Manager',
        email: 'manager@test.com',
        role: 'manager',
        managerId: null,
        teamLeadId: null,
        branchIds: [],
        branchId: null,
        $createdAt: '2024-01-01T00:00:00.000Z',
        $updatedAt: '2024-01-01T00:00:00.000Z',
      };

      mockAccount.get.mockRejectedValue(new Error('No session'));
      mockAccount.create.mockResolvedValue(mockAccountData as any);
      mockDatabases.createDocument.mockResolvedValue(mockUserDoc as any);
      mockAccount.createEmailPasswordSession.mockResolvedValue({} as any);

      const { result } = renderHook(() => useAuth(), { wrapper });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      await act(async () => {
        await result.current.signup('Test Manager', 'manager@test.com', 'password123');
      });

      expect(mockAccount.create).toHaveBeenCalledWith(
        expect.any(String),
        'manager@test.com',
        'password123',
        'Test Manager'
      );

      expect(mockDatabases.createDocument).toHaveBeenCalledWith(
        'test-db',
        'test-users-collection',
        'user-123',
        {
          name: 'Test Manager',
          email: 'manager@test.com',
          role: 'manager',
          managerId: null,
        }
      );

      expect(mockAccount.createEmailPasswordSession).toHaveBeenCalledWith(
        'manager@test.com',
        'password123'
      );

      expect(result.current.user).toEqual(mockUserDoc);
      expect(result.current.isManager).toBe(true);
      expect(result.current.isAgent).toBe(false);
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
        managerId: 'manager-123',
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
        await result.current.login('agent@test.com', 'password123');
      });

      expect(mockAccount.createEmailPasswordSession).toHaveBeenCalledWith(
        'agent@test.com',
        'password123'
      );

      expect(result.current.user).toEqual(mockUserDoc);
      expect(result.current.isAgent).toBe(true);
      expect(result.current.isManager).toBe(false);
    });
  });

  describe('logout', () => {
    it('should logout and clear user state', async () => {
      const mockUserDoc = {
        $id: 'user-789',
        name: 'Test User',
        email: 'user@test.com',
        role: 'manager' as const,
        managerId: null,
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
        expect(result.current.user).toEqual(mockUserDoc);
      });

      mockAccount.deleteSession.mockResolvedValue({} as any);

      await act(async () => {
        await result.current.logout();
      });

      expect(mockAccount.deleteSession).toHaveBeenCalledWith('current');
      expect(result.current.user).toBeNull();
      expect(result.current.isManager).toBe(false);
      expect(result.current.isAgent).toBe(false);
    });
  });

  describe('role-based helpers', () => {
    it('should correctly identify manager role', async () => {
      const mockUserDoc = {
        $id: 'user-manager',
        name: 'Manager User',
        email: 'manager@test.com',
        role: 'manager' as const,
        managerId: null,
        teamLeadId: null,
        branchIds: [],
        branchId: null,
        $createdAt: '2024-01-01T00:00:00.000Z',
        $updatedAt: '2024-01-01T00:00:00.000Z',
      };

      mockAccount.get.mockResolvedValue({ $id: 'user-manager' } as any);
      mockDatabases.getDocument.mockResolvedValue(mockUserDoc as any);

      const { result } = renderHook(() => useAuth(), { wrapper });

      await waitFor(() => {
        expect(result.current.user).toEqual(mockUserDoc);
      });

      expect(result.current.isManager).toBe(true);
      expect(result.current.isAgent).toBe(false);
    });

    it('should correctly identify agent role', async () => {
      const mockUserDoc = {
        $id: 'user-agent',
        name: 'Agent User',
        email: 'agent@test.com',
        role: 'agent' as const,
        managerId: 'manager-123',
        teamLeadId: null,
        branchIds: [],
        branchId: null,
        $createdAt: '2024-01-01T00:00:00.000Z',
        $updatedAt: '2024-01-01T00:00:00.000Z',
      };

      mockAccount.get.mockResolvedValue({ $id: 'user-agent' } as any);
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
