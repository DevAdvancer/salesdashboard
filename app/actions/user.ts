'use server';

import { ID, Permission, Role } from 'node-appwrite';
import { createAdminClient, createSessionClient } from '@/lib/server/appwrite';
import { CreateManagerInput, CreateTeamLeadInput, CreateAgentInput, UserRole, CreateAssistantManagerInput } from '@/lib/types';
import { COLLECTIONS } from '@/lib/constants/appwrite';

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

export async function createAssistantManagerAction(input: CreateAssistantManagerInput & { currentUserId: string }) {
    const { currentUserId, ...amInput } = input;

    if (!currentUserId) throw new Error("Unauthorized - No user ID provided");

    const callerDoc = await getUserDoc(currentUserId);
    // Allow admin and manager roles to create assistant managers
    if (!callerDoc || (callerDoc.role !== 'manager' && callerDoc.role !== 'admin')) {
        throw new Error("Permission denied: Only managers and admins can create assistant managers");
    }

    // Validate branches (skip for admin, but verify existence)
    const BRANCHES_COLLECTION_ID = process.env.NEXT_PUBLIC_APPWRITE_BRANCHES_COLLECTION_ID!;
    const { users, databases } = await createAdminClient();

    if (callerDoc.role !== 'admin') {
        const callerBranches = (callerDoc.branchIds as string[]) || [];
        for (const bid of amInput.branchIds) {
            if (!callerBranches.includes(bid)) {
                throw new Error(`Branch ${bid} is not in your assigned branches`);
            }
        }
    } else {
        // For admin, verify branches exist
        for (const branchId of amInput.branchIds) {
            try {
                await databases.getDocument(DATABASE_ID, BRANCHES_COLLECTION_ID, branchId);
            } catch (error) {
                throw new Error(`Branch ${branchId} does not exist`);
            }
        }
    }

    const { name, email, password, branchIds, managerIds: inputManagerIds } = amInput;
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
    } else if (inputManagerIds && inputManagerIds.length > 0) {
        // Admin can assign managers
        managerIds = inputManagerIds;
    }

    try {
        await databases.createDocument(
            DATABASE_ID,
            USERS_COLLECTION_ID,
            userId,
            {
                name,
                email,
                role: 'assistant_manager',
                managerId: managerIds.length > 0 ? managerIds[0] : null,
                managerIds: managerIds,
                teamLeadId: null,
                branchIds,
            },
            [
                Permission.read(Role.user(userId)),
                Permission.read(Role.users()), // All users can read user list? Or restrict? Existing logic seems open.
                Permission.update(Role.user(userId)),
            ]
        );

        await logAuditAction(databases, 'USER_CREATE', currentUserId, callerDoc.name, userId, 'assistant_manager', { branchIds });

        return { success: true, userId };
    } catch (error: any) {
        console.error('Error creating assistant manager document:', error);
        // Cleanup Auth user
        await users.delete(userId);
        throw new Error(error.message || 'Failed to create assistant manager profile');
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
    for (const branchId of branchIds) {
        try {
            await databases.getDocument(DATABASE_ID, COLLECTIONS.BRANCHES, branchId);
        } catch (error) {
            console.error(`Error validating branch ${branchId} in collection ${COLLECTIONS.BRANCHES}:`, error);
            throw new Error(`Branch ${branchId} does not exist in collection ${COLLECTIONS.BRANCHES}`);
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
    // Allow admin, manager, and assistant_manager roles to create team leads
    if (!callerDoc || (callerDoc.role !== 'manager' && callerDoc.role !== 'admin' && callerDoc.role !== 'assistant_manager')) {
        throw new Error("Permission denied: Only managers, assistant managers, and admins can create team leads");
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
    let assistantManagerId: string | null = null;

    if (callerDoc.role === 'manager') {
        managerIds = [callerDoc.$id];
    } else if (callerDoc.role === 'assistant_manager') {
        // If created by AM, managerIds should include AM's managers + AM
        const callerManagerIds = callerDoc.managerIds || (callerDoc.managerId ? [callerDoc.managerId] : []);
        managerIds = [...callerManagerIds, callerDoc.$id];
        assistantManagerId = callerDoc.$id;
    } else if (inputManagerIds && Array.isArray(inputManagerIds)) {
        managerIds = inputManagerIds;
    }

    // Generate permissions for all managers
    const managerPermissions = managerIds.flatMap(mid => [
        Permission.read(Role.user(mid)),
        Permission.update(Role.user(mid)),
        Permission.delete(Role.user(mid))
    ]);

    // Use managerIds[0] as legacy managerId for now if available, or current user if manager
    const primaryManagerId = managerIds.length > 0 ? managerIds[0] : (callerDoc.role === 'manager' ? callerDoc.$id : null);

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
                managerId: primaryManagerId,
                assistantManagerId,
                teamLeadId: null,
                branchIds
            },
            [
                 Permission.read(Role.user(userId)),
                 // Permission.read(Role.users()), // Removed global read access for security
                 Permission.update(Role.user(userId)),
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
            { role: 'team_lead', email, name, branchIds, managerId: primaryManagerId, managerIds, assistantManagerId }
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
    if (!callerDoc || (callerDoc.role !== 'team_lead' && callerDoc.role !== 'manager' && callerDoc.role !== 'admin' && callerDoc.role !== 'assistant_manager')) {
        throw new Error("Permission denied: Only team leads, managers, assistant managers, or admins can create agents");
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
    const isAssistantManager = callerDoc.role === 'assistant_manager';

    // For admin, we default to no hierarchy for now unless specified
    // For manager, allow assigning to another manager (e.g. Assistant Manager) if specified, otherwise default to self
    let managerId = agentInput.managerId || null;
    let managerIds: string[] = [];
    let assistantManagerId: string | null = null;

    // Calculate managerIds logic
    if (isTeamLead) {
        managerId = callerDoc.managerId || null;
        // Inherit managerIds from Team Lead (which includes their managers)
        managerIds = callerDoc.managerIds || [];
        if (managerId && !managerIds.includes(managerId)) {
            managerIds.push(managerId);
        }
        // Inherit assistantManagerId from Team Lead
        assistantManagerId = callerDoc.assistantManagerId || null;
    } else if (isManager) {
        if (!managerId) {
            managerId = callerDoc.$id;
            managerIds = [callerDoc.$id];
        } else {
            // Manager assigned to Assistant Manager?
            managerIds = [managerId];
            // Check if assigned manager is an AM
            if (managerId !== callerDoc.$id) {
                 // Optimization: We could fetch the user to verify role, but typically UI ensures this.
                 // For now, if assigned to someone else, assume it might be AM.
                 // But wait, if Manager assigns to AM, managerId is AM.
                 assistantManagerId = managerId;
            }
        }
    } else if (isAssistantManager) {
        if (!managerId) {
            // If AM creates and no specific manager assigned (e.g. direct report), AM is manager
            managerId = callerDoc.$id;
            // AM's managers + AM
            const callerManagerIds = callerDoc.managerIds || (callerDoc.managerId ? [callerDoc.managerId] : []);
            managerIds = [...callerManagerIds, callerDoc.$id];
            assistantManagerId = callerDoc.$id;
        } else {
            // Assigned to someone else? (e.g. TL)
            // If assigned to TL, teamLeadId handles it.
            // If assigned to another manager? AM usually assigns to TL or self.
            // If managerId is set, it might be the AM itself passed from UI?
            if (managerId === callerDoc.$id) {
                 const callerManagerIds = callerDoc.managerIds || (callerDoc.managerId ? [callerDoc.managerId] : []);
                 managerIds = [...callerManagerIds, callerDoc.$id];
                 assistantManagerId = callerDoc.$id;
            } else {
                 // Should inherit from that manager?
                 managerIds = [managerId];
                 assistantManagerId = managerId;
            }
        }
    } else {
        // Admin or other: trust input or single managerId
        if (managerId) managerIds = [managerId];
    }

    // Ensure managerId is synced with managerIds[0] if needed or vice versa?
    // Actually managerId is primary.

    const teamLeadId = isTeamLead ? callerDoc.$id : (agentInput.teamLeadId || null);

    // If Team Lead is assigned, we should also include their managers in managerIds?
    // If TL is assigned, the Agent's managerId should technically be the TL's manager.
    // The current logic above for isTeamLead sets managerId = callerDoc.managerId.
    // If Admin/Manager/AM assigns a TL, we need to fetch that TL to get their manager.
    if (teamLeadId && !isTeamLead) {
        try {
            const tlDoc = await getUserDoc(teamLeadId);
            if (tlDoc) {
                // Agent inherits manager from TL
                managerId = tlDoc.managerId;
                managerIds = tlDoc.managerIds || [];
                if (managerId && !managerIds.includes(managerId)) {
                    managerIds.push(managerId);
                }
                // Inherit AM from TL
                if (tlDoc.assistantManagerId) {
                    assistantManagerId = tlDoc.assistantManagerId;
                }
            }
        } catch (e) {
            console.error("Failed to fetch assigned Team Lead details", e);
        }
    }

    try {
        await users.create(userId, email, undefined, password, name);
    } catch (e: any) {
        if (e.code === 409) throw new Error("A user with this email already exists");
        throw e;
    }

    try {
        const permissions = [
            Permission.read(Role.user(userId)),
            // Permission.read(Role.users()), // Removed global read access for security
            ...(teamLeadId ? [Permission.read(Role.user(teamLeadId))] : []),
            Permission.update(Role.user(userId)),
            ...(teamLeadId ? [Permission.update(Role.user(teamLeadId))] : []),
        ];

        // Add permissions for all managers in the chain
        if (managerIds.length > 0) {
            managerIds.forEach(mid => {
                permissions.push(Permission.read(Role.user(mid)));
                // Only primary manager or specific roles might get delete?
                // For now giving read access to all up chain is key.
                // Give update/delete to managers?
                permissions.push(Permission.update(Role.user(mid))); // Managers can update agents
                permissions.push(Permission.delete(Role.user(mid))); // Managers can delete agents
            });
        } else if (managerId) {
             permissions.push(Permission.read(Role.user(managerId)));
             permissions.push(Permission.update(Role.user(managerId)));
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
                managerId,
                managerIds, // Save the chain
                assistantManagerId, // Save the AM ID
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
            { role: 'agent', email, name, branchIds, managerId, managerIds, assistantManagerId, teamLeadId }
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
    const isCallerAssistantManager = callerDoc.role === 'assistant_manager';
    const isCallerTeamLead = callerDoc.role === 'team_lead';

    // Permission Check
    if (!isCallerAdmin && !isCallerManager && !isCallerTeamLead && !isCallerAssistantManager) {
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
             // Manager can also manage Assistant Managers (Agent/TL -> AM, AM -> Agent/TL)
             else if (isCallerManager) {
                 const allowedRoles = ['agent', 'team_lead', 'assistant_manager'];
                 if (allowedRoles.includes(targetUserDoc.role) && allowedRoles.includes(role)) {
                     updates.role = role;
                 } else {
                     throw new Error("Managers can only manage Agents, Team Leads, and Assistant Managers.");
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
             } else if (role === 'assistant_manager') {
                 updates.teamLeadId = null;
                 // If promoted by manager, ensure managerId is set to the caller (manager) if not explicitly set
                 if (isCallerManager && !updates.managerId && !managerId && !managerIds && !targetUserDoc.managerId) {
                     updates.managerId = currentUserId;
                     updates.managerIds = [currentUserId];
                 }
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
            // Check if managerIds are actually changing
            const currentManagerIds = targetUserDoc.managerIds || [];
            const isManagerIdsChanged = JSON.stringify(managerIds.sort()) !== JSON.stringify(currentManagerIds.sort());

            if (isManagerIdsChanged) {
                 if (!isCallerAdmin && !isCallerManager && !isCallerAssistantManager) throw new Error("Permission denied to change manager");
            }

            // Validate manager IDs existence
            if (managerIds.length > 0) {
                if (managerIds.some(id => !id || typeof id !== 'string')) {
                    throw new Error("Invalid manager ID format");
                }
            }

            newManagerIds = managerIds;
            updates.managerIds = managerIds;
            // Sync legacy field
            updates.managerId = managerIds.length > 0 ? managerIds[0] : null;
        } else if (managerId !== undefined) {
             // Check if managerId is actually changing
             if (managerId !== targetUserDoc.managerId) {
                  if (!isCallerAdmin && !isCallerManager && !isCallerAssistantManager) throw new Error("Permission denied to change manager");
             }
             
             // If legacy field is used, treat as single manager array
             newManagerIds = managerId ? [managerId] : [];
             updates.managerIds = newManagerIds;
             updates.managerId = managerId;
        }

        // 3. Handle Team Lead Update
        if (teamLeadId !== undefined && teamLeadId !== targetUserDoc.teamLeadId) {
             // Admin, Manager, and Assistant Manager can assign Team Leads
             if (isCallerAdmin || isCallerManager || isCallerAssistantManager) {
                 updates.teamLeadId = teamLeadId;
                 
                 // When TL changes, we should sync manager fields from new TL if available
                 if (teamLeadId) {
                    try {
                        const tlDoc = await getUserDoc(teamLeadId);
                        if (tlDoc) {
                            // Inherit managers from new TL
                            updates.managerId = tlDoc.managerId;
                            updates.managerIds = tlDoc.managerIds || [];
                            // Ensure TL's manager is in the list
                            if (tlDoc.managerId && !updates.managerIds.includes(tlDoc.managerId)) {
                                updates.managerIds.push(tlDoc.managerId);
                            }
                            // Inherit AM from new TL
                            if (tlDoc.assistantManagerId) {
                                updates.assistantManagerId = tlDoc.assistantManagerId;
                            }
                        }
                    } catch (e) {
                        console.error("Failed to sync manager fields from new Team Lead", e);
                    }
                 }
             } else if (isCallerTeamLead) {
                 // Team Lead cannot assign other Team Leads, usually.
                 // But maybe they can assign themselves? No, they create agents.
                 // Let's restrict: Team Leads cannot change teamLeadId of an existing user (unless it's during creation which is handled separately)
                 throw new Error("Team Leads cannot reassign Team Leads.");
             }
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
                Permission.read(Role.user(userId)),
                // Permission.read(Role.users()), // Removed global read access for security
                Permission.update(Role.user(userId))
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
                permissions!.push(Permission.read(Role.user(finalTeamLeadId)));
                permissions!.push(Permission.update(Role.user(finalTeamLeadId)));
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
