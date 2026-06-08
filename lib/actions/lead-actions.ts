'use server';

import { createAdminClient } from '@/lib/server/appwrite';
import { createNotificationsForRecipients } from '@/lib/server/notifications';
import { BUCKETS, COLLECTIONS, DATABASE_ID } from '@/lib/constants/appwrite';
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

function getUserBranchIds(user: User): string[] {
    const branchIds = Array.isArray(user.branchIds) ? user.branchIds : [];
    return user.branchId && !branchIds.includes(user.branchId)
        ? [...branchIds, user.branchId]
        : branchIds;
}

function hasBranchOverlap(left: User, right: User): boolean {
    const leftBranchIds = new Set(getUserBranchIds(left));
    return getUserBranchIds(right).some((branchId) => leftBranchIds.has(branchId));
}

type HierarchyUserDocument = {
    $id: string;
    managerId?: string | null;
    managerIds?: string[];
    assistantManagerId?: string | null;
    assistantManagerIds?: string[];
    teamLeadId?: string | null;
};

function getVisibleHierarchyUserIds(viewerId: string, users: HierarchyUserDocument[]): string[] {
    const visibleIds = new Set<string>([viewerId]);
    let changed = true;

    while (changed) {
        changed = false;
        users.forEach((candidate) => {
            if (visibleIds.has(candidate.$id)) return;

            const managerIds = Array.isArray(candidate.managerIds) ? candidate.managerIds : [];
            const assistantManagerIds = Array.isArray(candidate.assistantManagerIds) ? candidate.assistantManagerIds : [];
            const reportsToVisibleManager =
                Boolean(candidate.managerId && visibleIds.has(candidate.managerId)) ||
                managerIds.some((managerId) => visibleIds.has(managerId));
            const reportsToVisibleAssistantManager =
                Boolean(candidate.assistantManagerId && visibleIds.has(candidate.assistantManagerId)) ||
                assistantManagerIds.some((assistantManagerId) => visibleIds.has(assistantManagerId));
            const reportsToVisibleTeamLead = Boolean(candidate.teamLeadId && visibleIds.has(candidate.teamLeadId));

            if (reportsToVisibleManager || reportsToVisibleAssistantManager || reportsToVisibleTeamLead) {
                visibleIds.add(candidate.$id);
                changed = true;
            }
        });
    }

    return Array.from(visibleIds);
}

async function getVisibleUserIdsForActor(actor: User, databases: AdminDatabases): Promise<string[]> {
    if (actor.role === 'admin' || actor.role === 'developer') return [];

    if (actor.role === 'team_lead') {
        const subordinates = await databases.listDocuments(
            DATABASE_ID,
            COLLECTIONS.USERS,
            [
                Query.equal('teamLeadId', actor.$id),
                Query.or([Query.equal('role', 'agent'), Query.equal('role', 'lead_generation')]),
                Query.limit(5000),
            ]
        );

        return [actor.$id, ...subordinates.documents.map((doc) => String(doc.$id))];
    }

    const users = await databases.listDocuments(
        DATABASE_ID,
        COLLECTIONS.USERS,
        [Query.limit(5000)]
    );

    return getVisibleHierarchyUserIds(actor.$id, users.documents as unknown as HierarchyUserDocument[]);
}

async function assertAssignmentAllowed(actor: User, agent: User, lead: Lead, databases: AdminDatabases) {
    if (actor.role === 'admin' || actor.role === 'developer') {
        return;
    }

    const actorOwnsLead = lead.ownerId === actor.$id;

    if (agent.role !== 'agent') {
        throw new Error('Leads can only be assigned to agents.');
    }

    if (actorOwnsLead) {
        if (agent.isActive === false) {
            throw new Error('Inactive agents cannot be assigned leads.');
        }
        return;
    }

    if (actor.role === 'team_lead') {
        if (agent.teamLeadId !== actor.$id) {
            throw new Error('Team leads can only assign agents under them.');
        }
    } else if ((actor.role === 'manager' || actor.role === 'assistant_manager') && !hasBranchOverlap(actor, agent)) {
        throw new Error('Permission denied');
    }

    const visibleUserIds = await getVisibleUserIdsForActor(actor, databases);
    const leadInScope =
        visibleUserIds.includes(lead.ownerId) ||
        (lead.assignedToId ? visibleUserIds.includes(lead.assignedToId) : false) ||
        Boolean(lead.branchId && getUserBranchIds(actor).includes(lead.branchId));

    if (!leadInScope) {
        throw new Error('Permission denied');
    }
}

async function assertLeadAccessAllowed(actor: User, lead: Lead, databases: AdminDatabases) {
    if (actor.role === 'monitor') {
        if (lead.ownerId === actor.$id) {
            return;
        }
        throw new Error('Permission denied');
    }

    if (actor.role === 'admin' || actor.role === 'developer') {
        return;
    }

    const visibleUserIds = await getVisibleUserIdsForActor(actor, databases);
    const leadInScope =
        visibleUserIds.includes(lead.ownerId) ||
        (lead.assignedToId ? visibleUserIds.includes(lead.assignedToId) : false) ||
        Boolean(lead.branchId && getUserBranchIds(actor).includes(lead.branchId));

    if (!leadInScope) {
        throw new Error('Permission denied');
    }
}

