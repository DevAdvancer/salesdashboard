import { renderHook, waitFor, act } from '@testing-library/react';
import { AuthProvider, useAuth } from '@/lib/contexts/auth-context';
import { account, databases } from '@/lib/appwrite';
import { ReactNode } from 'react';

jest.mock('@/lib/appwrite', () => ({
  account: {
    get: jest.fn(),
    createEmailPasswordSession: jest.fn(),
    deleteSession: jest.fn(),
  },
  databases: {
    getDocument: jest.fn(),
  },
  DATABASE_ID: 'test-db',
  COLLECTIONS: {
    USERS: 'test-users-collection',
  },
}));

const mockAccount = account as jest.Mocked<typeof account>;
const mockDatabases = databases as jest.Mocked<typeof databases>;

describe('Session Persistence and Restoration - Task 2.5', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  const wrapper = ({ children }: { children: ReactNode }) => (
    <AuthProvider>{children}</AuthProvider>
  );

  it('should restore user session on mount if valid session exists', async () => {
    const mockSession = { $id: 'user-123' };
    const mockUserDoc = {
      $id: 'user-123',
      name: 'Test User',
      email: 'test@example.com',
      role: 'manager',
      managerId: null,
      branchId: null,
    };

    mockAccount.get.mockResolvedValue(mockSession as any);
    mockDatabases.getDocument.mockResolvedValue(mockUserDoc as any);

    const { result } = renderHook(() => useAuth(), { wrapper });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.user).toEqual(mockUserDoc);
    expect(mockAccount.get).toHaveBeenCalled();
    expect(mockDatabases.getDocument).toHaveBeenCalled();
  });

  it('should handle no existing session gracefully', async () => {
    mockAccount.get.mockRejectedValue(new Error('No session'));

    const { result } = renderHook(() => useAuth(), { wrapper });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.user).toBeNull();
    expect(mockDatabases.getDocument).not.toHaveBeenCalled();
  });

  it('should fetch and store user document after login', async () => {
    mockAccount.get.mockRejectedValueOnce(new Error('No session'));

    const { result } = renderHook(() => useAuth(), { wrapper });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    const mockUserDoc = {
      $id: 'user-456',
      name: 'Agent User',
      email: 'agent@test.com',
      role: 'agent',
      managerId: 'manager-123',
      branchId: null,
    };

    mockAccount.createEmailPasswordSession.mockResolvedValue({} as any);
    mockAccount.get.mockResolvedValue({ $id: 'user-456' } as any);
    mockDatabases.getDocument.mockResolvedValue(mockUserDoc as any);

    await act(async () => {
      await result.current.login('agent@test.com', 'password123');
    });

    expect(result.current.user).toEqual(mockUserDoc);
  });

  it('should clear user data on logout', async () => {
    const mockUserDoc = {
      $id: 'user-789',
      name: 'Test User',
      email: 'test@example.com',
      role: 'manager',
      managerId: null,
      branchId: null,
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

    expect(result.current.user).toBeNull();
    expect(mockAccount.deleteSession).toHaveBeenCalledWith('current');
  });
});
