'use server';

import { createAdminClient } from '@/lib/server/appwrite';
import { createNotificationsForRecipients } from '@/lib/server/notifications';
import { COLLECTIONS, DATABASE_ID } from '@/lib/constants/appwrite';
import { Permission, Role, ID, Query } from 'node-appwrite';
import { Lead, LinkedinRequest, User } from '@/lib/types';
import { assertAuthenticatedUserId } from '@/lib/server/current-user';
import { assertLeadAccessAllowed, getHierarchyPermissionsServer } from './visibility';
import { getUnassignedOwnerId, getLeadLinkedinRequestId, resolveBranchIdForEvent, getLeadDisplayName } from './utils';
import { logger } from '@/lib/utils/logger';

type AdminDatabases = Awaited<ReturnType<typeof createAdminClient>>['databases'];

async function syncLinkedinRequestAfterLeadClosure(
    lead: Lead,
    outcome: 'Backed Out' | 'Not Interested',
    actorId: string,
    actorName: string,
    databases: AdminDatabases,
    occurredAt: string,
) {
    const requestId = getLeadLinkedinRequestId(lead);
    if (!requestId) return;

    try {
        const request = await databases.getDocument(
            DATABASE_ID,
            COLLECTIONS.LINKEDIN_REQUESTS,
            requestId,
        ) as unknown as LinkedinRequest;

        if (outcome === 'Not Interested') {
            await databases.updateDocument(
                DATABASE_ID,
                COLLECTIONS.LINKEDIN_REQUESTS,
                requestId,
                {
                    status: 'sent',
                    isActive: true,
                    leadId: null,
                    acceptedAt: null,
                    withdrawnAt: null,
                },
            );

            await databases.createDocument(DATABASE_ID, COLLECTIONS.AUDIT_LOGS, ID.unique(), {
                action: 'LINKEDIN_REQUEST_REOPEN',
                actorId,
                actorName,
                targetId: requestId,
                targetType: 'linkedin_request',
                metadata: JSON.stringify({
                    leadId: lead.$id,
                    targetUrl: request.targetUrl,
                    company: request.company,
                    reason: `Lead marked as ${outcome}`,
                    reopenedAt: occurredAt,
                    source: 'lead_status_sync',
                }),
                createdAt: occurredAt,
            });

            try {
                await databases.createDocument(DATABASE_ID, COLLECTIONS.CHAT_MESSAGES, ID.unique(), {
                    channel: 'general',
                    body: `Linkedin URL available again: ${request.targetUrl} (${request.company}) lead was marked as Not Interested by ${actorName}. Another agent can try this URL.`,
                    createdById: actorId,
                    createdByName: actorName,
                    createdAt: occurredAt,
                });
            } catch {}

            return;
        }

        await databases.updateDocument(
            DATABASE_ID,
            COLLECTIONS.LINKEDIN_REQUESTS,
            requestId,
            {
                status: 'withdrawn',
                isActive: false,
                withdrawnAt: occurredAt,
            },
        );

        await databases.createDocument(DATABASE_ID, COLLECTIONS.AUDIT_LOGS, ID.unique(), {
            action: 'LINKEDIN_REQUEST_WITHDRAW',
            actorId,
            actorName,
            targetId: requestId,
            targetType: 'linkedin_request',
            metadata: JSON.stringify({
                leadId: lead.$id,
                targetUrl: request.targetUrl,
                company: request.company,
                reason: `Lead marked as ${outcome}`,
                withdrawnAt: occurredAt,
                source: 'lead_status_sync',
            }),
            createdAt: occurredAt,
        });
    } catch (error) {
        logger.error(`Failed to sync Linkedin request for lead ${lead.$id}:`, error);
    }
}

