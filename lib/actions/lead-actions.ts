'use server';

import { createAdminClient } from '@/lib/server/appwrite';
import { COLLECTIONS, DATABASE_ID } from '@/lib/constants/appwrite';
import { Permission, Role, ID } from 'node-appwrite';
import { Lead } from '@/lib/types';

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
    const { databases } = await createAdminClient();

    try {
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

        return { success: true, lead: lead as unknown as Lead };
    } catch (error: any) {
        console.error('Error assigning lead (server action):', error);
        throw new Error(error.message || 'Failed to assign lead');
    }
}
