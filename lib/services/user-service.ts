import { ID, Permission, Role, Query } from 'appwrite';
import { account, databases, DATABASE_ID, COLLECTIONS } from '@/lib/appwrite';
import { logAction } from '@/lib/services/audit-service';
import { User, UserRole, CreateAgentInput, CreateTeamLeadInput } from '@/lib/types';
import { cached, clearCache } from '@/lib/utils/resource-cache';

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
    teamLeadId: (doc.teamLeadId as string) || null,
    branchIds: Array.isArray(doc.branchIds) ? doc.branchIds : [],
    isActive: doc.isActive !== false,
    branchId: (doc.branchId as string) || null,
    $createdAt: doc.$createdAt,
    $updatedAt: doc.$updatedAt,
  };
}

/**
 * Create a new team lead.
 * This function:
 * 1. Creates an Appwrite Auth account
 * 2. Creates a user document with role='team_lead' and branchIds
 */
export async function createTeamLead(input: CreateTeamLeadInput, currentUser?: User): Promise<User> {
  const { name, email, password, branchIds } = input;

  if (!branchIds.length) {
    throw new Error('At least one branch must be assigned');
  }

  try {
    const userId = ID.unique();
    const permissions = [
      Permission.read(Role.user(userId)),
      Permission.read(Role.users()),
      Permission.update(Role.user(userId)),
    ];

    await account.create(userId, email, password, name);

    const userDoc = await databases.createDocument(
      DATABASE_ID,
      USERS_COLLECTION_ID,
      userId,
      {
        name,
        email,
        role: 'team_lead',
        teamLeadId: null,
        branchIds,
      },
      permissions
    );

    if (currentUser) {
      await logAction({
        action: 'USER_CREATE',
        actorId: currentUser.$id,
        actorName: currentUser.name,
        targetId: userDoc.$id,
        targetType: 'team_lead',
        metadata: {
            branchIds,
        }
      });
    }

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
 * 3. Creates a user document with role='agent', teamLeadId, and branchIds
 */
export async function createAgent(input: CreateAgentInput, currentUser?: User): Promise<User> {
  const { name, email, password, teamLeadId, branchIds } = input;

  if (!branchIds.length) {
    throw new Error('At least one branch must be assigned');
  }

  try {
    if (!teamLeadId) {
      throw new Error('Team lead is required');
    }
    const teamLeadDoc = await databases.getDocument(
      DATABASE_ID,
      USERS_COLLECTION_ID,
      teamLeadId
    );
    const teamLeadBranchIds: string[] = Array.isArray(teamLeadDoc.branchIds) ? teamLeadDoc.branchIds : [];

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
        teamLeadId,
        branchIds,
      },
      [
        Permission.read(Role.user(userId)),
        Permission.read(Role.users()),
        Permission.read(Role.user(teamLeadId)),
        Permission.update(Role.user(userId)),
        Permission.update(Role.user(teamLeadId)),
      ]
    );

    if (currentUser) {
      await logAction({
        action: 'USER_CREATE',
        actorId: currentUser.$id,
        actorName: currentUser.name,
        targetId: userDoc.$id,
        targetType: 'agent',
        metadata: {
            branchIds,
            teamLeadId
        }
      });
    }

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
 * Get users by branch ID.
 * Returns all users whose branchIds array contains the given branchId.
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
 * - Team Lead: agents with overlapping branchIds (excluding self)
 * - Agent: empty array
 */
export async function getAssignableUsers(
  creatorRole: UserRole,
  creatorBranchIds: string[],
  creatorId?: string
): Promise<User[]> {
  // Build a stable cache key from the args that change the result.
  // branchIds is normalized (sorted) so [{a,b}] and [{b,a}] hit the same entry.
  const cacheKey =
    `users:assignable:${creatorRole}:` +
    (creatorBranchIds || []).slice().sort().join(',') +
    ':' +
    (creatorId || '');

  return cached(cacheKey, 5 * 60 * 1000, async () => {
    if (creatorRole === 'agent' || creatorRole === 'lead_generation') return [];
    if (creatorRole !== 'admin' && creatorRole !== 'developer' && !creatorBranchIds.length) return [];

    try {
      const allowedRoles: UserRole[] =
        (creatorRole === 'admin' || creatorRole === 'developer') ? ['admin', 'developer', 'team_lead', 'agent'] :
        creatorRole === 'team_lead' ? ['agent'] :
        [];

      if (!allowedRoles.length) return [];

      const queries = [
        allowedRoles.length === 1
          ? Query.equal('role', allowedRoles[0])
          : Query.equal('role', allowedRoles)
      ];

      if (creatorRole !== 'admin' && creatorRole !== 'developer') {
        queries.push(Query.contains('branchIds', creatorBranchIds));
      }

      if (creatorRole === 'team_lead' && creatorId) {
        queries.push(Query.equal('teamLeadId', creatorId));
      }

      const response = await databases.listDocuments(
        DATABASE_ID,
        USERS_COLLECTION_ID,
        queries
      );

      // Filter out inactive users and the creator themselves
      const users = response.documents.map(mapDocToUser).filter(u => u.isActive);
      return creatorId ? users.filter(u => u.$id !== creatorId) : users;
    } catch (error: any) {
      console.error('Error fetching assignable users:', error);
      throw new Error(error.message || 'Failed to fetch assignable users');
    }
  });
}

/**
 * Get all agents for a specific team lead
 */
export async function getAgentsByTeamLead(teamLeadId: string): Promise<User[]> {
  return cached(`users:agents:${teamLeadId}`, 5 * 60 * 1000, async () => {
    try {
      const response = await databases.listDocuments(
        DATABASE_ID,
        USERS_COLLECTION_ID,
        [
          Query.equal('teamLeadId', teamLeadId),
          Query.or([Query.equal('role', 'agent'), Query.equal('role', 'lead_generation')]),
        ]
      );
      return response.documents.map(mapDocToUser);
    } catch (error: any) {
      console.error('Error fetching agents by team lead:', error);
      throw new Error(error.message || 'Failed to fetch agents by team lead');
    }
  });
}

/**
 * Invalidate every cached user-related entry. Call this from user
 * create/update/delete flows so the change shows up immediately.
 */
export function invalidateUsersCache(): void {
  clearCache('users:');
}

/**
 * Get a user by ID
 */
export async function getUserById(userId: string): Promise<User> {
  // Validate ID format before calling Appwrite
  // Appwrite ID rules: max 36 chars, a-z, A-Z, 0-9, period, hyphen, underscore. Can't start with special char.
  const validIdPattern = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,35}$/;

  if (!userId || !validIdPattern.test(userId)) {
    console.warn(`[getUserById] Skipped invalid ID: "${userId}"`);
    throw new Error(`Invalid ID format: ${userId}`);
  }

  try {
    const userDoc = await databases.getDocument(
      DATABASE_ID,
      USERS_COLLECTION_ID,
      userId
    );
    return mapDocToUser(userDoc);
  } catch (error: any) {
    const code = typeof error?.code === 'number' ? error.code : null;
    const message = typeof error?.message === 'string' ? error.message : String(error);

    if (code === 404 || message.toLowerCase().includes('could not be found') || message.toLowerCase().includes('not found')) {
      throw new Error(`User not found: ${userId}`);
    }

    console.error('Error fetching user:', error);
    throw new Error(message || 'Failed to fetch user');
  }
}

export async function getUserByIdOrNull(userId: string): Promise<User | null> {
  const validIdPattern = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,35}$/;

  if (!userId || !validIdPattern.test(userId)) {
    return null;
  }

  try {
    const userDoc = await databases.getDocument(
      DATABASE_ID,
      USERS_COLLECTION_ID,
      userId
    );
    return mapDocToUser(userDoc);
  } catch (error: any) {
    const code = typeof error?.code === 'number' ? error.code : null;
    const message = typeof error?.message === 'string' ? error.message : String(error);
    const normalizedMessage = message.toLowerCase();

    if (code === 404 || normalizedMessage.includes('could not be found') || normalizedMessage.includes('not found')) {
      return null;
    }
    throw error;
  }
}

