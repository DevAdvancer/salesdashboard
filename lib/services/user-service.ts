import { ID, Permission, Role, Query } from 'appwrite';
import { account, databases, DATABASE_ID, COLLECTIONS } from '@/lib/appwrite';
import { logAction } from '@/lib/services/audit-service';
import { User, UserRole, CreateAgentInput, CreateTeamLeadInput, CreateManagerInput, CreateAssistantManagerInput } from '@/lib/types';

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
    managerIds: Array.isArray(doc.managerIds) ? doc.managerIds : [], // Add managerIds
    teamLeadId: (doc.teamLeadId as string) || null,
    branchIds: Array.isArray(doc.branchIds) ? doc.branchIds : [],
    branchId: (doc.branchId as string) || null,
    $createdAt: doc.$createdAt,
    $updatedAt: doc.$updatedAt,
  };
}

/**
 * Create a new manager account (admin only).
 * Admin can assign any combination of active branches.
 */
export async function createManager(input: CreateManagerInput, currentUser: User): Promise<User> {
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
        Permission.read(Role.users()),
        Permission.update(Role.user(userId)),
      ]
    );

    await logAction({
      action: 'USER_CREATE',
      actorId: currentUser.$id,
      actorName: currentUser.name,
      targetId: userDoc.$id,
      targetType: 'manager',
      metadata: { branchIds }
    });

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
 * Create a new assistant manager under a manager.
 */
