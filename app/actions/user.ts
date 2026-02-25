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
                 Permission.read(Role.users()),
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

    const { name, email, password, branchIds, managerIds: inputManagerIds } = teamLeadInput;
    const { users, databases } = await createAdminClient();
    const userId = ID.unique();

    try {
        await users.create(userId, email, undefined, password, name);
    } catch (e: any) {
        if (e.code === 409) throw new Error("A user with this email already exists");
        throw e;
    }

    // Determine managerIds
    let managerIds: string[] = [];
    if (callerDoc.role === 'manager') {
        managerIds = [callerDoc.$id];
    } else if (inputManagerIds && Array.isArray(inputManagerIds)) {
        managerIds = inputManagerIds;
    }

    // Generate permissions for all managers
    const managerPermissions = managerIds.flatMap(mid => [
        `read("user:${mid}")`,
        `update("user:${mid}")`,
        `delete("user:${mid}")`
    ]);

    try {
        await databases.createDocument(
            DATABASE_ID,
            USERS_COLLECTION_ID,
            userId,
            {
                name,
                email,
                role: 'team_lead',
                managerIds, // Use new array field
                managerId: managerIds[0] || null, // Keep legacy field populated with first manager or null
                teamLeadId: null,
                branchIds
            },
            [
                 `read("user:${userId}")`,
                 `read("users")`,
                 `update("user:${userId}")`,
                 ...managerPermissions
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
            { role: 'team_lead', email, name, branchIds, managerIds }
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
    // For admin, we default to no hierarchy for now unless specified
    const managerId = isTeamLead ? (callerDoc.managerId || null) : (isManager ? callerDoc.$id : (agentInput.managerId || null));
    const teamLeadId = isTeamLead ? callerDoc.$id : (agentInput.teamLeadId || null);

    try {
        await users.create(userId, email, undefined, password, name);
    } catch (e: any) {
        if (e.code === 409) throw new Error("A user with this email already exists");
        throw e;
    }

    try {
        const permissions = [
            `read("user:${userId}")`,
            `read("users")`,
            ...(teamLeadId ? [`read("user:${teamLeadId}")`] : []),
            ...(managerId ? [`read("user:${managerId}")`] : []),
            `update("user:${userId}")`,
            ...(teamLeadId ? [`update("user:${teamLeadId}")`] : []),
        ];

        if (managerId) permissions.push(`delete("user:${managerId}")`);

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

export async function updateUserAction(input: {
    userId: string;
    role?: UserRole;
    managerId?: string | null; // @deprecated
    managerIds?: string[]; // New field
    teamLeadId?: string | null;
    branchIds?: string[];
    currentUserId: string;
}) {
    const { userId, role, managerId, managerIds, teamLeadId, branchIds, currentUserId } = input;

    if (!currentUserId) throw new Error("Unauthorized");

    const callerDoc = await getUserDoc(currentUserId);
    if (!callerDoc) throw new Error("User profile not found");

    const targetUserDoc = await getUserDoc(userId);
    if (!targetUserDoc) throw new Error("Target user not found");

    const isCallerAdmin = callerDoc.role === 'admin';
    const isCallerManager = callerDoc.role === 'manager';
    const isCallerTeamLead = callerDoc.role === 'team_lead';

    // Permission Check
    if (!isCallerAdmin && !isCallerManager && !isCallerTeamLead) {
        throw new Error("Permission denied");
    }

    const { databases } = await createAdminClient();

    try {
        const updates: any = {};

        // 1. Handle Role Update
        if (role && role !== targetUserDoc.role) {
             // Admin can change any role
             if (isCallerAdmin) {
                 updates.role = role;
             }
             // Manager can promote Agent -> Team Lead or demote Team Lead -> Agent
             else if (isCallerManager) {
                 if ((targetUserDoc.role === 'agent' && role === 'team_lead') ||
                     (targetUserDoc.role === 'team_lead' && role === 'agent')) {
                     updates.role = role;
                 } else {
                     throw new Error("Managers can only promote Agents to Team Leads or demote Team Leads to Agents.");
                 }
             }
             else {
                 throw new Error("Only admins or managers can change user roles.");
             }

             // Reset hierarchy fields based on new role
             if (role === 'manager') {
                 updates.managerId = null;
                 updates.managerIds = [];
                 updates.teamLeadId = null;
             } else if (role === 'team_lead') {
                 updates.teamLeadId = null;
                 // If promoted by manager, ensure managerId is set to the caller (manager) if not explicitly set
                 if (isCallerManager && !updates.managerId && !managerId && !managerIds && !targetUserDoc.managerId) {
                     updates.managerId = currentUserId;
                     updates.managerIds = [currentUserId];
                 }
             }
        }

        // 2. Handle Manager Update
        // Support both managerId (legacy single) and managerIds (new multiple)
        let newManagerIds: string[] | undefined;

        if (managerIds !== undefined) {
            if (!isCallerAdmin && !isCallerManager) throw new Error("Permission denied to change manager");

            // Validate manager IDs existence
            if (managerIds.length > 0) {
                // We should ideally check if these users exist and are actually managers
                // But for performance in server action, we might skip or do a bulk check if critical.
                // Assuming basic existence check via getDocument if strictly needed, but let's at least ensure format.
                if (managerIds.some(id => !id || typeof id !== 'string')) {
                    throw new Error("Invalid manager ID format");
                }
            }

            newManagerIds = managerIds;
            updates.managerIds = managerIds;
            // Sync legacy field
            updates.managerId = managerIds.length > 0 ? managerIds[0] : null;
        } else if (managerId !== undefined) {
             if (!isCallerAdmin && !isCallerManager) throw new Error("Permission denied to change manager");
             // If legacy field is used, treat as single manager array
             newManagerIds = managerId ? [managerId] : [];
             updates.managerIds = newManagerIds;
             updates.managerId = managerId;
        }

        // 3. Handle Team Lead Update
        if (teamLeadId !== undefined && teamLeadId !== targetUserDoc.teamLeadId) {
             updates.teamLeadId = teamLeadId;
        }

        // 4. Handle Branch Update
        if (branchIds) {
             // Validate branches if not Admin
             if (!isCallerAdmin) {
                 const callerBranches = (callerDoc.branchIds as string[]) || [];
                 // Managers/TLs can only assign branches they have access to
                 for (const bid of branchIds) {
                     if (!callerBranches.includes(bid)) {
                         throw new Error(`Branch ${bid} is not in your assigned branches`);
                     }
                 }
             }
             updates.branchIds = branchIds;
        }

        if (Object.keys(updates).length === 0) return { success: true };

        // Calculate Permissions if hierarchy changed
        let permissions: string[] | undefined;

        // If manager or team lead changed, we need to recalculate permissions
        if (updates.managerIds || updates.managerId !== undefined || updates.teamLeadId !== undefined || updates.role) {
            const finalRole = updates.role || targetUserDoc.role;
            const finalManagerIds = updates.managerIds || targetUserDoc.managerIds || (targetUserDoc.managerId ? [targetUserDoc.managerId] : []);
            const finalTeamLeadId = updates.teamLeadId !== undefined ? updates.teamLeadId : targetUserDoc.teamLeadId;

            permissions = [
                `read("user:${userId}")`,
                `read("users")`,
                `update("user:${userId}")`
            ];

            // Add manager permissions
            if (finalManagerIds.length > 0) {
                finalManagerIds.forEach((mid: string) => {
                    permissions!.push(Permission.read(Role.user(mid)));
                    permissions!.push(Permission.update(Role.user(mid)));
                    permissions!.push(Permission.delete(Role.user(mid)));
                });
            }

            // Add Team Lead permissions
            if (finalTeamLeadId) {
                permissions!.push(`read("user:${finalTeamLeadId}")`);
                permissions!.push(`update("user:${finalTeamLeadId}")`);
            }
        }

        await databases.updateDocument(
            DATABASE_ID,
            USERS_COLLECTION_ID,
            userId,
            updates,
            permissions // Pass new permissions if calculated
        );

        // Log audit
        await logAuditAction(
           databases,
           'USER_UPDATE',
           callerDoc.$id,
           callerDoc.name,
           userId,
           'user',
           updates
        );

        return { success: true };

    } catch (error: any) {
        console.error("Update failed", error);
        const errorMessage = error?.message || String(error);
        throw new Error("Failed to update user: " + errorMessage);
    }
}