/**
 * Bulk-fetch users by ID. Replaces N individual getDocument calls with a
 * single listDocuments using Query.equal('$id', ids).
 *
 * Appwrite's Query.equal supports an array of values for indexed attributes.
 * For a large id set, fall back to chunked parallel calls (chunkSize 100 is
 * the documented array cap for Query.equal).
 */
export async function getUsersByIds(ids: string[]): Promise<Map<string, User>> {
  const result = new Map<string, User>();
  if (!ids || ids.length === 0) return result;

  const validIdPattern = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,35}$/;
  const validIds = Array.from(new Set(ids.filter((id) => id && validIdPattern.test(id))));
  if (validIds.length === 0) return result;

  const CHUNK_SIZE = 100;
  const chunks: string[][] = [];
  for (let i = 0; i < validIds.length; i += CHUNK_SIZE) {
    chunks.push(validIds.slice(i, i + CHUNK_SIZE));
  }

  const responses = await Promise.all(
    chunks.map((chunk) =>
      databases
        .listDocuments(DATABASE_ID, USERS_COLLECTION_ID, [
          Query.equal('$id', chunk),
          Query.limit(chunk.length),
        ])
        .catch(() => ({ documents: [] as any[] }))
    )
  );

  for (const response of responses) {
    for (const doc of response.documents) {
      result.set(doc.$id, mapDocToUser(doc));
    }
  }

  return result;
}

/**
 * Get user by email address
 */
export async function getUserByEmail(email: string): Promise<User | null> {
  try {
    const response = await databases.listDocuments(
      DATABASE_ID,
      USERS_COLLECTION_ID,
      [Query.equal('email', email)]
    );

    if (response.documents.length === 0) {
      return null;
    }

    return mapDocToUser(response.documents[0]);
  } catch (error: any) {
    console.error('Error fetching user by email:', error);
    throw new Error(error.message || 'Failed to fetch user by email');
  }
}

/**
 * Get all agents in the system
 */
