'use server';

import { ID, Permission, Role } from 'node-appwrite';
import { createAdminClient, createSessionClient } from '@/lib/server/appwrite';
import { CreateManagerInput, CreateTeamLeadInput, CreateAgentInput, UserRole } from '@/lib/types';

// Constants
const DATABASE_ID = process.env.NEXT_PUBLIC_APPWRITE_DATABASE_ID!;
const USERS_COLLECTION_ID = process.env.NEXT_PUBLIC_APPWRITE_USERS_COLLECTION_ID!;

async function getCurrentUser() {
  try {
    const { account } = await createSessionClient();
    const user = await account.get();
    return user;
  } catch (error: any) {
    console.error('getCurrentUser error:', error?.message || error);
    console.error('Error type:', error?.type);
    console.error('Error code:', error?.code);
    return null;
  }
}

async function getUserDoc(userId: string) {
    const { databases } = await createAdminClient();
    try {
        const doc = await databases.getDocument(DATABASE_ID, USERS_COLLECTION_ID, userId);
        return doc;
    } catch (error) {
        console.error('getUserDoc error for userId:', userId, error);
        return null;
    }
}

export async function createManagerAction(input: CreateManagerInput & { currentUserId: string }) {
    const { currentUserId, ...managerInput } = input;
    
    if (!currentUserId) {
        console.error("createManagerAction: No currentUserId provided");
        throw new Error("Unauthorized - No user ID provided");
    }

    console.log("createManagerAction: Current user ID:", currentUserId);

    const callerDoc = await getUserDoc(currentUserId);
    if (!callerDoc) {
        console.error("createManagerAction: User document not found for ID:", currentUserId);
        throw new Error("User profile not found");
    }
    
    console.log("createManagerAction: Caller role:", callerDoc.role);
    
    // Allow both admin and manager roles to create managers
    // This enables manager-to-manager creation until proper admin bootstrap is in place
    if (callerDoc.role !== 'admin' && callerDoc.role !== 'manager') {
        console.error("createManagerAction: Insufficient permissions. Role:", callerDoc.role);
        throw new Error("Permission denied: Only admins and managers can create managers");
    }

    const { name, email, password, branchIds } = managerInput;
    const { users, databases } = await createAdminClient();
    const userId = ID.unique();

    // Validate branch existence (admin can assign any branches, but they must exist)
    const BRANCHES_COLLECTION_ID = process.env.NEXT_PUBLIC_APPWRITE_BRANCHES_COLLECTION_ID!;
    for (const branchId of branchIds) {
        try {
            await databases.getDocument(DATABASE_ID, BRANCHES_COLLECTION_ID, branchId);
        } catch (error) {
            throw new Error(`Branch ${branchId} does not exist`);
        }
    }

    try {
        await users.create(userId, email, undefined, password, name);
    } catch (e: any) {
        if (e.code === 409) throw new Error("A user with this email already exists");
        throw e;
    }

    try {
        await databases.createDocument(
            DATABASE_ID,
            USERS_COLLECTION_ID,
            userId,
            {
                name,
                email,
                role: 'manager',
                managerId: null,
                teamLeadId: null,
                branchIds
            },
            [
                 Permission.read(Role.user(userId)),
                 Permission.update(Role.user(userId)),
            ]
        );
        return { success: true };
    } catch (error: any) {
        console.error("DB Creation failed, rolling back Auth User", error);
        await users.delete(userId);
        throw new Error("Failed to create user profile: " + error.message);
    }
}

export async function createTeamLeadAction(input: CreateTeamLeadInput & { currentUserId: string }) {
    const { currentUserId, ...teamLeadInput } = input;
    
    if (!currentUserId) throw new Error("Unauthorized - No user ID provided");

    const callerDoc = await getUserDoc(currentUserId);
    if (!callerDoc || callerDoc.role !== 'manager') {
        throw new Error("Permission denied: Only managers can create team leads");
    }

    // Validate branches
    const callerBranches = (callerDoc.branchIds as string[]) || [];
    for (const bid of teamLeadInput.branchIds) {
        if (!callerBranches.includes(bid)) {
            throw new Error(`Branch ${bid} is not in your assigned branches`);
        }
    }

    const { name, email, password, branchIds } = teamLeadInput;
    const { users, databases } = await createAdminClient();
    const userId = ID.unique();

    try {
        await users.create(userId, email, undefined, password, name);
    } catch (e: any) {
        if (e.code === 409) throw new Error("A user with this email already exists");
        throw e;
    }

    try {
        await databases.createDocument(
            DATABASE_ID,
            USERS_COLLECTION_ID,
            userId,
            {
                name,
                email,
                role: 'team_lead',
                managerId: callerDoc.$id, // Manager ID is the caller
                teamLeadId: null,
                branchIds
            },
            [
                 Permission.read(Role.user(userId)),
                 Permission.read(Role.user(callerDoc.$id)),
                 Permission.update(Role.user(userId)),
                 Permission.update(Role.user(callerDoc.$id)),
                 Permission.delete(Role.user(callerDoc.$id)),
            ]
        );
        return { success: true };
    } catch (error: any) {
        console.error("DB Creation failed, rolling back Auth User", error);
        await users.delete(userId);
        throw new Error("Failed to create user profile: " + error.message);
    }
}

export async function createAgentAction(input: CreateAgentInput & { currentUserId: string }) {
    const { currentUserId, ...agentInput } = input;
    
    if (!currentUserId) throw new Error("Unauthorized - No user ID provided");

    const callerDoc = await getUserDoc(currentUserId);
    if (!callerDoc || callerDoc.role !== 'team_lead') {
        throw new Error("Permission denied: Only team leads can create agents");
    }

    // Validate branches
    const callerBranches = (callerDoc.branchIds as string[]) || [];
    for (const bid of agentInput.branchIds) {
        if (!callerBranches.includes(bid)) {
            throw new Error(`Branch ${bid} is not in your assigned branches`);
        }
    }

    const { name, email, password, branchIds } = agentInput;
    const { users, databases } = await createAdminClient();
    const userId = ID.unique();

    // Get manager ID from team lead
    const managerId = callerDoc.managerId || null;

    try {
        await users.create(userId, email, undefined, password, name);
    } catch (e: any) {
        if (e.code === 409) throw new Error("A user with this email already exists");
        throw e;
    }

    try {
        const permissions = [
            Permission.read(Role.user(userId)),
            Permission.read(Role.user(callerDoc.$id)),
            Permission.update(Role.user(userId)),
            Permission.update(Role.user(callerDoc.$id)),
        ];

        if (managerId) {
            permissions.push(Permission.read(Role.user(managerId)));
            permissions.push(Permission.delete(Role.user(managerId)));
        }

        await databases.createDocument(
            DATABASE_ID,
            USERS_COLLECTION_ID,
            userId,
            {
                name,
                email,
                role: 'agent',
                managerId: managerId,
                teamLeadId: callerDoc.$id,
                branchIds
            },
            permissions
        );
        return { success: true };
    } catch (error: any) {
        console.error("DB Creation failed, rolling back Auth User", error);
        await users.delete(userId);
        throw new Error("Failed to create user profile: " + error.message);
    }
}
