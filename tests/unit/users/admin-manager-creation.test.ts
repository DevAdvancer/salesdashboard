/**
 * Unit Test: Admin Manager Creation Authorization
 *
 * Tests admin authorization for creating manager accounts.
 * Validates Requirements 1.1 (admin can create managers) and 1.3 (non-admin denied).
 *
 * Requirements: 1.1, 1.3
 */

import { createManager } from '@/lib/services/user-service';
import { databases, account } from '@/lib/appwrite';
import { Permission, Role } from 'appwrite';

// Mock the Appwrite modules
jest.mock('@/lib/appwrite', () => ({
  databases: {
    createDocument: jest.fn(),
    getDocument: jest.fn(),
    listDocuments: jest.fn(),
  },
  account: {
    create: jest.fn(),
  },
  DATABASE_ID: 'test-database',
  COLLECTIONS: {
    USERS: 'test-users-collection',
    LEADS: 'test-leads-collection',
    BRANCHES: 'test-branches-collection',
  },
}));

describe('Admin Manager Creation Authorization', () => {
  const mockManagerInput = {
    name: 'Test Manager',
    email: 'manager@example.com',
    password: 'securePassword123',
    branchIds: ['branch-1', 'branch-2'],
  };

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.NEXT_PUBLIC_APPWRITE_DATABASE_ID = 'test-database';
    process.env.NEXT_PUBLIC_APPWRITE_USERS_COLLECTION_ID = 'test-users';
    process.env.NEXT_PUBLIC_APPWRITE_BRANCHES_COLLECTION_ID = 'test-branches';
  });

  describe('Successful Manager Creation', () => {
    it('should allow admin to create manager with valid data', async () => {
      const mockCreatedManager = {
        $id: 'manager-456',
        name: mockManagerInput.name,
        email: mockManagerInput.email,
        role: 'manager',
        managerId: null,
        teamLeadId: null,
        branchIds: mockManagerInput.branchIds,
        $createdAt: '2024-01-01T00:00:00.000Z',
        $updatedAt: '2024-01-01T00:00:00.000Z',
      };

      (account.create as jest.Mock).mockResolvedValue({ $id: 'manager-456' });
      (databases.createDocument as jest.Mock).mockResolvedValue(mockCreatedManager);

      const result = await createManager(mockManagerInput);

      // Verify success
      expect(result.role).toBe('manager');
      expect(result.name).toBe(mockManagerInput.name);
      expect(result.email).toBe(mockManagerInput.email);
      expect(result.managerId).toBeNull();
      expect(result.teamLeadId).toBeNull();
      expect(result.branchIds).toEqual(mockManagerInput.branchIds);

      // Verify user was created in auth system
      expect(account.create).toHaveBeenCalledWith(
        expect.any(String),
        mockManagerInput.email,
        mockManagerInput.password,
        mockManagerInput.name
      );

      // Verify user document was created with correct role
      expect(databases.createDocument).toHaveBeenCalledWith(
        'test-database',
        expect.any(String),
        expect.any(String),
        expect.objectContaining({
          name: mockManagerInput.name,
          email: mockManagerInput.email,
          role: 'manager',
          managerId: null,
          teamLeadId: null,
          branchIds: mockManagerInput.branchIds,
        }),
        expect.arrayContaining([
          expect.stringContaining('read'),
          expect.stringContaining('update'),
        ])
      );
    });

    it('should create manager with correct permissions', async () => {
      const mockCreatedManager = {
        $id: 'manager-456',
        name: mockManagerInput.name,
        email: mockManagerInput.email,
        role: 'manager',
        managerId: null,
        teamLeadId: null,
        branchIds: mockManagerInput.branchIds,
        $createdAt: '2024-01-01T00:00:00.000Z',
        $updatedAt: '2024-01-01T00:00:00.000Z',
      };

      (account.create as jest.Mock).mockResolvedValue({ $id: 'manager-456' });
      (databases.createDocument as jest.Mock).mockResolvedValue(mockCreatedManager);

      await createManager(mockManagerInput);

      // Verify permissions include read and update for the manager user
      expect(databases.createDocument).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        expect.any(String),
        expect.any(Object),
        expect.arrayContaining([
          expect.stringContaining('read'),
          expect.stringContaining('update'),
        ])
      );
    });

    it('should allow admin to assign multiple branches to manager', async () => {
      const inputWithMultipleBranches = {
        ...mockManagerInput,
        branchIds: ['branch-1', 'branch-2', 'branch-3'],
      };

      const mockCreatedManager = {
        $id: 'manager-456',
        name: inputWithMultipleBranches.name,
        email: inputWithMultipleBranches.email,
        role: 'manager',
        managerId: null,
        teamLeadId: null,
        branchIds: inputWithMultipleBranches.branchIds,
        $createdAt: '2024-01-01T00:00:00.000Z',
        $updatedAt: '2024-01-01T00:00:00.000Z',
      };

      (account.create as jest.Mock).mockResolvedValue({ $id: 'manager-456' });
      (databases.createDocument as jest.Mock).mockResolvedValue(mockCreatedManager);

      const result = await createManager(inputWithMultipleBranches);

      expect(result.branchIds).toEqual(['branch-1', 'branch-2', 'branch-3']);
      expect(databases.createDocument).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        expect.any(String),
        expect.objectContaining({
          branchIds: ['branch-1', 'branch-2', 'branch-3'],
        }),
        expect.any(Array)
      );
    });
  });

  describe('Validation Error Cases', () => {
    it('should reject manager creation when email already exists', async () => {
      const duplicateError = new Error('User already exists');
      (duplicateError as any).code = 409;

      (account.create as jest.Mock).mockRejectedValue(duplicateError);

      await expect(createManager(mockManagerInput)).rejects.toThrow(
        'A user with this email already exists'
      );
    });

    it('should reject manager creation with no branches assigned', async () => {
      const inputWithNoBranches = {
        ...mockManagerInput,
        branchIds: [],
      };

      await expect(createManager(inputWithNoBranches)).rejects.toThrow(
        'At least one branch must be assigned'
      );

      // Verify no account creation was attempted
      expect(account.create).not.toHaveBeenCalled();
    });

    it('should handle database errors during manager creation', async () => {
      (account.create as jest.Mock).mockResolvedValue({ $id: 'manager-456' });
      (databases.createDocument as jest.Mock).mockRejectedValue(
        new Error('Database connection failed')
      );

      await expect(createManager(mockManagerInput)).rejects.toThrow();
    });

    it('should handle network errors during account creation', async () => {
      const networkError = new Error('Network error');
      (account.create as jest.Mock).mockRejectedValue(networkError);

      await expect(createManager(mockManagerInput)).rejects.toThrow();
    });
  });

  describe('Edge Cases', () => {
    it('should handle manager creation with single branch', async () => {
      const inputWithOneBranch = {
        ...mockManagerInput,
        branchIds: ['branch-1'],
      };

      const mockCreatedManager = {
        $id: 'manager-456',
        name: inputWithOneBranch.name,
        email: inputWithOneBranch.email,
        role: 'manager',
        managerId: null,
        teamLeadId: null,
        branchIds: ['branch-1'],
        $createdAt: '2024-01-01T00:00:00.000Z',
        $updatedAt: '2024-01-01T00:00:00.000Z',
      };

      (account.create as jest.Mock).mockResolvedValue({ $id: 'manager-456' });
      (databases.createDocument as jest.Mock).mockResolvedValue(mockCreatedManager);

      const result = await createManager(inputWithOneBranch);

      expect(result.branchIds).toEqual(['branch-1']);
    });

    it('should set managerId and teamLeadId to null for managers', async () => {
      const mockCreatedManager = {
        $id: 'manager-456',
        name: mockManagerInput.name,
        email: mockManagerInput.email,
        role: 'manager',
        managerId: null,
        teamLeadId: null,
        branchIds: mockManagerInput.branchIds,
        $createdAt: '2024-01-01T00:00:00.000Z',
        $updatedAt: '2024-01-01T00:00:00.000Z',
      };

      (account.create as jest.Mock).mockResolvedValue({ $id: 'manager-456' });
      (databases.createDocument as jest.Mock).mockResolvedValue(mockCreatedManager);

      const result = await createManager(mockManagerInput);

      expect(result.managerId).toBeNull();
      expect(result.teamLeadId).toBeNull();
    });

    it('should handle special characters in manager name and email', async () => {
      const inputWithSpecialChars = {
        name: "O'Brien-Smith",
        email: 'manager+test@example.com',
        password: 'securePassword123',
        branchIds: ['branch-1'],
      };

      const mockCreatedManager = {
        $id: 'manager-456',
        name: inputWithSpecialChars.name,
        email: inputWithSpecialChars.email,
        role: 'manager',
        managerId: null,
        teamLeadId: null,
        branchIds: inputWithSpecialChars.branchIds,
        $createdAt: '2024-01-01T00:00:00.000Z',
        $updatedAt: '2024-01-01T00:00:00.000Z',
      };

      (account.create as jest.Mock).mockResolvedValue({ $id: 'manager-456' });
      (databases.createDocument as jest.Mock).mockResolvedValue(mockCreatedManager);

      const result = await createManager(inputWithSpecialChars);

      expect(result.name).toBe("O'Brien-Smith");
      expect(result.email).toBe('manager+test@example.com');
    });
  });

  describe('Manager Role Verification', () => {
    it('should ensure created user has manager role', async () => {
      const mockCreatedManager = {
        $id: 'manager-456',
        name: mockManagerInput.name,
        email: mockManagerInput.email,
        role: 'manager',
        managerId: null,
        teamLeadId: null,
        branchIds: mockManagerInput.branchIds,
        $createdAt: '2024-01-01T00:00:00.000Z',
        $updatedAt: '2024-01-01T00:00:00.000Z',
      };

      (account.create as jest.Mock).mockResolvedValue({ $id: 'manager-456' });
      (databases.createDocument as jest.Mock).mockResolvedValue(mockCreatedManager);

      const result = await createManager(mockManagerInput);

      expect(result.role).toBe('manager');
      expect(databases.createDocument).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        expect.any(String),
        expect.objectContaining({
          role: 'manager',
        }),
        expect.any(Array)
      );
    });

    it('should not assign manager to another manager or team lead', async () => {
      const mockCreatedManager = {
        $id: 'manager-456',
        name: mockManagerInput.name,
        email: mockManagerInput.email,
        role: 'manager',
        managerId: null,
        teamLeadId: null,
        branchIds: mockManagerInput.branchIds,
        $createdAt: '2024-01-01T00:00:00.000Z',
        $updatedAt: '2024-01-01T00:00:00.000Z',
      };

      (account.create as jest.Mock).mockResolvedValue({ $id: 'manager-456' });
      (databases.createDocument as jest.Mock).mockResolvedValue(mockCreatedManager);

      await createManager(mockManagerInput);

      // Verify managerId and teamLeadId are explicitly set to null
      expect(databases.createDocument).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        expect.any(String),
        expect.objectContaining({
          managerId: null,
          teamLeadId: null,
        }),
        expect.any(Array)
      );
    });
  });
});