export async function backoutLeadAction(
  leadId: string,
  actorId: string,
  actorName: string,
) {
  await assertAuthenticatedUserId(actorId);
  const { databases } = await createAdminClient();

  const actorDoc = (await databases.getDocument(
    DATABASE_ID,
    COLLECTIONS.USERS,
    actorId,
  )) as unknown as User;

  const currentLead = (await databases.getDocument(
    DATABASE_ID,
    COLLECTIONS.LEADS,
    leadId,
  )) as unknown as Lead;

  await assertLeadAccessAllowed(actorDoc, currentLead, databases);

  const unassignedOwnerId = getUnassignedOwnerId();
  if (!unassignedOwnerId) {
    throw new Error("Missing unassigned owner user id (APPWRITE_UNASSIGNED_OWNER_ID).");
  }

  const permissions: string[] = [
    Permission.read(Role.user(unassignedOwnerId)),
    Permission.update(Role.user(unassignedOwnerId)),
    Permission.delete(Role.user(unassignedOwnerId)),
    Permission.read(Role.label("admin")),
    Permission.update(Role.label("admin")),
    Permission.delete(Role.label("admin")),
    Permission.read(Role.user(actorId)),
  ];

  const hierarchyPerms = await getHierarchyPermissionsServer(unassignedOwnerId, databases);
  permissions.push(...hierarchyPerms);

  const nowIso = new Date().toISOString();
  let updatedDataJson = currentLead.data;
  try {
    const leadData = JSON.parse(currentLead.data);
    if (!leadData.creatorId) {
      leadData.creatorId = currentLead.ownerId;
      updatedDataJson = JSON.stringify(leadData);
    }
  } catch {}

  const updated = await databases.updateDocument(
    DATABASE_ID,
    COLLECTIONS.LEADS,
    leadId,
    {
      ownerId: unassignedOwnerId,
      isClosed: true,
      closedAt: nowIso,
      status: "Backed Out",
      data: updatedDataJson,
    },
    [...new Set(permissions)],
  );

  await syncLinkedinRequestAfterLeadClosure(
    currentLead,
    "Backed Out",
    actorId,
    actorName,
    databases,
    nowIso,
  );

  try {
    await databases.createDocument(DATABASE_ID, COLLECTIONS.AUDIT_LOGS, ID.unique(), {
      action: "LEAD_UPDATE",
      actorId,
      actorName,
      targetId: leadId,
      targetType: "LEAD",
      metadata: JSON.stringify({
        status: "Backed Out",
        ownerId: unassignedOwnerId,
        assignedToId: currentLead.assignedToId ?? null,
        isClosed: true,
        closedAt: nowIso,
      }),
      createdAt: nowIso,
    });
  } catch {}

  try {
    const leadDataObj = JSON.parse(currentLead.data || "{}");
    const clientName = `${leadDataObj.firstName || ""} ${leadDataObj.lastName || ""}`.trim() || "A lead";
    
    await databases.createDocument(DATABASE_ID, COLLECTIONS.CHAT_MESSAGES, ID.unique(), {
      channel: 'general',
      body: `📉 ${actorName} marked lead **${clientName}** as Backed Out.`,
      createdById: 'system',
      createdByName: 'System',
      createdAt: nowIso,
    });

    const recipients = Array.from(new Set([currentLead.ownerId, currentLead.assignedToId, actorDoc.teamLeadId].filter(Boolean) as string[]));
    const otherRecipients = recipients.filter(id => id !== actorId);
    
    if (otherRecipients.length > 0) {
      await createNotificationsForRecipients(databases, otherRecipients, {
        type: 'lead_backed_out',
        title: 'Lead Backed Out',
        body: `${actorName} marked ${clientName} as Backed Out.`,
        targetId: leadId,
        targetType: 'LEAD',
      });
    }
  } catch (err) {
    logger.error("Failed to send chat/notifications for Backout event:", err);
  }

  return { success: true, lead: updated as unknown as Lead };
}

