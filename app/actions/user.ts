'use server';

import { ID, Permission, Query, Role } from 'node-appwrite';
import { createAdminClient, createSessionClient } from '@/lib/server/appwrite';
import { assertAuthenticatedUserId } from '@/lib/server/current-user';
import { CreateManagerInput, CreateTeamLeadInput, CreateAgentInput, UserRole, CreateAssistantManagerInput } from '@/lib/types';
import { COLLECTIONS } from '@/lib/constants/appwrite';
import { normalizeEmail } from '@/lib/utils/user-hierarchy';
import { getErrorMessage } from '@/lib/utils';

// Constants
const DATABASE_ID = process.env.NEXT_PUBLIC_APPWRITE_DATABASE_ID!;
const USERS_COLLECTION_ID = process.env.NEXT_PUBLIC_APPWRITE_USERS_COLLECTION_ID!;
const AUDIT_LOGS_COLLECTION_ID = process.env.NEXT_PUBLIC_APPWRITE_AUDIT_LOGS_COLLECTION_ID!;

type CreateAdminInput = {
    name: string;
    email: string;
    password: string;
};

function getErrorCode(error: unknown): number | undefined {
    return typeof error === 'object' && error !== null && 'code' in error
        ? Number((error as { code: unknown }).code)
        : undefined;
}

function removeDeletedUserReferences(doc: Record<string, unknown>, deletedUserId: string) {
    const updates: Record<string, unknown> = {};
    let changed = false;

    if (doc.teamLeadId === deletedUserId) {
        updates.teamLeadId = null;
        changed = true;
    }

    return changed ? updates : null;
}

function isUnknownAttributeError(error: unknown, attribute: string) {
    const message = getErrorMessage(error);
    return message.includes('Unknown attribute') && message.includes(attribute);
}

async function ensureUserIsActiveAttribute(databases: any) {
    try {
        await databases.getAttribute(DATABASE_ID, USERS_COLLECTION_ID, 'isActive');
        return;
    } catch (error: unknown) {
        const code = getErrorCode(error);
        if (code !== 404) {
            const message = getErrorMessage(error);
            if (!message.includes('Attribute not found') && !message.includes('not found')) {
                throw error;
            }
        }
    }

    try {
        await databases.createBooleanAttribute(
            DATABASE_ID,
            USERS_COLLECTION_ID,
            'isActive',
            false,
            true,
            false
        );
    } catch (error: unknown) {
        const code = getErrorCode(error);
        const message = getErrorMessage(error);
        if (code !== 409 && !message.includes('already exists')) {
            throw error;
        }
    }

    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
        const attribute = await databases.getAttribute(DATABASE_ID, USERS_COLLECTION_ID, 'isActive');
        const status = typeof attribute === 'object' && attribute !== null && 'status' in attribute
            ? String((attribute as { status: unknown }).status)
            : '';

        if (status === 'available' || status === '') return;
        if (status === 'failed') throw new Error('Failed to create users.isActive attribute');

        await new Promise((resolve) => setTimeout(resolve, 750));
    }

    throw new Error('Timed out waiting for users.isActive attribute to become available');
}

async function filterUpdatesToExistingUserAttributes(
    databases: any,
    updates: Record<string, unknown>
) {
    const entries = await Promise.all(
        Object.entries(updates).map(async ([key, value]) => {
            if (key === 'isActive') {
                await ensureUserIsActiveAttribute(databases);
                return [key, value] as const;
            }

            try {
                await databases.getAttribute(DATABASE_ID, USERS_COLLECTION_ID, key);
                return [key, value] as const;
            } catch (error: unknown) {
                const code = getErrorCode(error);
                const message = getErrorMessage(error);
                if (code === 404 || message.includes('Attribute not found') || message.includes('not found')) {
                    return null;
                }
                throw error;
            }
        })
    );

    return Object.fromEntries(entries.filter((entry): entry is readonly [string, unknown] => Boolean(entry)));
}

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
    void input;
    throw new Error("Assistant manager role has been retired. Create a team lead or agent instead.");
}

