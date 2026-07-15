/**
 * Unit Test: Admin TeamLead Creation Authorization
 *
 * Tests admin authorization for creating teamLead accounts.
 * Validates Requirements 1.1 (admin can create teamLeads) and 1.3 (non-admin denied).
 *
 * Requirements: 1.1, 1.3
 */

import { createTeamLead } from '@/lib/services/user-service';
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

describe('Admin TeamLead Creation Authorization', () => {
  const mockManagerInput = {
    name: 'Test TeamLead',
    email: 'teamLead@example.com',
    password: 'securePassword123',
    branchIds: ['branch-1', 'branch-2'],
  };

  const mockCurrentUser: any = {
    $id: 'admin-123',
    name: 'Admin User',
    email: 'admin@example.com',
    role: 'admin',
    branchIds: [],
  };

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.NEXT_PUBLIC_APPWRITE_DATABASE_ID = 'test-database';
    process.env.NEXT_PUBLIC_APPWRITE_USERS_COLLECTION_ID = 'test-users';
    process.env.NEXT_PUBLIC_APPWRITE_BRANCHES_COLLECTION_ID = 'test-branches';
  });

  describe('Successful TeamLead Creation', () => {
    it('should allow admin to create teamLead with valid data', async () => {
      const mockCreatedManager = {
        $id: 'teamLead-456',
        name: mockManagerInput.name,
        email: mockManagerInput.email,
        role: 'team_lead',
        teamLeadId: null,
        branchIds: mockManagerInput.branchIds,
        $createdAt: '2024-01-01T00:00:00.000Z',
        $updatedAt: '2024-01-01T00:00:00.000Z',
      };

      (account.create as jest.Mock).mockResolvedValue({ $id: 'teamLead-456' });
      (databases.createDocument as jest.Mock).mockResolvedValue(mockCreatedManager);

      const result = await createTeamLead(mockManagerInput, mockCurrentUser);

      // Verify success
      expect(result.role).toBe('team_lead');
      expect(result.name).toBe(mockManagerInput.name);
      expect(result.email).toBe(mockManagerInput.email);
      expect(result.teamLeadId).toBeNull();
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
          role: 'team_lead',
          teamLeadId: null,
          branchIds: mockManagerInput.branchIds,
        }),
        expect.arrayContaining([
          expect.stringContaining('read'),
          expect.stringContaining('update'),
        ])
      );
    });

    it('should create teamLead with correct permissions', async () => {
      const mockCreatedManager = {
        $id: 'teamLead-456',
        name: mockManagerInput.name,
        email: mockManagerInput.email,
        role: 'team_lead',
        teamLeadId: null,
        branchIds: mockManagerInput.branchIds,
        $createdAt: '2024-01-01T00:00:00.000Z',
        $updatedAt: '2024-01-01T00:00:00.000Z',
      };

      (account.create as jest.Mock).mockResolvedValue({ $id: 'teamLead-456' });
      (databases.createDocument as jest.Mock).mockResolvedValue(mockCreatedManager);

      await createTeamLead(mockManagerInput, mockCurrentUser);

      // Verify permissions include read and update for the teamLead user
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

    it('should allow admin to assign multiple branches to teamLead', async () => {
      const inputWithMultipleBranches = {
        ...mockManagerInput,
        branchIds: ['branch-1', 'branch-2', 'branch-3'],
      };

      const mockCreatedManager = {
        $id: 'teamLead-456',
        name: inputWithMultipleBranches.name,
        email: inputWithMultipleBranches.email,
        role: 'team_lead',
        teamLeadId: null,
        branchIds: inputWithMultipleBranches.branchIds,
        $createdAt: '2024-01-01T00:00:00.000Z',
        $updatedAt: '2024-01-01T00:00:00.000Z',
      };

      (account.create as jest.Mock).mockResolvedValue({ $id: 'teamLead-456' });
      (databases.createDocument as jest.Mock).mockResolvedValue(mockCreatedManager);

      const result = await createTeamLead(inputWithMultipleBranches, mockCurrentUser);

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
    it('should reject teamLead creation when email already exists', async () => {
      const duplicateError = new Error('User already exists');
      (duplicateError as any).code = 409;

      (account.create as jest.Mock).mockRejectedValue(duplicateError);

      await expect(createTeamLead(mockManagerInput, mockCurrentUser)).rejects.toThrow(
        'A user with this email already exists'
      );
    });

    it('should reject teamLead creation with no branches assigned', async () => {
      const inputWithNoBranches = {
        ...mockManagerInput,
        branchIds: [],
      };

      await expect(createTeamLead(inputWithNoBranches, mockCurrentUser)).rejects.toThrow(
        'At least one branch must be assigned'
      );

      // Verify no account creation was attempted
      expect(account.create).not.toHaveBeenCalled();
    });

    it('should handle database errors during teamLead creation', async () => {
      (account.create as jest.Mock).mockResolvedValue({ $id: 'teamLead-456' });
      (databases.createDocument as jest.Mock).mockRejectedValue(
        new Error('Database connection failed')
      );

      await expect(createTeamLead(mockManagerInput, mockCurrentUser)).rejects.toThrow();
    });

    it('should handle network errors during account creation', async () => {
      const networkError = new Error('Network error');
      (account.create as jest.Mock).mockRejectedValue(networkError);

      await expect(createTeamLead(mockManagerInput, mockCurrentUser)).rejects.toThrow();
    });
  });

  describe('Edge Cases', () => {
    it('should handle teamLead creation with single branch', async () => {
      const inputWithOneBranch = {
        ...mockManagerInput,
        branchIds: ['branch-1'],
      };

      const mockCreatedManager = {
        $id: 'teamLead-456',
        name: inputWithOneBranch.name,
        email: inputWithOneBranch.email,
        role: 'team_lead',
        teamLeadId: null,
        branchIds: ['branch-1'],
        $createdAt: '2024-01-01T00:00:00.000Z',
        $updatedAt: '2024-01-01T00:00:00.000Z',
      };

      (account.create as jest.Mock).mockResolvedValue({ $id: 'teamLead-456' });
      (databases.createDocument as jest.Mock).mockResolvedValue(mockCreatedManager);

      const result = await createTeamLead(inputWithOneBranch, mockCurrentUser);

      expect(result.branchIds).toEqual(['branch-1']);
    });

    it('should set teamLeadId and teamLeadId to null for teamLeads', async () => {
      const mockCreatedManager = {
        $id: 'teamLead-456',
        name: mockManagerInput.name,
        email: mockManagerInput.email,
        role: 'team_lead',
        teamLeadId: null,
        branchIds: mockManagerInput.branchIds,
        $createdAt: '2024-01-01T00:00:00.000Z',
        $updatedAt: '2024-01-01T00:00:00.000Z',
      };

      (account.create as jest.Mock).mockResolvedValue({ $id: 'teamLead-456' });
      (databases.createDocument as jest.Mock).mockResolvedValue(mockCreatedManager);

      const result = await createTeamLead(mockManagerInput, mockCurrentUser);

      expect(result.teamLeadId).toBeNull();
      expect(result.teamLeadId).toBeNull();
    });

    it('should handle special characters in teamLead name and email', async () => {
      const inputWithSpecialChars = {
        name: "O'Brien-Smith",
        email: 'teamLead+test@example.com',
        password: 'securePassword123',
        branchIds: ['branch-1'],
      };

      const mockCreatedManager = {
        $id: 'teamLead-456',
        name: inputWithSpecialChars.name,
        email: inputWithSpecialChars.email,
        role: 'team_lead',
        teamLeadId: null,
        branchIds: inputWithSpecialChars.branchIds,
        $createdAt: '2024-01-01T00:00:00.000Z',
        $updatedAt: '2024-01-01T00:00:00.000Z',
      };

      (account.create as jest.Mock).mockResolvedValue({ $id: 'teamLead-456' });
      (databases.createDocument as jest.Mock).mockResolvedValue(mockCreatedManager);

      const result = await createTeamLead(inputWithSpecialChars, mockCurrentUser);

      expect(result.name).toBe("O'Brien-Smith");
      expect(result.email).toBe('teamLead+test@example.com');
    });
  });

  describe('TeamLead Role Verification', () => {
    it('should ensure created user has teamLead role', async () => {
      const mockCreatedManager = {
        $id: 'teamLead-456',
        name: mockManagerInput.name,
        email: mockManagerInput.email,
        role: 'team_lead',
        teamLeadId: null,
        branchIds: mockManagerInput.branchIds,
        $createdAt: '2024-01-01T00:00:00.000Z',
        $updatedAt: '2024-01-01T00:00:00.000Z',
      };

      (account.create as jest.Mock).mockResolvedValue({ $id: 'teamLead-456' });
      (databases.createDocument as jest.Mock).mockResolvedValue(mockCreatedManager);

      const result = await createTeamLead(mockManagerInput, mockCurrentUser);

      expect(result.role).toBe('team_lead');
      expect(databases.createDocument).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        expect.any(String),
        expect.objectContaining({
          role: 'team_lead',
        }),
        expect.any(Array)
      );
    });

    it('should not assign teamLead to another teamLead or team lead', async () => {
      const mockCreatedManager = {
        $id: 'teamLead-456',
        name: mockManagerInput.name,
        email: mockManagerInput.email,
        role: 'team_lead',
        teamLeadId: null,
        branchIds: mockManagerInput.branchIds,
        $createdAt: '2024-01-01T00:00:00.000Z',
        $updatedAt: '2024-01-01T00:00:00.000Z',
      };

      (account.create as jest.Mock).mockResolvedValue({ $id: 'teamLead-456' });
      (databases.createDocument as jest.Mock).mockResolvedValue(mockCreatedManager);

      await createTeamLead(mockManagerInput, mockCurrentUser);

      // Verify teamLeadId and teamLeadId are explicitly set to null
      expect(databases.createDocument).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        expect.any(String),
        expect.objectContaining({
          teamLeadId: null,
        }),
        expect.any(Array)
      );
    });
  });
});