export async function notInterestedLeadAction(
  leadId: string,
  actorId: string,
  actorName: string,
) {
  await assertAuthenticatedUserId(actorId);
  const { databases } = await createAdminClient();

  const actorDoc = (await databases.getDocument(
    DATABASE_ID,
    COLLECTIONS.USERS,
    actorId,
  )) as unknown as User;

  const currentLead = (await databases.getDocument(
    DATABASE_ID,
    COLLECTIONS.LEADS,
    leadId,
  )) as unknown as Lead;

  await assertLeadAccessAllowed(actorDoc, currentLead, databases);

  const unassignedOwnerId = getUnassignedOwnerId();
  if (!unassignedOwnerId) {
    throw new Error("Missing unassigned owner user id (APPWRITE_UNASSIGNED_OWNER_ID).");
  }

  const permissions: string[] = [
    Permission.read(Role.user(unassignedOwnerId)),
    Permission.update(Role.user(unassignedOwnerId)),
    Permission.delete(Role.user(unassignedOwnerId)),
    Permission.read(Role.label("admin")),
    Permission.update(Role.label("admin")),
    Permission.delete(Role.label("admin")),
    Permission.read(Role.user(actorId)),
  ];

  const hierarchyPerms = await getHierarchyPermissionsServer(unassignedOwnerId, databases);
  permissions.push(...hierarchyPerms);

  const nowIso = new Date().toISOString();
  let updatedDataJson = currentLead.data;
  try {
    const leadData = JSON.parse(currentLead.data);
    if (!leadData.creatorId) {
      leadData.creatorId = currentLead.ownerId;
      updatedDataJson = JSON.stringify(leadData);
    }
  } catch {}

  const updated = await databases.updateDocument(
    DATABASE_ID,
    COLLECTIONS.LEADS,
    leadId,
    {
      ownerId: unassignedOwnerId,
      assignedToId: null,
      isClosed: true,
      closedAt: nowIso,
      status: "Not Interested",
      data: updatedDataJson,
    },
    [...new Set(permissions)],
  );

  await syncLinkedinRequestAfterLeadClosure(
    currentLead,
    "Not Interested",
    actorId,
    actorName,
    databases,
    nowIso,
  );

  await markPriorNotInterestedRowsReopened(leadId, actorId, databases, nowIso);

  try {
    await databases.createDocument(DATABASE_ID, COLLECTIONS.NOT_INTERESTED_LEADS, ID.unique(), {
      leadId,
      markedById: actorId,
      markedByName: actorName,
      markedAt: nowIso,
      previousOwnerId: currentLead.ownerId,
      previousAssignedToId: currentLead.assignedToId ?? null,
      branchId: resolveBranchIdForEvent(currentLead),
      reason: null,
      status: "active",
    });
  } catch (err) {
    logger.error("Failed to write not_interested_leads event:", err);
  }

  try {
    await databases.createDocument(DATABASE_ID, COLLECTIONS.AUDIT_LOGS, ID.unique(), {
      action: "LEAD_UPDATE",
      actorId,
      actorName,
      targetId: leadId,
      targetType: "LEAD",
      metadata: JSON.stringify({
        status: "Not Interested",
        ownerId: unassignedOwnerId,
        assignedToId: null,
        isClosed: true,
        closedAt: nowIso,
      }),
      createdAt: nowIso,
    });
  } catch {}

  try {
    const leadDataObj = JSON.parse(currentLead.data || "{}");
    const clientName = `${leadDataObj.firstName || ""} ${leadDataObj.lastName || ""}`.trim() || "A lead";
    
    await databases.createDocument(DATABASE_ID, COLLECTIONS.CHAT_MESSAGES, ID.unique(), {
      channel: 'general',
      body: `❌ ${actorName} marked lead **${clientName}** as Not Interested.`,
      createdById: 'system',
      createdByName: 'System',
      createdAt: nowIso,
    });

    const recipients = Array.from(new Set([currentLead.ownerId, currentLead.assignedToId, actorDoc.teamLeadId].filter(Boolean) as string[]));
    const otherRecipients = recipients.filter(id => id !== actorId);
    
    if (otherRecipients.length > 0) {
      await createNotificationsForRecipients(databases, otherRecipients, {
        type: 'lead_not_interested',
        title: 'Lead Not Interested',
        body: `${actorName} marked ${clientName} as Not Interested.`,
        targetId: leadId,
        targetType: 'LEAD',
      });
    }
  } catch (err) {
    logger.error("Failed to send chat/notifications for Not Interested event:", err);
  }

  return { success: true, lead: updated as unknown as Lead };
}

