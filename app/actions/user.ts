'use server';

import { ID, Permission, Role } from 'node-appwrite';
import { createAdminClient, createSessionClient } from '@/lib/server/appwrite';
import { CreateManagerInput, CreateTeamLeadInput, CreateAgentInput, UserRole } from '@/lib/types';

// Constants
const DATABASE_ID = process.env.NEXT_PUBLIC_APPWRITE_DATABASE_ID!;
const USERS_COLLECTION_ID = process.env.NEXT_PUBLIC_APPWRITE_USERS_COLLECTION_ID!;
const AUDIT_LOGS_COLLECTION_ID = process.env.NEXT_PUBLIC_APPWRITE_AUDIT_LOGS_COLLECTION_ID!;

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

async function logAuditAction(
    databases: any,
    action: string,
    actorId: string,
    actorName: string,
    targetId: string | undefined,
    targetType: string,
    metadata?: any
) {
    if (!AUDIT_LOGS_COLLECTION_ID) {
        console.warn('Audit logs collection ID not set, skipping log');
        return;
    }
    try {
        await databases.createDocument(
            DATABASE_ID,
            AUDIT_LOGS_COLLECTION_ID,
            ID.unique(),
            {
                action,
                actorId,
                actorName,
                targetId,
                targetType,
                metadata: metadata ? JSON.stringify(metadata) : null,
                performedAt: new Date().toISOString(),
            },
            [
                Permission.read(Role.any()),
                Permission.update(Role.label('admin')),
                Permission.delete(Role.label('admin')),
            ]
        );
    } catch (error) {
        console.error("Failed to log audit action:", error);
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

        // Log audit
        await logAuditAction(
            databases,
            'USER_CREATE',
            callerDoc.$id,
            callerDoc.name,
            userId,
            'manager',
            { role: 'manager', email, name, branchIds }
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
    // Allow admin and manager roles to create team leads
    if (!callerDoc || (callerDoc.role !== 'manager' && callerDoc.role !== 'admin')) {
        throw new Error("Permission denied: Only managers and admins can create team leads");
    }

    // Validate branches (skip for admin)
    if (callerDoc.role !== 'admin') {
        const callerBranches = (callerDoc.branchIds as string[]) || [];
        for (const bid of teamLeadInput.branchIds) {
            if (!callerBranches.includes(bid)) {
                throw new Error(`Branch ${bid} is not in your assigned branches`);
            }
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

    // For admins, managerId is null unless specified (not supported in UI yet, so null)
    // For managers, they are the manager
    const managerId = callerDoc.role === 'manager' ? callerDoc.$id : null;

    try {
        await databases.createDocument(
            DATABASE_ID,
            USERS_COLLECTION_ID,
            userId,
            {
                name,
                email,
                role: 'team_lead',
                managerId,
                teamLeadId: null,
                branchIds
            },
            [
                 Permission.read(Role.user(userId)),
                 ...(managerId ? [Permission.read(Role.user(managerId))] : []),
                 Permission.update(Role.user(userId)),
                 ...(managerId ? [Permission.update(Role.user(managerId))] : []),
                 ...(managerId ? [Permission.delete(Role.user(managerId))] : []),
            ]
        );

        // Log audit
        await logAuditAction(
            databases,
            'USER_CREATE',
            callerDoc.$id,
            callerDoc.name,
            userId,
            'team_lead',
            { role: 'team_lead', email, name, branchIds, managerId }
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
    if (!callerDoc || (callerDoc.role !== 'team_lead' && callerDoc.role !== 'manager' && callerDoc.role !== 'admin')) {
        throw new Error("Permission denied: Only team leads, managers, or admins can create agents");
    }

    if (callerDoc.role !== 'admin') {
        const callerBranches = (callerDoc.branchIds as string[]) || [];
        for (const bid of agentInput.branchIds) {
            if (!callerBranches.includes(bid)) {
                throw new Error(`Branch ${bid} is not in your assigned branches`);
            }
        }
    }

    const { name, email, password, branchIds } = agentInput;
    const { users, databases } = await createAdminClient();
    const userId = ID.unique();

    const isTeamLead = callerDoc.role === 'team_lead';
    const isManager = callerDoc.role === 'manager';
    // For admin, we default to no hierarchy for now
    const managerId = isTeamLead ? (callerDoc.managerId || null) : (isManager ? callerDoc.$id : null);
    const teamLeadId = isTeamLead ? callerDoc.$id : (agentInput.teamLeadId || null);

    try {
        await users.create(userId, email, undefined, password, name);
    } catch (e: any) {
        if (e.code === 409) throw new Error("A user with this email already exists");
        throw e;
    }

    try {
        const permissions = [
            Permission.read(Role.user(userId)),
            ...(teamLeadId ? [Permission.read(Role.user(teamLeadId))] : []),
            ...(managerId ? [Permission.read(Role.user(managerId))] : []),
            Permission.update(Role.user(userId)),
            ...(teamLeadId ? [Permission.update(Role.user(teamLeadId))] : []),
        ];

        if (managerId) permissions.push(Permission.delete(Role.user(managerId)));

        await databases.createDocument(
            DATABASE_ID,
            USERS_COLLECTION_ID,
            userId,
            {
                name,
                email,
                role: 'agent',
                managerId,
                teamLeadId,
                branchIds
            },
            permissions
        );

        // Log audit
        await logAuditAction(
            databases,
            'USER_CREATE',
            callerDoc.$id,
            callerDoc.name,
            userId,
            'agent',
            { role: 'agent', email, name, branchIds, managerId, teamLeadId }
        );

        return { success: true };
    } catch (error: any) {
        console.error("DB Creation failed, rolling back Auth User", error);
        await users.delete(userId);
        throw new Error("Failed to create user profile: " + error.message);
    }
}
