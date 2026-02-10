import { ID, Permission, Role, Query } from 'appwrite';
import { account, databases, DATABASE_ID, COLLECTIONS } from '@/lib/appwrite';
import { User, UserRole, CreateAgentInput, CreateTeamLeadInput, CreateManagerInput } from '@/lib/types';

const USERS_COLLECTION_ID = process.env.NEXT_PUBLIC_APPWRITE_USERS_COLLECTION_ID!;

/**
 * Map an Appwrite document to a User object
 */
function mapDocToUser(doc: any): User {
  return {
    $id: doc.$id,
    name: doc.name as string,
    email: doc.email as string,
    role: doc.role as UserRole,
    managerId: (doc.managerId as string) || null,
    teamLeadId: (doc.teamLeadId as string) || null,
    branchIds: Array.isArray(doc.branchIds) ? doc.branchIds : [],
    branchId: (doc.branchId as string) || null,
    $createdAt: doc.$createdAt,
    $updatedAt: doc.$updatedAt,
  };
}

/**
 * Create a new team lead account
 *
/**
 * Create a new manager account (admin only).
 * Admin can assign any combination of active branches.
 */
export async function createManager(input: CreateManagerInput): Promise<User> {
  const { name, email, password, branchIds } = input;

  if (!branchIds.length) {
    throw new Error('At least one branch must be assigned');
  }

  try {
    const userId = ID.unique();
    await account.create(userId, email, password, name);

    const userDoc = await databases.createDocument(
      DATABASE_ID,
      USERS_COLLECTION_ID,
      userId,
      {
        name,
        email,
        role: 'manager',
        managerId: null,
        teamLeadId: null,
        branchIds,
      },
      [
        Permission.read(Role.user(userId)),
        Permission.update(Role.user(userId)),
      ]
    );

    return mapDocToUser(userDoc);
  } catch (error: any) {
    console.error('Error creating manager:', error);
    if (error.code === 409 || error.message?.includes('already exists')) {
      throw new Error('A user with this email already exists');
    }
    throw error;
  }
}

/**
 * Create a new team lead under a manager.
 * This function:
 * 1. Fetches the manager and validates branchIds ⊆ manager.branchIds
 * 2. Creates an Appwrite Auth account
 * 3. Creates a user document with role='team_lead', managerId, and branchIds
 */
export async function createTeamLead(input: CreateTeamLeadInput): Promise<User> {
  const { name, email, password, managerId, branchIds } = input;

  if (!branchIds.length) {
    throw new Error('At least one branch must be assigned');
  }

  try {
    const managerDoc = await databases.getDocument(
      DATABASE_ID,
      USERS_COLLECTION_ID,
      managerId
    );
    const managerBranchIds: string[] = Array.isArray(managerDoc.branchIds) ? managerDoc.branchIds : [];

    // Validate branchIds ⊆ manager.branchIds
    for (const bid of branchIds) {
      if (!managerBranchIds.includes(bid)) {
        throw new Error(`Branch ${bid} is not in your assigned branches`);
      }
    }

    const userId = ID.unique();
    await account.create(userId, email, password, name);

    const userDoc = await databases.createDocument(
      DATABASE_ID,
      USERS_COLLECTION_ID,
      userId,
      {
        name,
        email,
        role: 'team_lead',
        managerId,
        branchIds,
      },
      [
        Permission.read(Role.user(userId)),
        Permission.read(Role.user(managerId)),
        Permission.update(Role.user(userId)),
        Permission.update(Role.user(managerId)),
        Permission.delete(Role.user(managerId)),
      ]
    );

    return mapDocToUser(userDoc);
  } catch (error: any) {
    console.error('Error creating team lead:', error);
    if (error.code === 409 || error.message?.includes('already exists')) {
      throw new Error('A user with this email already exists');
    }
    throw error;
  }
}

/**
 * Create a new agent account
 *
 * This function:
 * 1. Fetches the team lead and validates branchIds ⊆ teamLead.branchIds
 * 2. Creates an Appwrite Auth account
 * 3. Creates a user document with role='agent', managerId (from team lead), teamLeadId, and branchIds
 */