export async function createManagerAction(input: CreateManagerInput & { currentUserId: string }) {
    void input;
    throw new Error("Manager role has been retired. Create an admin, team lead, agent, or lead generation user instead.");
}

export async function createAdminAction(input: CreateAdminInput & { currentUserId: string }) {
    const { currentUserId, name, email, password } = input;

    await assertAuthenticatedUserId(currentUserId);

    const callerDoc = await getUserDoc(currentUserId);
    if (!callerDoc || (callerDoc.role !== 'admin' && callerDoc.role !== 'developer')) {
        throw new Error("Permission denied: Only admins and developers can create admins");
    }

    const { users, databases } = await createAdminClient();
    const userId = ID.unique();
    const normalizedEmail = normalizeEmail(email);

    try {
        await users.create(userId, normalizedEmail, undefined, password, name);
    } catch (e: unknown) {
        if (getErrorCode(e) === 409) throw new Error("A user with this email already exists");
        throw e;
    }

    try {
        await databases.createDocument(
            DATABASE_ID,
            USERS_COLLECTION_ID,
            userId,
            {
                name,
                email: normalizedEmail,
                role: 'admin',
                teamLeadId: null,
                isActive: true,
                branchIds: [],
            },
            [
                Permission.read(Role.user(userId)),
                Permission.read(Role.label('admin')),
                Permission.update(Role.user(userId)),
                Permission.update(Role.label('admin')),
                Permission.delete(Role.label('admin')),
            ]
        );

        await logAuditAction(
            databases,
            'USER_CREATE',
            callerDoc.$id,
            callerDoc.name,
            userId,
            'admin',
            { role: 'admin', email: normalizedEmail, name }
        );

        return { success: true, userId };
    } catch (error: unknown) {
        console.error("DB Creation failed, rolling back Auth User", error);
        await users.delete(userId);
        throw new Error("Failed to create user profile: " + getErrorMessage(error));
    }
}

export async function createDeveloperAction(input: CreateAdminInput & { currentUserId: string }) {
    const { currentUserId, name, email, password } = input;

    await assertAuthenticatedUserId(currentUserId);

    const callerDoc = await getUserDoc(currentUserId);
    if (!callerDoc || (callerDoc.role !== 'admin' && callerDoc.role !== 'developer')) {
        throw new Error("Permission denied: Only admins and developers can create developers");
    }

    const { users, databases } = await createAdminClient();
    const userId = ID.unique();
    const normalizedEmail = normalizeEmail(email);

    try {
        await users.create(userId, normalizedEmail, undefined, password, name);
    } catch (e: unknown) {
        if (getErrorCode(e) === 409) throw new Error("A user with this email already exists");
        throw e;
    }

    try {
        await databases.createDocument(
            DATABASE_ID,
            USERS_COLLECTION_ID,
            userId,
            {
                name,
                email: normalizedEmail,
                role: 'developer',
                teamLeadId: null,
                isActive: true,
                branchIds: [],
            },
            [
                Permission.read(Role.user(userId)),
                Permission.read(Role.label('admin')),
                Permission.update(Role.user(userId)),
                Permission.update(Role.label('admin')),
                Permission.delete(Role.label('admin')),
            ]
        );

        await logAuditAction(
            databases,
            'USER_CREATE',
            callerDoc.$id,
            callerDoc.name,
            userId,
            'developer',
            { role: 'developer', email: normalizedEmail, name }
        );

        return { success: true, userId };
    } catch (error: unknown) {
        console.error("DB Creation failed, rolling back Auth User", error);
        await users.delete(userId);
        throw new Error("Failed to create user profile: " + getErrorMessage(error));
    }
}

