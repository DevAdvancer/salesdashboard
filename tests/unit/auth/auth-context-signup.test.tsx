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

  it('creates teamLead account with role=teamLead and teamLeadId=null on signup', async () => {
    const mockAccountData = {
      $id: 'test-user-id',
      email: 'teamLead@example.com',
      name: 'Test TeamLead',
    };

    const mockUserDocument = {
      $id: 'test-user-id',
      name: 'Test TeamLead',
      email: 'teamLead@example.com',
      role: 'team_lead',
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
      await result.current.signup('Test TeamLead', 'teamLead@example.com', 'password123');
    });

    // Verify account.create was called with correct parameters
    expect(account.create).toHaveBeenCalledWith(
      'test-unique-id',
      'teamLead@example.com',
      'password123',
      'Test TeamLead'
    );

    // Verify user document was created with teamLead role and null teamLeadId
    expect(databases.createDocument).toHaveBeenCalledWith(
      DATABASE_ID,
      COLLECTIONS.USERS,
      'test-user-id',
      {
        name: 'Test TeamLead',
        email: 'teamLead@example.com',
        role: 'team_lead',
        teamLeadId: null,
      }
    );

    // Verify session was created
    expect(account.createEmailPasswordSession).toHaveBeenCalledWith(
      'teamLead@example.com',
      'password123'
    );

    // Verify user state is set correctly
    expect(result.current.user).toEqual(mockUserDocument);
    expect(result.current.isManager).toBe(true);
    expect(result.current.isAgent).toBe(false);
  });

  it('sets teamLeadId to null for teamLead accounts', async () => {
    const mockAccountData = {
      $id: 'teamLead-id',
      email: 'teamLead@example.com',
      name: 'TeamLead User',
    };

    const mockUserDocument = {
      $id: 'teamLead-id',
      name: 'TeamLead User',
      email: 'teamLead@example.com',
      role: 'team_lead',
      teamLeadId: null,
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
      await result.current.signup('TeamLead User', 'teamLead@example.com', 'password123');
    });

    // Verify teamLeadId is explicitly set to null
    const createDocumentCall = (databases.createDocument as jest.Mock).mock.calls[0];
    expect(createDocumentCall[3].teamLeadId).toBeNull();
    expect(createDocumentCall[3].role).toBe('team_lead');
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