export async function createAgent(input: CreateAgentInput): Promise<User> {
  const { name, email, password, teamLeadId, branchIds } = input;

  if (!branchIds.length) {
    throw new Error('At least one branch must be assigned');
  }

  try {
    const teamLeadDoc = await databases.getDocument(
      DATABASE_ID,
      USERS_COLLECTION_ID,
      teamLeadId
    );
    const teamLeadBranchIds: string[] = Array.isArray(teamLeadDoc.branchIds) ? teamLeadDoc.branchIds : [];
    const managerId = (teamLeadDoc.managerId as string) || null;

    // Validate branchIds ⊆ teamLead.branchIds
    for (const bid of branchIds) {
      if (!teamLeadBranchIds.includes(bid)) {
        throw new Error(`Branch ${bid} is not in your assigned branches`);
      }
    }

    const userId = ID.unique();
    await account.create(userId, email, password, name);

    const userDoc = await databases.createDocument(
      DATABASE_ID,
      USERS_COLLECTION_ID,
      userId,
      {
        name,
        email,
        role: 'agent',
        managerId,
        teamLeadId,
        branchIds,
      },
      [
        Permission.read(Role.user(userId)),
        Permission.read(Role.user(teamLeadId)),
        ...(managerId ? [Permission.read(Role.user(managerId))] : []),
        Permission.update(Role.user(userId)),
        Permission.update(Role.user(teamLeadId)),
        ...(managerId ? [Permission.delete(Role.user(managerId))] : []),
      ]
    );

    return mapDocToUser(userDoc);
  } catch (error: any) {
    console.error('Error creating agent:', error);
    if (error.code === 409 || error.message?.includes('already exists')) {
      throw new Error('A user with this email already exists');
    }
    throw error;
  }
}

/**
 * Assign a manager to a branch.
 * Updates the manager's branchId and cascades to all linked agents.
 */
export async function assignManagerToBranch(managerId: string, branchId: string): Promise<User> {
  try {
    // Update manager's branchId
    const managerDoc = await databases.updateDocument(
      DATABASE_ID,
      USERS_COLLECTION_ID,
      managerId,
      { branchId }
    );

    // Cascade: update all agents linked to this manager
    const agents = await databases.listDocuments(
      DATABASE_ID,
      USERS_COLLECTION_ID,
      [
        Query.equal('role', 'agent'),
        Query.equal('managerId', managerId),
      ]
    );

    await Promise.all(
      agents.documents.map(agent =>
        databases.updateDocument(
          DATABASE_ID,
          USERS_COLLECTION_ID,
          agent.$id,
          { branchId }
        )
      )
    );

    return mapDocToUser(managerDoc);
  } catch (error: any) {
    console.error('Error assigning manager to branch:', error);
    throw new Error(error.message || 'Failed to assign manager to branch');
  }
}

/**
 * Remove a manager from their branch.
 * Clears branchId for the manager and all linked agents.
 */
export async function removeManagerFromBranch(managerId: string): Promise<User> {
  try {
    // Clear manager's branchId
    const managerDoc = await databases.updateDocument(
      DATABASE_ID,
      USERS_COLLECTION_ID,
      managerId,
      { branchId: null }
    );

    // Cascade: clear branchId for all agents linked to this manager
    const agents = await databases.listDocuments(
      DATABASE_ID,
      USERS_COLLECTION_ID,
      [
        Query.equal('role', 'agent'),
        Query.equal('managerId', managerId),
      ]
    );

    await Promise.all(
      agents.documents.map(agent =>
        databases.updateDocument(
          DATABASE_ID,
          USERS_COLLECTION_ID,
          agent.$id,
          { branchId: null }
        )
      )
    );

    return mapDocToUser(managerDoc);
  } catch (error: any) {
    console.error('Error removing manager from branch:', error);
    throw new Error(error.message || 'Failed to remove manager from branch');
  }
}

/**
 * Get all users assigned to a specific branch (queries branchIds array)
 */
export async function getUsersByBranch(branchId: string): Promise<User[]> {
  try {
    const response = await databases.listDocuments(
      DATABASE_ID,
      USERS_COLLECTION_ID,
      [Query.contains('branchIds', [branchId])]
    );
    return response.documents.map(mapDocToUser);
  } catch (error: any) {
    console.error('Error fetching users by branch:', error);
    throw new Error(error.message || 'Failed to fetch users by branch');
  }
}

