import { renderHook, waitFor } from '@testing-library/react';
import { AuthProvider, useAuth } from '@/lib/contexts/auth-context';
import { account, databases } from '@/lib/appwrite';

// Mock Appwrite SDK
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

/**
 * Self-service signup was deliberately removed from the product. `/signup`
 * redirects to `/login`, the login page renders no signup link, and
 * `AuthProvider.signup` rejects instead of provisioning anything. Accounts are
 * created by an admin. These tests pin that contract so signup cannot quietly
 * come back as an unauthenticated account-creation path.
 */
describe('AuthContext - Signup Flow (disabled)', () => {
  const SIGNUP_DISABLED_MESSAGE =
    'Signup is disabled. Ask an admin to create the user account.';

  beforeEach(() => {
    jest.clearAllMocks();
    (account.createJWT as jest.Mock).mockResolvedValue({ jwt: 'test-jwt' });
    global.fetch = jest.fn().mockResolvedValue({ ok: true }) as unknown as typeof fetch;
  });

  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <AuthProvider>{children}</AuthProvider>
  );

  const renderReadyAuth = async () => {
    const { result } = renderHook(() => useAuth(), { wrapper });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    return result;
  };

  it('rejects with an explanation that an admin must create the account', async () => {
    (account.get as jest.Mock).mockRejectedValue(new Error('No session'));

    const result = await renderReadyAuth();

    await expect(
      result.current.signup('Test TeamLead', 'teamLead@example.com', 'password123')
    ).rejects.toThrow(SIGNUP_DISABLED_MESSAGE);
  });

  it('does not create an Appwrite account or a user document', async () => {
    (account.get as jest.Mock).mockRejectedValue(new Error('No session'));

    const result = await renderReadyAuth();

    await expect(
      result.current.signup('Test TeamLead', 'teamLead@example.com', 'password123')
    ).rejects.toThrow(SIGNUP_DISABLED_MESSAGE);

    expect(account.create).not.toHaveBeenCalled();
    expect(databases.createDocument).not.toHaveBeenCalled();
  });

  it('does not create a session for the caller', async () => {
    (account.get as jest.Mock).mockRejectedValue(new Error('No session'));

    const result = await renderReadyAuth();

    await expect(
      result.current.signup('Test TeamLead', 'teamLead@example.com', 'password123')
    ).rejects.toThrow(SIGNUP_DISABLED_MESSAGE);

    expect(account.createEmailPasswordSession).not.toHaveBeenCalled();
    expect(account.deleteSession).not.toHaveBeenCalled();
  });

  it('leaves the current auth state untouched', async () => {
    const existingUserDoc = {
      $id: 'existing-user',
      name: 'Existing User',
      email: 'existing@example.com',
      role: 'team_lead',
      department: 'sales',
      isActive: true,
      teamLeadId: null,
      branchIds: [],
      branchId: null,
      $createdAt: '2024-01-01T00:00:00.000Z',
      $updatedAt: '2024-01-01T00:00:00.000Z',
    };

    (account.get as jest.Mock).mockResolvedValue({ $id: 'existing-user' });
    (databases.getDocument as jest.Mock).mockResolvedValue(existingUserDoc);

    const result = await renderReadyAuth();

    await waitFor(() => {
      expect(result.current.user).toEqual(existingUserDoc);
    });

    await expect(
      result.current.signup('Someone Else', 'someone@example.com', 'password123')
    ).rejects.toThrow(SIGNUP_DISABLED_MESSAGE);

    expect(result.current.user).toEqual(existingUserDoc);
    expect(result.current.isTeamLead).toBe(true);
  });
});