export async function getAllAgents(): Promise<User[]> {
  try {
    const response = await databases.listDocuments(
      DATABASE_ID,
      USERS_COLLECTION_ID,
      [Query.equal('role', 'agent')]
    );
    return response.documents.map(mapDocToUser);
  } catch (error: any) {
    console.error('Error fetching all agents:', error);
    throw new Error(error.message || 'Failed to fetch all agents');
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
 * Update a user's assigned team lead
 */
export async function updateUserTeamLead(
  agentId: string,
  teamLeadId: string | null
): Promise<User> {
  try {
    const userDoc = await databases.updateDocument(
      DATABASE_ID,
      USERS_COLLECTION_ID,
      agentId,
      {
        teamLeadId: teamLeadId,
      }
    );
    return mapDocToUser(userDoc);
  } catch (error: any) {
    console.error('Error updating user team lead:', error);
    throw new Error(error.message || 'Failed to update user team lead');
  }
}

/**
 * Remove a user from a branch (clears the branchId).
 */
export async function removeUserFromBranch(
  userId: string,
  branchId: string
): Promise<User> {
  try {
    const user = await getUserById(userId);
    if (!user) {
      throw new Error('User not found');
    }
    if (user.branchIds && user.branchIds.length > 0) {
      const updatedBranchIds = user.branchIds.filter((id) => id !== branchId);
      if (user.branchId === branchId) {
        const newPrimary = updatedBranchIds[0] || null;
        const userDoc = await databases.updateDocument(
          DATABASE_ID,
          USERS_COLLECTION_ID,
          userId,
          {
            branchId: newPrimary,
            branchIds: updatedBranchIds,
          }
        );
        return mapDocToUser(userDoc);
      }
      const userDoc = await databases.updateDocument(
        DATABASE_ID,
        USERS_COLLECTION_ID,
        userId,
        { branchIds: updatedBranchIds }
      );
      return mapDocToUser(userDoc);
    }
    if (user.branchId === branchId) {
      const userDoc = await databases.updateDocument(
        DATABASE_ID,
        USERS_COLLECTION_ID,
        userId,
        { branchId: null }
      );
      return mapDocToUser(userDoc);
    }
    return user;
  } catch (error: any) {
    console.error('Error removing user from branch:', error);
    throw new Error(error.message || 'Failed to remove user from branch');
  }
}

/**
 * Update a user's role
 */
export async function updateUserRole(
  userId: string,
  role: UserRole
): Promise<User> {
  try {
    const userDoc = await databases.updateDocument(
      DATABASE_ID,
      USERS_COLLECTION_ID,
      userId,
      {
        role: role,
      }
    );
    return mapDocToUser(userDoc);
  } catch (error: any) {
    console.error('Error updating user role:', error);
    throw new Error(error.message || 'Failed to update user role');
  }
}

/**
 * Get all subordinates for a user (recursive)
 * This includes:
 * 1. Users who have a teamLeadId that reports to this user
 * 2. Recursive: agents of team leads
 */
export async function getSubordinates(userId: string): Promise<User[]> {
  try {
    const directReportsResponse = await databases.listDocuments(
      DATABASE_ID,
      USERS_COLLECTION_ID,
      [
        Query.equal('teamLeadId', userId)
      ]
    );
    const directReports = directReportsResponse.documents.map(mapDocToUser);

    // Combine (no recursion needed since agents report directly to a team lead)
    const uniqueSubordinates = Array.from(new Map(directReports.map(item => [item.$id, item])).values());

    return uniqueSubordinates;
  } catch (error: any) {
    console.error('Error fetching subordinates:', error);
    throw new Error(error.message || 'Failed to fetch subordinates');
  }
}

/**
 * Get all team leads (optionally filtered by branchIds)
 */
export async function getTeamLeads(branchIds?: string[]): Promise<User[]> {
  try {
    const queries = [Query.equal('role', 'team_lead')];

    if (branchIds && branchIds.length > 0) {
      queries.push(Query.contains('branchIds', branchIds));
    }

    const response = await databases.listDocuments(
      DATABASE_ID,
      USERS_COLLECTION_ID,
      queries
    );
    return response.documents.map(mapDocToUser);
  } catch (error: any) {
    console.error('Error fetching team leads:', error);
    throw new Error(error.message || 'Failed to fetch team leads');
  }
}

/**
 * Get CC emails for a support request from the current user.
 * Returns the emails of the user's team lead and any other supervisors in the chain.
 */
export async function getSupportRequestCcEmails(currentUser: User): Promise<string[]> {
  try {
    const ccEmails = new Set<string>();

    // Walk up the chain to find supervisors (team leads, admins)
    let currentId: string | null = currentUser.teamLeadId;
    const visited = new Set<string>([currentUser.$id]);

    for (let depth = 0; depth < 5 && currentId; depth++) {
      if (visited.has(currentId)) break;
      visited.add(currentId);
      try {
        const supervisor = await getUserById(currentId);
        if (supervisor?.email) {
          ccEmails.add(supervisor.email);
        }
        currentId = supervisor?.teamLeadId || null;
      } catch {
        break;
      }
    }

    return Array.from(ccEmails);
  } catch (error: any) {
    console.error('Error fetching support request CC emails:', error);
    return [];
  }
}