/**
 * Get all users whose branchIds overlap with the given array
 */
export async function getUsersByBranches(branchIds: string[]): Promise<User[]> {
  if (!branchIds.length) return [];
  try {
    const response = await databases.listDocuments(
      DATABASE_ID,
      USERS_COLLECTION_ID,
      [Query.contains('branchIds', branchIds)]
    );
    return response.documents.map(mapDocToUser);
  } catch (error: any) {
    console.error('Error fetching users by branches:', error);
    throw new Error(error.message || 'Failed to fetch users by branches');
  }
}

/**
 * Get users assignable to a lead based on the creator's role and branches.
 * - Manager: team_leads + agents with overlapping branchIds
 * - Team Lead: agents with overlapping branchIds
 * - Agent: empty array
 */
export async function getAssignableUsers(
  creatorRole: UserRole,
  creatorBranchIds: string[]
): Promise<User[]> {
  if (creatorRole === 'agent' || !creatorBranchIds.length) return [];

  try {
    const allowedRoles: UserRole[] =
      creatorRole === 'manager' ? ['team_lead', 'agent'] :
      creatorRole === 'team_lead' ? ['agent'] :
      [];

    if (!allowedRoles.length) return [];

    const response = await databases.listDocuments(
      DATABASE_ID,
      USERS_COLLECTION_ID,
      [
        Query.contains('branchIds', creatorBranchIds),
        ...(allowedRoles.length === 1
          ? [Query.equal('role', allowedRoles[0])]
          : [Query.equal('role', allowedRoles)]),
      ]
    );
    return response.documents.map(mapDocToUser);
  } catch (error: any) {
    console.error('Error fetching assignable users:', error);
    throw new Error(error.message || 'Failed to fetch assignable users');
  }
}

/**
 * Get all managers that are not assigned to any branch
 */
export async function getUnassignedManagers(): Promise<User[]> {
  try {
    const response = await databases.listDocuments(
      DATABASE_ID,
      USERS_COLLECTION_ID,
      [
        Query.equal('role', 'manager'),
        Query.isNull('branchId'),
      ]
    );
    return response.documents.map(mapDocToUser);
  } catch (error: any) {
    console.error('Error fetching unassigned managers:', error);
    throw new Error(error.message || 'Failed to fetch unassigned managers');
  }
}

/**
 * Get all agents for a specific manager (includes branchId)
 */
export async function getAgentsByManager(managerId: string): Promise<User[]> {
  try {
    const response = await databases.listDocuments(
      DATABASE_ID,
      USERS_COLLECTION_ID,
      [
        Query.equal('role', 'agent'),
        Query.equal('managerId', managerId),
      ]
    );
    return response.documents.map(mapDocToUser);
  } catch (error: any) {
    console.error('Error fetching agents:', error);
    throw new Error(error.message || 'Failed to fetch agents');
  }
}

/**
 * Get a user by ID
 */
export async function getUserById(userId: string): Promise<User> {
  try {
    const userDoc = await databases.getDocument(
      DATABASE_ID,
      USERS_COLLECTION_ID,
      userId
    );
    return mapDocToUser(userDoc);
  } catch (error: any) {
    console.error('Error fetching user:', error);
    throw new Error(error.message || 'Failed to fetch user');
  }
}

/**
 * Update a user's information
 */
export async function updateUser(
  userId: string,
  data: Partial<Pick<User, 'name' | 'email'>>
): Promise<User> {
  try {
    const userDoc = await databases.updateDocument(
      DATABASE_ID,
      USERS_COLLECTION_ID,
      userId,
      data
    );
    return mapDocToUser(userDoc);
  } catch (error: any) {
    console.error('Error updating user:', error);
    throw new Error(error.message || 'Failed to update user');
  }
}

/**
 * Delete an agent account
 * Note: This only deletes the user document, not the Appwrite Auth account
 */
export async function deleteAgent(agentId: string): Promise<void> {
  try {
    await databases.deleteDocument(
      DATABASE_ID,
      USERS_COLLECTION_ID,
      agentId
    );
  } catch (error: any) {
    console.error('Error deleting agent:', error);
    throw new Error(error.message || 'Failed to delete agent');
  }
}