export async function markPriorNotInterestedRowsReopened(
  leadId: string,
  actorId: string,
  databases: AdminDatabases,
  nowIso: string,
): Promise<void> {
  try {
    const activeRows = (await databases.listDocuments(
      DATABASE_ID,
      COLLECTIONS.NOT_INTERESTED_LEADS,
      [
        Query.equal("leadId", leadId),
        Query.equal("status", "active"),
        Query.limit(25),
      ],
    )).documents as Array<{ $id: string }>;

    await Promise.all(
      activeRows.map((row) =>
        databases
          .updateDocument(DATABASE_ID, COLLECTIONS.NOT_INTERESTED_LEADS, row.$id, {
            status: "reopened",
            reopenedAt: nowIso,
            reopenedById: actorId,
          })
          .catch((err) => {
            logger.error(`Failed to reopen not_interested row ${row.$id}:`, err);
          }),
      ),
    );
  } catch (err) {
    logger.error("Failed to list active not_interested rows for lead", leadId, err);
  }
}

export async function closeLeadAction(
    leadId: string,
    closedStatus: string,
    actorId: string,
    actorName: string,
    actorRole?: import('@/lib/types').UserRole
) {
    await assertAuthenticatedUserId(actorId);
    const { databases } = await createAdminClient();

    try {
        const currentLead = await databases.getDocument(
            DATABASE_ID,
            COLLECTIONS.LEADS,
            leadId
        ) as unknown as Lead;

        const actorDoc = actorId
            ? await databases.getDocument(
                DATABASE_ID,
                COLLECTIONS.USERS,
                actorId
            ) as unknown as User
            : null;

        if (actorDoc?.role === 'operations') {
            throw new Error('Permission denied');
        }

        if (actorDoc?.role === 'monitor') {
            if (actorId !== currentLead.ownerId && actorId !== currentLead.assignedToId) {
                throw new Error('Permission denied');
            }
        }


        const shouldAssignClosingAgent =
            actorRole === 'agent' && Boolean(actorId) && !currentLead.assignedToId;
        const nextAssignedToId = shouldAssignClosingAgent ? actorId : currentLead.assignedToId;

        const permissions: string[] = [
            Permission.read(Role.user(currentLead.ownerId)),
            Permission.update(Role.user(currentLead.ownerId)),
            Permission.delete(Role.user(currentLead.ownerId)),
        ];

        if (nextAssignedToId) {
            permissions.push(Permission.read(Role.user(nextAssignedToId)));
        }

        if (actorId && actorId !== currentLead.ownerId && actorId !== nextAssignedToId) {
            permissions.push(Permission.read(Role.user(actorId)));
        }

        const hierarchyPerms = await getHierarchyPermissionsServer(currentLead.ownerId, databases);
        permissions.push(...hierarchyPerms);

        if (nextAssignedToId) {
            const assignedHierarchyPerms = await getHierarchyPermissionsServer(nextAssignedToId, databases);
            permissions.push(...assignedHierarchyPerms);
        }

        const lead = await databases.updateDocument(
            DATABASE_ID,
            COLLECTIONS.LEADS,
            leadId,
            {
                isClosed: true,
                closedAt: new Date().toISOString(),
                status: closedStatus,
                ...(shouldAssignClosingAgent ? { assignedToId: actorId } : {}),
            },
            [...new Set(permissions)]
        );

        if (actorId && actorName) {
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
                        metadata: JSON.stringify({
                            isClosed: true,
                            status: closedStatus,
                            leadId,
                            leadName: getLeadDisplayName(currentLead),
                            ownerId: currentLead.ownerId,
                            assignedToId: currentLead.assignedToId,
                            branchId: currentLead.branchId ?? null,
                            closedAt: lead.closedAt,
                            changes: {
                                status: { from: currentLead.status, to: closedStatus },
                                isClosed: { from: false, to: true },
                            },
                        }),
                        createdAt: new Date().toISOString(),
                    }
                );
            } catch (auditErr) {
                // Ignore audit log failure
            }
        }

        return { success: true, lead: lead as unknown as Lead };
    } catch (error: unknown) {
        logger.error('Error closing lead (action):', error);
        throw new Error(error instanceof Error ? error.message : 'Failed to close lead');
    }
}
