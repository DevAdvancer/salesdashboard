import { Query } from 'appwrite';
import { databases, DATABASE_ID, COLLECTIONS } from '@/lib/appwrite';
import { Branch, CreateBranchInput, UpdateBranchInput } from '@/lib/types';
import { cached, clearCache } from '@/lib/utils/resource-cache';

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

    invalidateBranchesCache();
    return branch as unknown as Branch;
  } catch (error: any) {
    if (error.message === 'A branch with this name already exists') {
      throw error;
    }
    console.error('Error creating branch:', error);
    throw new Error(error.message || 'Failed to create branch');
  }
}

export async function getBranchById(branchId: string): Promise<Branch> {
  return getBranch(branchId);
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
    const code = typeof error?.code === 'number' ? error.code : null;
    const message = typeof error?.message === 'string' ? error.message : String(error);
    const normalizedMessage = message.toLowerCase();

    if (code === 404 || normalizedMessage.includes('could not be found') || normalizedMessage.includes('not found')) {
      throw new Error(`Branch not found: ${branchId}`);
    }

    console.error('Error fetching branch:', error);
    throw new Error(message || 'Failed to fetch branch');
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

    invalidateBranchesCache();
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
 * Prevents deletion if the branch has assigned users or active leads.
 *
 * @param branchId - The branch ID
 */
export async function deleteBranch(branchId: string): Promise<void> {
  try {
    // Check for assigned team leads
    // Users use `branchIds` (array attribute) — see scripts/sync-appwrite-schema.ts
    const teamLeads = await databases.listDocuments(
      DATABASE_ID,
      COLLECTIONS.USERS,
      [
        Query.equal('role', 'team_lead'),
        Query.contains('branchIds', [branchId]),
      ]
    );

    if (teamLeads.total > 0) {
      throw new Error('Cannot delete branch with assigned team leads');
    }

    // Leads use `branchId` (singular string attribute) — see scripts/sync-appwrite-schema.ts
    // Do NOT query `branchIds` here: that field does not exist on the leads collection
    // and Appwrite would silently return 0 results, letting you delete a branch that
    // still owns active leads.
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
    invalidateBranchesCache();
  } catch (error: any) {
    if (
      error.message === 'Cannot delete branch with assigned team leads' ||
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
  return cached('branches:all', 5 * 60 * 1000, async () => {
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
  });
}

/**
 * Invalidate the cached branches list. Call this after create/update/delete
 * so the changes appear on the next fetch.
 */
export function invalidateBranchesCache(): void {
  clearCache('branches:');
}

/**
 * Get stats for a branch (lead count)
 *
 * @param branchId - The branch ID
 * @returns Object with leadCount
 */
export async function getBranchStats(branchId: string): Promise<{ leadCount: number }> {
  try {
    // Leads use `branchId` (singular string attribute) — see scripts/sync-appwrite-schema.ts
    // Do NOT query `branchIds` here: that field does not exist on the leads collection,
    // and Appwrite would silently return 0, making the lead count column always read 0.
    const [leads] = await Promise.all([
      databases.listDocuments(
        DATABASE_ID,
        COLLECTIONS.LEADS,
        [Query.equal('branchId', branchId)]
      ),
    ]);

    return {
      leadCount: leads.total,
    };
  } catch (error: any) {
    console.error('Error fetching branch stats:', error);
    throw new Error(error.message || 'Failed to fetch branch stats');
  }
}
