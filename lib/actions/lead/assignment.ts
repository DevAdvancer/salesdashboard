'use server';

import { createAdminClient } from '@/lib/server/appwrite';
import { createNotificationsForRecipients } from '@/lib/server/notifications';
import { BUCKETS, COLLECTIONS, DATABASE_ID } from '@/lib/constants/appwrite';
import { Permission, Role, ID, Query } from 'node-appwrite';
import { Lead, User } from '@/lib/types';
import { assertAuthenticatedUserId } from '@/lib/server/current-user';
import { recordLgHandoffAction } from '@/app/actions/lg-handoffs';
import { getHierarchyPermissionsServer, assertAssignmentAllowed } from './visibility';
import { getLeadDisplayName, getLeadResumeFileId } from './utils';
import { logger } from '@/lib/utils/logger';

type AdminDatabases = Awaited<ReturnType<typeof createAdminClient>>['databases'];

async function syncResumePermissionsForAssignment(
    lead: Lead,
    agentId: string,
    databases: AdminDatabases,
    storage: Awaited<ReturnType<typeof createAdminClient>>['storage']
) {
    const resumeFileId = getLeadResumeFileId(lead);
    if (!resumeFileId) return;

    const permissions = [
        Permission.read(Role.user(lead.ownerId)),
        Permission.update(Role.user(lead.ownerId)),
        Permission.delete(Role.user(lead.ownerId)),
        Permission.read(Role.user(agentId)),
        ...(await getHierarchyPermissionsServer(lead.ownerId, databases)),
        ...(await getHierarchyPermissionsServer(agentId, databases)),
    ];

    try {
        await storage.updateFile(
            BUCKETS.RESUMES,
            resumeFileId,
            undefined,
            [...new Set(permissions)]
        );
    } catch (error) {
        logger.error('Failed to update resume permissions for lead assignment:', error);
    }
}

export async function assignLeadAction(
    leadId: string,
    agentId: string,
    actorId: string,
    actorName: string
) {
    await assertAuthenticatedUserId(actorId);
    const { databases, storage } = await createAdminClient();

    try {
        const actorDoc = await databases.getDocument(
            DATABASE_ID,
            COLLECTIONS.USERS,
            actorId
        ) as unknown as User;

        const currentLead = await databases.getDocument(
            DATABASE_ID,
            COLLECTIONS.LEADS,
            leadId
        ) as unknown as Lead;

        if (
            !['admin', 'developer', 'team_lead', 'lead_generation'].includes(actorDoc.role)
        ) {
            throw new Error('Permission denied');
        }

        const agentDoc = await databases.getDocument(
            DATABASE_ID,
            COLLECTIONS.USERS,
            agentId
        ) as unknown as User;

        await assertAssignmentAllowed(actorDoc, agentDoc, currentLead, databases);

        const permissions: string[] = [
            Permission.read(Role.user(currentLead.ownerId)),
            Permission.update(Role.user(currentLead.ownerId)),
            Permission.delete(Role.user(currentLead.ownerId)),
        ];

        const ownerHierarchyPerms = await getHierarchyPermissionsServer(currentLead.ownerId, databases);
        permissions.push(...ownerHierarchyPerms);

        if (!currentLead.isClosed) {
            permissions.push(
                Permission.read(Role.user(agentId)),
                Permission.update(Role.user(agentId))
            );
        } else {
            permissions.push(Permission.read(Role.user(agentId)));
        }

        const assignedHierarchyPerms = await getHierarchyPermissionsServer(agentId, databases);
        permissions.push(...assignedHierarchyPerms);

        const lead = await databases.updateDocument(
            DATABASE_ID,
            COLLECTIONS.LEADS,
            leadId,
            {
                assignedToId: agentId,
            },
            permissions
        );

        if (actorDoc.role === 'lead_generation' && agentDoc.role === 'team_lead') {
            try {
                await recordLgHandoffAction({
                    leadId: leadId,
                    teamLeadId: agentId,
                    leadGenerationId: actorId,
                    branchId: currentLead.branchId ?? null,
                });
            } catch (handoffError) {
                logger.error('Failed to record LG handoff on assignment:', handoffError);
            }
        }

        await syncResumePermissionsForAssignment(currentLead, agentId, databases, storage);

        try {
            await databases.createDocument(
                DATABASE_ID,
                "",
                ID.unique(),
                {
                    action: 'LEAD_UPDATE',
                    actorId: actorId,
                    actorName: actorName,
                    targetId: leadId,
                    targetType: 'LEAD',
                    metadata: JSON.stringify({ assignedToId: agentId }),
                    createdAt: new Date().toISOString(),
                }
            );
        } catch (auditError) {
            // Non-blocking error
        }

        await createNotificationsForRecipients(
            databases,
            [agentId],
            {
                type: 'lead_assignment',
                title: 'Lead assigned',
                body: `Lead ${getLeadDisplayName(currentLead)} is assigned to you by ${actorName}.`,
                targetId: leadId,
                targetType: 'LEAD',
            }
        );

        return { success: true, lead: lead as unknown as Lead };
    } catch (error: unknown) {
        logger.error('Error assigning lead (server action):', error);
        throw new Error(error instanceof Error ? error.message : 'Failed to assign lead');
    }
}

export async function listLeadAssignableAgentsAction(
    leadId: string,
    actorId: string
): Promise<User[]> {
    await assertAuthenticatedUserId(actorId);
    const { databases } = await createAdminClient();

    const actorDoc = await databases.getDocument(
        DATABASE_ID,
        COLLECTIONS.USERS,
        actorId
    ) as unknown as User;

    const currentLead = await databases.getDocument(
        DATABASE_ID,
        COLLECTIONS.LEADS,
        leadId
    ) as unknown as Lead;

    const canListForLead =
        (actorDoc.role !== 'operations' && currentLead.ownerId === actorDoc.$id) ||
        ['admin', 'developer', 'team_lead'].includes(actorDoc.role);

    if (!canListForLead) {
        throw new Error('Permission denied');
    }

    const roleQuery = actorDoc.role === 'lead_generation'
        ? Query.equal('role', 'team_lead')
        : Query.equal('role', 'agent');

    const response = await databases.listDocuments(
        DATABASE_ID,
        COLLECTIONS.USERS,
        [
            roleQuery,
            Query.limit(5000),
        ]
    );

    return response.documents
        .map((doc: any) => ({
            $id: doc.$id,
            name: doc.name,
            email: doc.email,
            role: doc.role,
            teamLeadId: doc.teamLeadId || null,
            branchIds: doc.branchIds || [],
            branchId: doc.branchId || null,
            isActive: doc.isActive !== false,
            $createdAt: doc.$createdAt,
            $updatedAt: doc.$updatedAt,
        } as User))
        .filter((candidate) => candidate.isActive && candidate.$id !== actorId);
}
