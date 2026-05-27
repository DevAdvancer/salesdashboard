'use server';

import { createAdminClient } from '@/lib/server/appwrite';
import { createNotificationsForRecipients } from '@/lib/server/notifications';
import { COLLECTIONS, DATABASE_ID } from '@/lib/constants/appwrite';
import { Permission, Role, ID, Query } from 'node-appwrite';
import { Lead, User } from '@/lib/types';
import { assertAuthenticatedUserId } from '@/lib/server/current-user';

type AdminDatabases = Awaited<ReturnType<typeof createAdminClient>>['databases'];

/**
 * Helper to get permissions for supervisors up the chain (Server Side)
 */
async function getHierarchyPermissionsServer(userId: string, databases: AdminDatabases): Promise<string[]> {
    const permissions: string[] = [];
    try {
        let currentId = userId;
        const visited = new Set<string>();
        
        // Walk up the hierarchy (max 5 levels to prevent loops)
        while (currentId && !visited.has(currentId) && visited.size < 5) {
            visited.add(currentId);
            
            try {
                const user = await databases.getDocument(
                    DATABASE_ID,
                    COLLECTIONS.USERS,
                    currentId
                ) as unknown as User;
                
                // Add supervisors
                const supervisors = new Set<string>();
                if (user.teamLeadId) supervisors.add(user.teamLeadId);
                if (user.managerId) supervisors.add(user.managerId);
                if (user.managerIds && user.managerIds.length > 0) {
                    user.managerIds.forEach(mid => supervisors.add(mid));
                }
                
                // Add permissions for supervisors
                for (const supId of supervisors) {
                    if (!visited.has(supId)) {
                        permissions.push(Permission.read(Role.user(supId)));
                        permissions.push(Permission.update(Role.user(supId)));
                        permissions.push(Permission.delete(Role.user(supId)));
                    }
                }
                
                // Move up to the next level
                if (user.teamLeadId) {
                    currentId = user.teamLeadId;
                } else if (user.managerId) {
                    currentId = user.managerId;
                } else if (user.managerIds && user.managerIds.length > 0) {
                    currentId = user.managerIds[0];
                } else {
                    break; // Top of chain
                }
            } catch (err) {
                // User might not exist or other error, break chain
                console.error(`Error fetching user ${currentId} for hierarchy:`, err);
                break;
            }
        }
    } catch (e) {
        console.error(`Error fetching hierarchy permissions for user ${userId}:`, e);
    }
    return permissions;
}

function getLeadDisplayName(lead: Lead): string {
    try {
        const data = JSON.parse(lead.data) as Record<string, unknown>;
        const firstName = String(data.firstName ?? '').trim();
        const lastName = String(data.lastName ?? '').trim();
        const company = String(data.company ?? '').trim();
        const email = String(data.email ?? '').trim();
        return [firstName, lastName].filter(Boolean).join(' ') || company || email || 'Lead';
    } catch {
        return 'Lead';
    }
}

/**
 * Assign a lead to an agent using server-side admin client
 * This bypasses user-level permissions to ensure managers can always reassign leads.
 */
export async function assignLeadAction(
    leadId: string,
    agentId: string,
    actorId: string,
    actorName: string
) {
    await assertAuthenticatedUserId(actorId);
    const { databases } = await createAdminClient();

    try {
        const actorDoc = await databases.getDocument(
            DATABASE_ID,
            COLLECTIONS.USERS,
            actorId
        ) as unknown as User;

        if (!['admin', 'manager', 'assistant_manager', 'team_lead'].includes(actorDoc.role)) {
            throw new Error('Permission denied');
        }

        if (actorDoc.role === 'team_lead') {
            const agentDoc = await databases.getDocument(
                DATABASE_ID,
                COLLECTIONS.USERS,
                agentId
            ) as unknown as User;

            if (agentDoc.role !== 'agent') {
                throw new Error('Team leads can only assign leads to agents.');
            }

            if (agentDoc.teamLeadId !== actorId) {
                throw new Error('Team leads can only assign agents under them.');
            }

            const subordinatesResponse = await databases.listDocuments(
                DATABASE_ID,
                COLLECTIONS.USERS,
                [
                    Query.equal('teamLeadId', actorId),
                    Query.or([Query.equal('role', 'agent'), Query.equal('role', 'lead_generation')]),
                    Query.limit(5000),
                ]
            );
            const visibleUserIds = [actorId, ...subordinatesResponse.documents.map((doc: any) => String(doc.$id))];

            const currentLeadForVisibility = await databases.getDocument(
                DATABASE_ID,
                COLLECTIONS.LEADS,
                leadId
            ) as unknown as Lead;

            const withinScope =
                visibleUserIds.includes(currentLeadForVisibility.ownerId) ||
                (currentLeadForVisibility.assignedToId ? visibleUserIds.includes(currentLeadForVisibility.assignedToId) : false);

            if (!withinScope) {
                throw new Error('Permission denied');
            }
        }

        // Get the current lead to check owner and status
        const currentLead = await databases.getDocument(
            DATABASE_ID,
            COLLECTIONS.LEADS,
            leadId
        ) as unknown as Lead;

        // Build new permissions
        // Always include the owner
        const permissions: string[] = [
            Permission.read(Role.user(currentLead.ownerId)),
            Permission.update(Role.user(currentLead.ownerId)),
            Permission.delete(Role.user(currentLead.ownerId)),
        ];
        
        // Add owner's hierarchy permissions
        const ownerHierarchyPerms = await getHierarchyPermissionsServer(currentLead.ownerId, databases);
        permissions.push(...ownerHierarchyPerms);

        // Add new agent permissions
        if (!currentLead.isClosed) {
            permissions.push(
                Permission.read(Role.user(agentId)),
                Permission.update(Role.user(agentId))
            );
        } else {
            // For closed leads, agent gets read-only access
            permissions.push(Permission.read(Role.user(agentId)));
        }
        
        // Add assigned agent's hierarchy permissions
        const assignedHierarchyPerms = await getHierarchyPermissionsServer(agentId, databases);
        permissions.push(...assignedHierarchyPerms);

        // Update the lead
        const lead = await databases.updateDocument(
            DATABASE_ID,
            COLLECTIONS.LEADS,
            leadId,
            {
                assignedToId: agentId,
            },
            permissions
        );

        // Log audit action
        try {
            await databases.createDocument(
                DATABASE_ID,
                COLLECTIONS.AUDIT_LOGS,
                ID.unique(),
                {
                    action: 'LEAD_UPDATE',
                    actorId: actorId,
                    actorName: actorName,
                    targetId: leadId,
                    targetType: 'LEAD',
                    metadata: JSON.stringify({ assignedToId: agentId }),
                    performedAt: new Date().toISOString(),
                }
            );
        } catch (auditError) {
            console.error('Failed to log audit for lead assignment:', auditError);
            // Non-blocking error
        }

        await createNotificationsForRecipients(
            databases,
            [agentId],
            {
                type: 'lead_assignment',
                title: 'Lead assigned',
                body: `${actorName} assigned ${getLeadDisplayName(currentLead)} to you.`,
                targetId: leadId,
                targetType: 'LEAD',
            }
        );

        return { success: true, lead: lead as unknown as Lead };
    } catch (error: unknown) {
        console.error('Error assigning lead (server action):', error);
        throw new Error(error instanceof Error ? error.message : 'Failed to assign lead');
    }
}