function getLeadResumeFileId(lead: Lead): string | null {
    try {
        const data = JSON.parse(lead.data) as { resumeFileId?: unknown };
        return typeof data.resumeFileId === 'string' && data.resumeFileId ? data.resumeFileId : null;
    } catch {
        return null;
    }
}

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
        console.error('Failed to update resume permissions for lead assignment:', error);
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
    const { databases, storage } = await createAdminClient();

    try {
        const actorDoc = await databases.getDocument(
            DATABASE_ID,
            COLLECTIONS.USERS,
            actorId
        ) as unknown as User;

        // Get the current lead to check owner and status
        const currentLead = await databases.getDocument(
            DATABASE_ID,
            COLLECTIONS.LEADS,
            leadId
        ) as unknown as Lead;

        if (
            !['admin', 'developer', 'manager', 'assistant_manager', 'team_lead'].includes(actorDoc.role) &&
            currentLead.ownerId !== actorDoc.$id
        ) {
            throw new Error('Permission denied');
        }

        const agentDoc = await databases.getDocument(
            DATABASE_ID,
            COLLECTIONS.USERS,
            agentId
        ) as unknown as User;

        await assertAssignmentAllowed(actorDoc, agentDoc, currentLead, databases);

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

        await syncResumePermissionsForAssignment(currentLead, agentId, databases, storage);

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
        currentLead.ownerId === actorDoc.$id ||
        ['admin', 'developer', 'manager', 'assistant_manager', 'team_lead'].includes(actorDoc.role);

    if (!canListForLead) {
        throw new Error('Permission denied');
    }

    const response = await databases.listDocuments(
        DATABASE_ID,
        COLLECTIONS.USERS,
        [
            Query.equal('role', 'agent'),
            Query.limit(5000),
        ]
    );

    return response.documents
        .map((doc: any) => ({
            $id: doc.$id,
            name: doc.name,
            email: doc.email,
            role: doc.role,
            managerId: doc.managerId || null,
            managerIds: doc.managerIds || [],
            assistantManagerId: doc.assistantManagerId || null,
            assistantManagerIds: doc.assistantManagerIds || [],
            teamLeadId: doc.teamLeadId || null,
            branchIds: doc.branchIds || [],
            branchId: doc.branchId || null,
            isActive: doc.isActive !== false,
            $createdAt: doc.$createdAt,
            $updatedAt: doc.$updatedAt,
        } as User))
        .filter((candidate) => candidate.isActive && candidate.$id !== actorId);
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

  const unassignedOwnerId =
    process.env.NEXT_PUBLIC_APPWRITE_UNASSIGNED_OWNER_ID ||
    process.env.APPWRITE_UNASSIGNED_OWNER_ID ||
    "";
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
  const updated = await databases.updateDocument(
    DATABASE_ID,
    COLLECTIONS.LEADS,
    leadId,
    {
      ownerId: unassignedOwnerId,
      assignedToId: unassignedOwnerId,
      isClosed: true,
      closedAt: nowIso,
      status: "Backed Out",
    },
    [...new Set(permissions)],
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
        assignedToId: unassignedOwnerId,
        isClosed: true,
        closedAt: nowIso,
      }),
      performedAt: nowIso,
    });
  } catch {}

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

  const unassignedOwnerId =
    process.env.NEXT_PUBLIC_APPWRITE_UNASSIGNED_OWNER_ID ||
    process.env.APPWRITE_UNASSIGNED_OWNER_ID ||
    "";
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
  const updated = await databases.updateDocument(
    DATABASE_ID,
    COLLECTIONS.LEADS,
    leadId,
    {
      ownerId: unassignedOwnerId,
      assignedToId: unassignedOwnerId,
      isClosed: true,
      closedAt: nowIso,
      status: "Not Interested",
    },
    [...new Set(permissions)],
  );

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
        assignedToId: unassignedOwnerId,
        isClosed: true,
        closedAt: nowIso,
      }),
      performedAt: nowIso,
    });
  } catch {}

  return { success: true, lead: updated as unknown as Lead };
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

        if (actorDoc?.role === 'monitor' && currentLead.ownerId !== actorDoc.$id) {
            throw new Error('Permission denied');
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
                            branchId: currentLead.branchId,
                            closedAt: lead.closedAt,
                            changes: {
                                status: { from: currentLead.status, to: closedStatus },
                                isClosed: { from: false, to: true },
                            },
                        }),
                        performedAt: new Date().toISOString(),
                    }
                );
            } catch (auditErr) {
                // Ignore audit log failure
            }
        }

        return { success: true, lead: lead as unknown as Lead };
    } catch (error: unknown) {
        console.error('Error closing lead (action):', error);
        throw new Error(error instanceof Error ? error.message : 'Failed to close lead');
    }
}
