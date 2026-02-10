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
    return await account.get();
  } catch (error) {
    return null;
  }
}

async function getUserDoc(userId: string) {
    const { databases } = await createAdminClient();
    try {
        return await databases.getDocument(DATABASE_ID, USERS_COLLECTION_ID, userId);
    } catch {
        return null;
    }
}

export async function createManagerAction(input: CreateManagerInput) {
    const currentUser = await getCurrentUser();
    if (!currentUser) throw new Error("Unauthorized");
    
    const callerDoc = await getUserDoc(currentUser.$id);
    if (!callerDoc || callerDoc.role !== 'admin') {
        throw new Error("Permission denied: Only admins can create managers");
    }

    const { name, email, password, branchIds } = input;
    const { users, databases } = await createAdminClient();
    const userId = ID.unique();

    // 1. Create Auth User
    try {
        // users.create(userId, email, phone, password, name)
        await users.create(userId, email, undefined, password, name);
    } catch (e: any) {
        if (e.code === 409) throw new Error("A user with this email already exists");
        throw e;
    }

    // 2. Create DB Document
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
                 // Admin can read via Collection permissions
            ]
        );
        
        return { success: true };
    } catch (error: any) {
        console.error("DB Creation failed, rolling back Auth User", error);
        await users.delete(userId);
        throw new Error("Failed to create user profile: " + error.message);
    }
}

export async function createTeamLeadAction(input: CreateTeamLeadInput) {
    const currentUser = await getCurrentUser();
    if (!currentUser) throw new Error("Unauthorized");

    const callerDoc = await getUserDoc(currentUser.$id);
    if (!callerDoc || callerDoc.role !== 'manager') {
        throw new Error("Permission denied: Only managers can create team leads");
    }

    // Validate branches
    const callerBranches = (callerDoc.branchIds as string[]) || [];
    for (const bid of input.branchIds) {
        if (!callerBranches.includes(bid)) {
            throw new Error(`Branch ${bid} is not in your assigned branches`);
        }
    }

    const { name, email, password, branchIds } = input;
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

export async function createAgentAction(input: CreateAgentInput) {
    const currentUser = await getCurrentUser();
    if (!currentUser) throw new Error("Unauthorized");

    const callerDoc = await getUserDoc(currentUser.$id);
    if (!callerDoc || callerDoc.role !== 'team_lead') {
        throw new Error("Permission denied: Only team leads can create agents");
    }

    // Validate branches
    const callerBranches = (callerDoc.branchIds as string[]) || [];
    for (const bid of input.branchIds) {
        if (!callerBranches.includes(bid)) {
            throw new Error(`Branch ${bid} is not in your assigned branches`);
        }
    }

    const { name, email, password, branchIds } = input;
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