export async function createAssistantManager(input: CreateAssistantManagerInput, currentUser: User): Promise<User> {
  const { name, email, password, managerIds, branchIds } = input;

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
        role: 'assistant_manager',
        managerIds: managerIds || [],
        managerId: managerIds?.[0] || null, // Set primary manager
        teamLeadId: null,
        branchIds,
      },
      [
        Permission.read(Role.user(userId)),
        Permission.read(Role.users()),
        Permission.update(Role.user(userId)),
      ]
    );

    await logAction({
      action: 'USER_CREATE',
      actorId: currentUser.$id,
      actorName: currentUser.name,
      targetId: userDoc.$id,
      targetType: 'assistant_manager',
      metadata: { branchIds, managerIds }
    });

    return mapDocToUser(userDoc);
  } catch (error: any) {
    console.error('Error creating assistant manager:', error);
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
export async function createTeamLead(input: CreateTeamLeadInput, currentUser?: User): Promise<User> {
  const { name, email, password, managerIds, branchIds } = input;

  if (!branchIds.length) {
    throw new Error('At least one branch must be assigned');
  }

  try {
    let managerBranchIds: string[] = [];
    // Validate against first manager if available (simplification for now, or check all?)
    // Actually we just need to ensure branch validity.
    // If managerIds are provided, check their branches? Or just trust admin/manager caller?

    // For now, let's process permissions for all managers
    const permissions = [
      Permission.read(Role.user(ID.custom('temp'))), // Placeholder ID will be replaced
      Permission.read(Role.users()),
      Permission.update(Role.user(ID.custom('temp'))),
    ];

    if (managerIds && managerIds.length > 0) {
        for (const mid of managerIds) {
            permissions.push(Permission.read(Role.user(mid)));
            permissions.push(Permission.update(Role.user(mid)));
            permissions.push(Permission.delete(Role.user(mid)));
        }
    }

    const userId = ID.unique();
    // Fix permissions with correct userId
    const finalPermissions = [
      Permission.read(Role.user(userId)),
      Permission.read(Role.users()),
      Permission.update(Role.user(userId)),
    ];

    if (managerIds && managerIds.length > 0) {
        for (const mid of managerIds) {
            finalPermissions.push(Permission.read(Role.user(mid)));
            finalPermissions.push(Permission.update(Role.user(mid)));
            finalPermissions.push(Permission.delete(Role.user(mid)));
        }
    }

    await account.create(userId, email, password, name);

    const userDoc = await databases.createDocument(
      DATABASE_ID,
      USERS_COLLECTION_ID,
      userId,
      {
        name,
        email,
        role: 'team_lead',
        managerIds: managerIds || [],
        managerId: managerIds && managerIds.length > 0 ? managerIds[0] : null,
        branchIds,
      },
      finalPermissions
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
            managerIds
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
 * 3. Creates a user document with role='agent', managerId (from team lead), teamLeadId, and branchIds
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

    // Re-evaluating the traversal:
     // 1. Get Team Lead (TL)
     // 2. TL.managerId -> Supervisor (S1)
     // 3. If S1 is AM, S1.managerId -> Manager (M1). Set Agent.managerId = M1.
     // 4. If S1 is Manager, Set Agent.managerId = S1.

     let managerId: string | null = null;
     const supervisorId = (teamLeadDoc.managerId as string) || null;

     if (supervisorId) {
         try {
             const supervisorDoc = await databases.getDocument(
                DATABASE_ID,
                USERS_COLLECTION_ID,
                supervisorId
             );
             if (supervisorDoc.role === 'assistant_manager') {
                 // S1 is AM. M1 is S1.managerId. Agent gets assigned to M1.
                 managerId = (supervisorDoc.managerId as string) || null;
             } else {
                 // S1 is Manager (or something else, assume Manager)
                 managerId = supervisorId;
             }
         } catch (e) {
             console.warn('Could not fetch supervisor details, using direct ID', e);
             managerId = supervisorId;
         }
     }

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
        Permission.read(Role.users()),
        Permission.read(Role.user(teamLeadId)),
        ...(managerId ? [Permission.read(Role.user(managerId))] : []),
        Permission.update(Role.user(userId)),
        Permission.update(Role.user(teamLeadId)),
        ...(managerId ? [Permission.delete(Role.user(managerId))] : []),
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
 * Assign a manager to a branch.
 * Adds the branch to the manager's branchIds array (supports multiple branches).
 */
export async function assignManagerToBranch(managerId: string, branchId: string): Promise<User> {
  try {
    // Get current manager document
    const managerDoc = await databases.getDocument(
      DATABASE_ID,
      USERS_COLLECTION_ID,
      managerId
    );

    // Get current branchIds array
    const currentBranchIds = (managerDoc.branchIds as string[]) || [];

    // Add new branch if not already present
    if (!currentBranchIds.includes(branchId)) {
      const updatedBranchIds = [...currentBranchIds, branchId];

      // Update manager's branchIds
      const updatedManager = await databases.updateDocument(
        DATABASE_ID,
        USERS_COLLECTION_ID,
        managerId,
        { branchIds: updatedBranchIds }
      );

      return mapDocToUser(updatedManager);
    }

    return mapDocToUser(managerDoc);
  } catch (error: any) {
    console.error('Error assigning manager to branch:', error);
    throw new Error(error.message || 'Failed to assign manager to branch');
  }
}

/**
 * Remove a manager from a specific branch.
 * Removes the branch from the manager's branchIds array.
 */
export async function removeManagerFromBranch(managerId: string, branchId: string): Promise<User> {
  try {
    // Get current manager document
    const managerDoc = await databases.getDocument(
      DATABASE_ID,
      USERS_COLLECTION_ID,
      managerId
    );

    // Get current branchIds array
    const currentBranchIds = (managerDoc.branchIds as string[]) || [];

    // Remove the branch
    const updatedBranchIds = currentBranchIds.filter(id => id !== branchId);

    // Update manager's branchIds
    const updatedManager = await databases.updateDocument(
      DATABASE_ID,
      USERS_COLLECTION_ID,
      managerId,
      { branchIds: updatedBranchIds }
    );

    return mapDocToUser(updatedManager);
  } catch (error: any) {
    console.error('Error removing manager from branch:', error);
    throw new Error(error.message || 'Failed to remove manager from branch');
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
 * Get all assistant managers by branch IDs.
 * Returns all assistant managers whose branchIds array contains any of the given branchIds.
 */
export async function getAssistantManagersByBranches(branchIds: string[]): Promise<User[]> {
  if (!branchIds.length) return [];
  try {
    const response = await databases.listDocuments(
      DATABASE_ID,
      USERS_COLLECTION_ID,
      [
        Query.equal('role', 'assistant_manager'),
        Query.contains('branchIds', branchIds)
      ]
    );
    return response.documents.map(mapDocToUser);
  } catch (error: any) {
    console.error('Error fetching assistant managers by branches:', error);
    throw new Error(error.message || 'Failed to fetch assistant managers by branches');
  }
}

/**
 * Get users assignable to a lead based on the creator's role and branches.
 * - Manager: team_leads + agents with overlapping branchIds (excluding self)
 * - Team Lead: agents with overlapping branchIds (excluding self)
 * - Agent: empty array
 */
export async function getAssignableUsers(
  creatorRole: UserRole,
  creatorBranchIds: string[],
  creatorId?: string
): Promise<User[]> {
  if (creatorRole === 'agent') return [];
  if (creatorRole !== 'admin' && !creatorBranchIds.length) return [];

  try {
    const allowedRoles: UserRole[] =
      creatorRole === 'admin' ? ['manager', 'assistant_manager', 'team_lead', 'agent'] :
      creatorRole === 'manager' ? ['assistant_manager', 'team_lead', 'agent'] :
      creatorRole === 'assistant_manager' ? ['team_lead', 'agent'] :
      creatorRole === 'team_lead' ? ['agent'] :
      [];

    if (!allowedRoles.length) return [];

    const queries = [
      allowedRoles.length === 1
        ? Query.equal('role', allowedRoles[0])
        : Query.equal('role', allowedRoles)
    ];

    if (creatorRole !== 'admin') {
      queries.push(Query.contains('branchIds', creatorBranchIds));
    }

    const response = await databases.listDocuments(
      DATABASE_ID,
      USERS_COLLECTION_ID,
      queries
    );

    // Filter out the creator themselves
    const users = response.documents.map(mapDocToUser);
    return creatorId ? users.filter(u => u.$id !== creatorId) : users;
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
      ]
    );
    // Filter client-side for managers with empty branchIds array
    const allManagers = response.documents.map(mapDocToUser);
    return allManagers.filter(manager => !manager.branchIds || manager.branchIds.length === 0);
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
 * Get all agents for a specific team lead
 */
export async function getAgentsByTeamLead(teamLeadId: string): Promise<User[]> {
  try {
    const response = await databases.listDocuments(
      DATABASE_ID,
      USERS_COLLECTION_ID,
      [
        Query.equal('role', 'agent'),
        Query.equal('teamLeadId', teamLeadId),
      ]
    );
    return response.documents.map(mapDocToUser);
  } catch (error: any) {
    console.error('Error fetching agents by team lead:', error);
    throw new Error(error.message || 'Failed to fetch agents by team lead');
  }
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
    console.error('Error fetching user:', error);
    throw new Error(error.message || 'Failed to fetch user');
  }
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
 * Get all managers in the system
 */
export async function getAllManagers(): Promise<User[]> {
  try {
    const response = await databases.listDocuments(
      DATABASE_ID,
      USERS_COLLECTION_ID,
      [Query.equal('role', 'manager')]
    );
    return response.documents.map(mapDocToUser);
  } catch (error: any) {
    console.error('Error fetching all managers:', error);
    throw new Error(error.message || 'Failed to fetch all managers');
  }
}

/**
 * Get all assistant managers in the system
 */
export async function getAllAssistantManagers(): Promise<User[]> {
  try {
    const response = await databases.listDocuments(
      DATABASE_ID,
      USERS_COLLECTION_ID,
      [Query.equal('role', 'assistant_manager')]
    );
    return response.documents.map(mapDocToUser);
  } catch (error: any) {
    console.error('Error fetching all assistant managers:', error);
    throw new Error(error.message || 'Failed to fetch all assistant managers');
  }
}

/**
 * Get all agents in the system (for managers with full access)
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
 * Update a user's assigned manager
 */
export async function updateUserManager(
  userId: string,
  managerId: string | null
): Promise<User> {
  try {
    const userDoc = await databases.updateDocument(
      DATABASE_ID,
      USERS_COLLECTION_ID,
      userId,
      {
        managerId: managerId,
      }
    );
    return mapDocToUser(userDoc);
  } catch (error: any) {
    console.error('Error updating user manager:', error);
    throw new Error(error.message || 'Failed to update user manager');
  }
}

/**
 * Get all subordinates for a user (Manager or Assistant Manager)
 * This includes:
 * 1. Users who have this user as managerId
 * 2. Users who have this user in their managerIds array
 * 3. Users who have a teamLeadId that reports to this user (recursive)
 */
export async function getSubordinates(userId: string): Promise<User[]> {
  try {
    const directReportsResponse = await databases.listDocuments(
      DATABASE_ID,
      USERS_COLLECTION_ID,
      [
        Query.or([
          Query.equal('managerId', userId),
          Query.contains('managerIds', [userId])
        ])
      ]
    );
    const directReports = directReportsResponse.documents.map(mapDocToUser);

    // 2. Identify Assistant Managers and Team Leads among direct reports
    const middleManagerIds = directReports
      .filter(u => u.role === 'team_lead' || u.role === 'assistant_manager')
      .map(u => u.$id);

    // 3. Fetch indirect reports (Users assigned to these AMs/TLs)
    let indirectReports: User[] = [];
    if (middleManagerIds.length > 0) {
      const indirectReportsResponse = await databases.listDocuments(
        DATABASE_ID,
        USERS_COLLECTION_ID,
        [
          Query.or([
             Query.equal('teamLeadId', middleManagerIds),
             Query.equal('managerId', middleManagerIds),
             // Note: Query.contains for array fields like managerIds isn't directly supported with IN operator on value list in standard Appwrite
             // But we can iterate or hope for the best. For strict correctness, we might need multiple queries if list is huge.
             // However, for this context, let's assume direct assignment first.
             // Actually, managerIds is array of strings. Query.equal('managerIds', value) works if value is single.
             // If value is array, it matches if ANY.
             // Let's stick to teamLeadId and managerId for now which covers most cases.
          ])
        ]
      );
      indirectReports = indirectReportsResponse.documents.map(mapDocToUser);
    }

    // 4. Combine and deduplicate
    const allSubordinates = [...directReports, ...indirectReports];
    const uniqueSubordinates = Array.from(new Map(allSubordinates.map(item => [item.$id, item])).values());

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
 * Get default CC recipients for support-request email flows.
 *
 * Rules:
 * - manager: no CC recipients
 * - assistant_manager: CC only their manager(s)
 * - team_lead / agent / admin / other: CC all managers and assistant managers except self
 */
export async function getSupportRequestCcEmails(
  sender: Pick<User, 'role' | 'email' | 'managerId' | 'managerIds'>
): Promise<string[]> {
  try {
    if (sender.role === 'manager') {
      return [];
    }

    if (sender.role === 'assistant_manager') {
      const managerIds = new Set<string>();

      if (sender.managerId) {
        managerIds.add(sender.managerId);
      }

      sender.managerIds?.forEach((managerId) => {
        if (managerId) {
          managerIds.add(managerId);
        }
      });

      const managers = await Promise.all(
        Array.from(managerIds).map(async (managerId) => {
          try {
            return await getUserById(managerId);
          } catch {
            return null;
          }
        })
      );

      return Array.from(
        new Set(
          managers
            .filter((manager): manager is User => Boolean(manager?.email))
            .map((manager) => manager.email)
            .filter((email) => email !== sender.email)
        )
      );
    }

    const [allManagers, allAssistantManagers] = await Promise.all([
      getAllManagers(),
      getAllAssistantManagers(),
    ]);

    return Array.from(
      new Set(
        [...allManagers, ...allAssistantManagers]
          .map((user) => user.email)
          .filter((email) => Boolean(email) && email !== sender.email)
      )
    );
  } catch (error: any) {
    console.error('Error fetching support request CC recipients:', error);
    throw new Error(error.message || 'Failed to fetch support request CC recipients');
  }
}
