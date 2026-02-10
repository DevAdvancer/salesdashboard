import { renderHook, act, waitFor } from '@testing-library/react';
import { AuthProvider, useAuth } from '@/lib/contexts/auth-context';
import { account, databases, DATABASE_ID, COLLECTIONS } from '@/lib/appwrite';
import { ID } from 'appwrite';

// Mock Appwrite SDK
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
  DATABASE_ID: 'test-database',
  COLLECTIONS: {
    USERS: 'test-users-collection',
    LEADS: 'test-leads-collection',
    FORM_CONFIG: 'test-form-config-collection',
    ACCESS_CONFIG: 'test-access-config-collection',
  },
}));

jest.mock('appwrite', () => ({
  ID: {
    unique: jest.fn(() => 'test-unique-id'),
  },
}));

describe('AuthContext - Signup Flow', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('creates manager account with role=manager and managerId=null on signup', async () => {
    const mockAccountData = {
      $id: 'test-user-id',
      email: 'manager@example.com',
      name: 'Test Manager',
    };

    const mockUserDocument = {
      $id: 'test-user-id',
      name: 'Test Manager',
      email: 'manager@example.com',
      role: 'manager',
      managerId: null,
      teamLeadId: null,
      branchIds: [],
      branchId: null,
      $createdAt: '2024-01-01T00:00:00.000Z',
      $updatedAt: '2024-01-01T00:00:00.000Z',
    };

    // Mock Appwrite responses
    (account.create as jest.Mock).mockResolvedValue(mockAccountData);
    (databases.createDocument as jest.Mock).mockResolvedValue(mockUserDocument);
    (account.createEmailPasswordSession as jest.Mock).mockResolvedValue({});
    (account.get as jest.Mock).mockResolvedValue(mockAccountData);

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <AuthProvider>{children}</AuthProvider>
    );

    const { result } = renderHook(() => useAuth(), { wrapper });

    // Wait for initial loading to complete
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    // Call signup
    await act(async () => {
      await result.current.signup('Test Manager', 'manager@example.com', 'password123');
    });

    // Verify account.create was called with correct parameters
    expect(account.create).toHaveBeenCalledWith(
      'test-unique-id',
      'manager@example.com',
      'password123',
      'Test Manager'
    );

    // Verify user document was created with manager role and null managerId
    expect(databases.createDocument).toHaveBeenCalledWith(
      DATABASE_ID,
      COLLECTIONS.USERS,
      'test-user-id',
      {
        name: 'Test Manager',
        email: 'manager@example.com',
        role: 'manager',
        managerId: null,
      }
    );

    // Verify session was created
    expect(account.createEmailPasswordSession).toHaveBeenCalledWith(
      'manager@example.com',
      'password123'
    );

    // Verify user state is set correctly
    expect(result.current.user).toEqual(mockUserDocument);
    expect(result.current.isManager).toBe(true);
    expect(result.current.isAgent).toBe(false);
  });

  it('sets managerId to null for manager accounts', async () => {
    const mockAccountData = {
      $id: 'manager-id',
      email: 'manager@example.com',
      name: 'Manager User',
    };

    const mockUserDocument = {
      $id: 'manager-id',
      name: 'Manager User',
      email: 'manager@example.com',
      role: 'manager',
      managerId: null,
      branchId: null,
      $createdAt: '2024-01-01T00:00:00.000Z',
      $updatedAt: '2024-01-01T00:00:00.000Z',
    };

    (account.create as jest.Mock).mockResolvedValue(mockAccountData);
    (databases.createDocument as jest.Mock).mockResolvedValue(mockUserDocument);
    (account.createEmailPasswordSession as jest.Mock).mockResolvedValue({});
    (account.get as jest.Mock).mockResolvedValue(mockAccountData);

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <AuthProvider>{children}</AuthProvider>
    );

    const { result } = renderHook(() => useAuth(), { wrapper });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    await act(async () => {
      await result.current.signup('Manager User', 'manager@example.com', 'password123');
    });

    // Verify managerId is explicitly set to null
    const createDocumentCall = (databases.createDocument as jest.Mock).mock.calls[0];
    expect(createDocumentCall[3].managerId).toBeNull();
    expect(createDocumentCall[3].role).toBe('manager');
  });

  it('throws error when account creation fails', async () => {
    (account.create as jest.Mock).mockRejectedValue(new Error('Account creation failed'));
    (account.get as jest.Mock).mockResolvedValue(null);

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <AuthProvider>{children}</AuthProvider>
    );

    const { result } = renderHook(() => useAuth(), { wrapper });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    await expect(async () => {
      await act(async () => {
        await result.current.signup('Test User', 'test@example.com', 'password123');
      });
    }).rejects.toThrow('Account creation failed');

    // Verify user document was not created
    expect(databases.createDocument).not.toHaveBeenCalled();
  });

  it('throws error when user document creation fails', async () => {
    const mockAccountData = {
      $id: 'test-user-id',
      email: 'test@example.com',
      name: 'Test User',
    };

    (account.create as jest.Mock).mockResolvedValue(mockAccountData);
    (databases.createDocument as jest.Mock).mockRejectedValue(
      new Error('Document creation failed')
    );
    (account.get as jest.Mock).mockResolvedValue(null);

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <AuthProvider>{children}</AuthProvider>
    );

    const { result } = renderHook(() => useAuth(), { wrapper });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    await expect(async () => {
      await act(async () => {
        await result.current.signup('Test User', 'test@example.com', 'password123');
      });
    }).rejects.toThrow('Document creation failed');

    // Verify session was not created
    expect(account.createEmailPasswordSession).not.toHaveBeenCalled();
  });
});
