import { Query } from 'appwrite';
import { databases, DATABASE_ID, COLLECTIONS } from '@/lib/appwrite';
import { Branch, CreateBranchInput, UpdateBranchInput } from '@/lib/types';

/**
 * Create a new branch
 *
 * Enforces unique branch names by querying for existing branches with the same name.
 * New branches are always created with isActive = true.
 *
 * @param input - The branch creation input
 * @returns The created branch
 */
export async function createBranch(input: CreateBranchInput): Promise<Branch> {
  try {
    // Check for duplicate branch name
    const existing = await databases.listDocuments(
      DATABASE_ID,
      COLLECTIONS.BRANCHES,
      [Query.equal('name', input.name)]
    );

    if (existing.total > 0) {
      throw new Error('A branch with this name already exists');
    }

    const branch = await databases.createDocument(
      DATABASE_ID,
      COLLECTIONS.BRANCHES,
      'unique()',
      {
        name: input.name,
        isActive: true,
      }
    );

    return branch as unknown as Branch;
  } catch (error: any) {
    if (error.message === 'A branch with this name already exists') {
      throw error;
    }
    console.error('Error creating branch:', error);
    throw new Error(error.message || 'Failed to create branch');
  }
}

/**
 * Get a branch by ID
 *
 * @param branchId - The branch ID
 * @returns The branch document
 */
export async function getBranch(branchId: string): Promise<Branch> {
  try {
    const branch = await databases.getDocument(
      DATABASE_ID,
      COLLECTIONS.BRANCHES,
      branchId
    );
    return branch as unknown as Branch;
  } catch (error: any) {
    console.error('Error fetching branch:', error);
    throw new Error(error.message || 'Failed to fetch branch');
  }
}

/**
 * Update a branch
 *
 * Updates only the specified fields (name and/or isActive).
 *
 * @param branchId - The branch ID
 * @param input - The fields to update
 * @returns The updated branch
 */
export async function updateBranch(branchId: string, input: UpdateBranchInput): Promise<Branch> {
  try {
    // If updating name, check for duplicates
    if (input.name !== undefined) {
      const existing = await databases.listDocuments(
        DATABASE_ID,
        COLLECTIONS.BRANCHES,
        [Query.equal('name', input.name)]
      );

      // Filter out the current branch from duplicate check
      const duplicates = existing.documents.filter(doc => doc.$id !== branchId);
      if (duplicates.length > 0) {
        throw new Error('A branch with this name already exists');
      }
    }

    const updateData: Record<string, any> = {};
    if (input.name !== undefined) updateData.name = input.name;
    if (input.isActive !== undefined) updateData.isActive = input.isActive;

    const branch = await databases.updateDocument(
      DATABASE_ID,
      COLLECTIONS.BRANCHES,
      branchId,
      updateData
    );

    return branch as unknown as Branch;
  } catch (error: any) {
    if (error.message === 'A branch with this name already exists') {
      throw error;
    }
    console.error('Error updating branch:', error);
    throw new Error(error.message || 'Failed to update branch');
  }
}

/**
 * Delete a branch
 *
 * Prevents deletion if the branch has assigned managers or active leads.
 *
 * @param branchId - The branch ID
 */
export async function deleteBranch(branchId: string): Promise<void> {
  try {
    // Check for assigned managers
    const managers = await databases.listDocuments(
      DATABASE_ID,
      COLLECTIONS.USERS,
      [
        Query.equal('role', 'manager'),
        Query.equal('branchId', branchId),
      ]
    );

    if (managers.total > 0) {
      throw new Error('Cannot delete branch with assigned managers');
    }

    // Check for active leads
    const leads = await databases.listDocuments(
      DATABASE_ID,
      COLLECTIONS.LEADS,
      [
        Query.equal('branchId', branchId),
        Query.equal('isClosed', false),
      ]
    );

    if (leads.total > 0) {
      throw new Error('Cannot delete branch with active leads');
    }

    await databases.deleteDocument(DATABASE_ID, COLLECTIONS.BRANCHES, branchId);
  } catch (error: any) {
    if (
      error.message === 'Cannot delete branch with assigned managers' ||
      error.message === 'Cannot delete branch with active leads'
    ) {
      throw error;
    }
    console.error('Error deleting branch:', error);
    throw new Error(error.message || 'Failed to delete branch');
  }
}

/**
 * List all branches
 *
 * @returns Array of all branches
 */
export async function listBranches(): Promise<Branch[]> {
  try {
    const response = await databases.listDocuments(
      DATABASE_ID,
      COLLECTIONS.BRANCHES,
      [Query.orderDesc('$createdAt')]
    );
    return response.documents as unknown as Branch[];
  } catch (error: any) {
    console.error('Error listing branches:', error);
    throw new Error(error.message || 'Failed to list branches');
  }
}

/**
 * Get stats for a branch (manager count and lead count)
 *
 * @param branchId - The branch ID
 * @returns Object with managerCount and leadCount
 */
export async function getBranchStats(branchId: string): Promise<{ managerCount: number; leadCount: number }> {
  try {
    const [managers, leads] = await Promise.all([
      databases.listDocuments(
        DATABASE_ID,
        COLLECTIONS.USERS,
        [
          Query.equal('role', 'manager'),
          Query.equal('branchId', branchId),
        ]
      ),
      databases.listDocuments(
        DATABASE_ID,
        COLLECTIONS.LEADS,
        [Query.equal('branchId', branchId)]
      ),
    ]);

    return {
      managerCount: managers.total,
      leadCount: leads.total,
    };
  } catch (error: any) {
    console.error('Error fetching branch stats:', error);
    throw new Error(error.message || 'Failed to fetch branch stats');
  }
}