export async function createTeamLeadAction(input: CreateTeamLeadInput & { currentUserId: string }) {
    const { currentUserId, ...teamLeadInput } = input;

    await assertAuthenticatedUserId(currentUserId);

    const callerDoc = await getUserDoc(currentUserId);
    if (!callerDoc || (callerDoc.role !== 'admin' && callerDoc.role !== 'developer')) {
        throw new Error("Permission denied: Only admins and developers can create team leads");
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
                teamLeadId: null,
                isActive: true,
                branchIds
            },
            [
                 Permission.read(Role.user(userId)),
                 // Permission.read(Role.users()), // Removed global read access for security
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
            'team_lead',
            { role: 'team_lead', email, name, branchIds }
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

    await assertAuthenticatedUserId(currentUserId);

    const callerDoc = await getUserDoc(currentUserId);
    if (!callerDoc || (callerDoc.role !== 'team_lead' && callerDoc.role !== 'admin' && callerDoc.role !== 'developer')) {
        throw new Error("Permission denied: Only team leads, admins, or developers can create agents");
    }

    if (callerDoc.role !== 'admin' && callerDoc.role !== 'developer') {
        const callerBranches = (callerDoc.branchIds as string[]) || [];
        for (const bid of agentInput.branchIds) {
            if (!callerBranches.includes(bid)) {
                throw new Error(`Branch ${bid} is not in your assigned branches`);
            }
        }
    }

    const role: UserRole = agentInput.role ?? 'agent';
    if (role !== 'agent' && role !== 'lead_generation' && role !== 'monitor' && role !== 'operations') {
        throw new Error('Invalid role for createAgentAction');
    }
    if ((role === 'monitor' || role === 'operations') && callerDoc.role !== 'admin' && callerDoc.role !== 'developer') {
        throw new Error('Permission denied: Only admins and developers can create this role');
    }

    const { name, email, password, branchIds } = agentInput;
    const { users, databases } = await createAdminClient();
    const userId = ID.unique();

    const isTeamLead = callerDoc.role === 'team_lead';
    const teamLeadId = role === 'monitor' || role === 'operations' ? null : (isTeamLead ? callerDoc.$id : (agentInput.teamLeadId || null));
    if (!teamLeadId && role !== 'monitor' && role !== 'operations' && callerDoc.role !== 'admin' && callerDoc.role !== 'developer') {
        throw new Error("Agents must be assigned to a Team Lead");
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

        await databases.createDocument(
            DATABASE_ID,
            USERS_COLLECTION_ID,
            userId,
            {
                name,
                email,
                role,
                teamLeadId,
                isActive: true,
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
            role,
            { role, email, name, branchIds, teamLeadId }
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
    managerId?: string | null;
    managerIds?: string[];
    assistantManagerId?: string | null;
    assistantManagerIds?: string[];
    teamLeadId?: string | null;
    branchIds?: string[];
    currentUserId: string;
}) {
    const { userId, role, teamLeadId, branchIds, currentUserId } = input;

    await assertAuthenticatedUserId(currentUserId);

    const callerDoc = await getUserDoc(currentUserId);
    if (!callerDoc) throw new Error("User profile not found");

    const targetUserDoc = await getUserDoc(userId);
    if (!targetUserDoc) throw new Error("Target user not found");

    const isCallerAdmin = callerDoc.role === 'admin' || callerDoc.role === 'developer';
    const isCallerTeamLead = callerDoc.role === 'team_lead';

    // Permission Check
    if (!isCallerAdmin && !isCallerTeamLead) {
        throw new Error("Permission denied");
    }

    const { databases } = await createAdminClient();

    try {
        const updates: any = {};

        if (role && role !== targetUserDoc.role) {
             if (!isCallerAdmin) {
                 throw new Error("Only admins or developers can change user roles.");
             }
             if (role === 'manager' || role === 'assistant_manager') {
                 throw new Error("Manager and assistant manager roles have been removed.");
             }
             updates.role = role;
             if (role === 'team_lead' || role === 'monitor' || role === 'operations' || role === 'admin' || role === 'developer') {
                 updates.teamLeadId = null;
             }
        }

        if (teamLeadId !== undefined && teamLeadId !== targetUserDoc.teamLeadId) {
             if (!isCallerAdmin) {
                 throw new Error("Team Leads cannot reassign Team Leads.");
             }
             updates.teamLeadId = teamLeadId;
        }

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

        let permissions: string[] | undefined;

        if (updates.teamLeadId !== undefined || updates.role) {
            const finalTeamLeadId = updates.teamLeadId !== undefined ? updates.teamLeadId : targetUserDoc.teamLeadId;

            permissions = [
                Permission.read(Role.user(userId)),
                // Permission.read(Role.users()), // Removed global read access for security
                Permission.update(Role.user(userId))
            ];

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

export async function deleteUserAction(input: {
    userId: string;
    currentUserId: string;
}) {
    const { userId, currentUserId } = input;

    await assertAuthenticatedUserId(currentUserId);

    if (userId === currentUserId) {
        throw new Error("Admins cannot delete their own account from user management");
    }

    const callerDoc = await getUserDoc(currentUserId);
    if (!callerDoc || (callerDoc.role !== 'admin' && callerDoc.role !== 'developer')) {
        throw new Error("Permission denied: Only admins and developers can delete users");
    }

    const targetUserDoc = await getUserDoc(userId);
    if (!targetUserDoc) throw new Error("Target user not found");

    const { users, databases } = await createAdminClient();

    try {
        const relatedUsers = await databases.listDocuments(
            DATABASE_ID,
            USERS_COLLECTION_ID,
            [Query.limit(5000)]
        );

        await Promise.all(
            relatedUsers.documents
                .filter((doc: Record<string, unknown>) => doc.$id !== userId)
                .map(async (doc: Record<string, unknown>) => {
                    const updates = removeDeletedUserReferences(doc, userId);
                    if (!updates) return;

                    await databases.updateDocument(
                        DATABASE_ID,
                        USERS_COLLECTION_ID,
                        String(doc.$id),
                        updates
                    );
                })
        );

        await databases.deleteDocument(DATABASE_ID, USERS_COLLECTION_ID, userId);
        await users.delete(userId);

        await logAuditAction(
            databases,
            'USER_DELETE',
            callerDoc.$id,
            callerDoc.name,
            userId,
            'user',
            { role: targetUserDoc.role, email: targetUserDoc.email, name: targetUserDoc.name }
        );

        return { success: true };
    } catch (error: unknown) {
        console.error("Delete failed", error);
        const errorMessage = getErrorMessage(error);
        throw new Error("Failed to delete user: " + errorMessage);
    }
}

export async function setAgentActiveAction(input: {
    userId: string;
    isActive: boolean;
    currentUserId: string;
}) {
    const { userId, isActive, currentUserId } = input;

    await assertAuthenticatedUserId(currentUserId);

    const callerDoc = await getUserDoc(currentUserId);
    if (!callerDoc || (callerDoc.role !== 'admin' && callerDoc.role !== 'developer')) {
        throw new Error("Permission denied: Only admins and developers can update agent active status");
    }

    const targetUserDoc = await getUserDoc(userId);
    if (!targetUserDoc) throw new Error("Target user not found");
    if (targetUserDoc.role !== 'agent' && targetUserDoc.role !== 'lead_generation' && targetUserDoc.role !== 'monitor' && targetUserDoc.role !== 'operations') {
        throw new Error("Only agents, lead generation users, monitors, and operations can be inactivated from this action");
    }

    const { users, databases } = await createAdminClient();

    try {
        await users.updateStatus(userId, isActive);

        const updates = isActive
            ? { isActive: true }
            : {
                isActive: false,
                teamLeadId: null,
            };

        const schemaSafeUpdates = await filterUpdatesToExistingUserAttributes(databases, updates);

        try {
            await databases.updateDocument(
                DATABASE_ID,
                USERS_COLLECTION_ID,
                userId,
                schemaSafeUpdates
            );
        } catch (error: unknown) {
            if (!isUnknownAttributeError(error, 'isActive')) {
                throw error;
            }

            await ensureUserIsActiveAttribute(databases);
            await databases.updateDocument(
                DATABASE_ID,
                USERS_COLLECTION_ID,
                userId,
                schemaSafeUpdates
            );
        }

        await logAuditAction(
            databases,
            'USER_UPDATE',
            callerDoc.$id,
            callerDoc.name,
            userId,
            targetUserDoc.role,
            { isActive }
        );

        return { success: true };
    } catch (error: unknown) {
        console.error("Agent active status update failed", error);
        throw new Error("Failed to update agent active status: " + getErrorMessage(error));
    }
}
