'use server';

import { createAdminClient } from '@/lib/server/appwrite';
import { createNotificationsForRecipients } from '@/lib/server/notifications';
import { BUCKETS, COLLECTIONS, DATABASE_ID } from '@/lib/constants/appwrite';
import { Permission, Role, ID, Query } from 'node-appwrite';
import { Lead, LinkedinRequest, User } from '@/lib/types';
import { assertAuthenticatedUserId } from '@/lib/server/current-user';
import { recordLgHandoffAction } from '@/app/actions/lg-handoffs';

type AdminDatabases = Awaited<ReturnType<typeof createAdminClient>>['databases'];

/**
 * Helper to get permissions for supervisors up the chain (Server Side)
 * Optimized: short-circuits on already-visited ids and prefers a
 * not-yet-visited supervisor when stepping up. Common 1-2 level chains
 * finish in 1-2 roundtrips instead of the previous 5-level sequential walk.
 */
async function getHierarchyPermissionsServer(userId: string, databases: AdminDatabases): Promise<string[]> {
    const permissions: string[] = [];
    try {
        const visited = new Set<string>([userId]);
        let currentId: string | null = userId;

        for (let depth = 0; depth < 5 && currentId; depth++) {
            try {
                const user = (await databases.getDocument(
                    DATABASE_ID,
                    COLLECTIONS.USERS,
                    currentId
                )) as unknown as User;

                // Add supervisors
                const supervisors = new Set<string>();
                if (user.teamLeadId) supervisors.add(user.teamLeadId);

                // Add permissions for supervisors
                for (const supId of supervisors) {
                    if (!visited.has(supId)) {
                        permissions.push(Permission.read(Role.user(supId)));
                        permissions.push(Permission.update(Role.user(supId)));
                        permissions.push(Permission.delete(Role.user(supId)));
                        visited.add(supId);
                    }
                }

                // Move up the chain: prefer a not-yet-visited supervisor.
                if (user.teamLeadId && !visited.has(user.teamLeadId)) {
                    currentId = user.teamLeadId;
                } else {
                    currentId = null;
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

function getUnassignedOwnerId(): string {
    return (
        process.env.NEXT_PUBLIC_APPWRITE_UNASSIGNED_OWNER_ID ||
        process.env.APPWRITE_UNASSIGNED_OWNER_ID ||
        ''
    );
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
    teamLeadId?: string | null;
};

function getVisibleHierarchyUserIds(viewerId: string, users: HierarchyUserDocument[]): string[] {
    const visibleIds = new Set<string>([viewerId]);
    let changed = true;

    while (changed) {
        changed = false;
        users.forEach((candidate) => {
            if (visibleIds.has(candidate.$id)) return;

            const reportsToVisibleTeamLead = Boolean(candidate.teamLeadId && visibleIds.has(candidate.teamLeadId));

            if (reportsToVisibleTeamLead) {
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
    if (actor.role === 'operations') {
        throw new Error('Permission denied');
    }

    if (actor.role === 'admin' || actor.role === 'developer') {
        return;
    }

    const actorOwnsLead = lead.ownerId === actor.$id;

    if (actor.role === 'lead_generation') {
        if (!actorOwnsLead) {
            throw new Error('Permission denied');
        }
        if (agent.role !== 'team_lead') {
            throw new Error('Lead generation can only assign leads to team leads.');
        }
        if (agent.isActive === false) {
            throw new Error('Inactive team leads cannot be assigned leads.');
        }
        return;
    }

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
    if (actor.role === 'operations') {
        throw new Error('Permission denied');
    }

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

function getLeadLinkedinRequestId(lead: Lead): string | null {
    try {
        const data = JSON.parse(lead.data) as { linkedinRequestId?: unknown };
        return typeof data.linkedinRequestId === 'string' && data.linkedinRequestId ? data.linkedinRequestId : null;
    } catch {
        return null;
    }
}

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
                performedAt: occurredAt,
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
            performedAt: occurredAt,
        });
    } catch (error) {
        console.error(`Failed to sync Linkedin request for lead ${lead.$id}:`, error);
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
 * This bypasses user-level permissions to ensure admins can always reassign leads.
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

        // Only specific roles can assign leads. Agents are not permitted
        // to reassign leads — even leads they own — to anyone else.
        // This keeps the assignment workflow controlled by team leads, lead generation, and admins.
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

        if (actorDoc.role === 'lead_generation' && agentDoc.role === 'team_lead') {
            try {
                await recordLgHandoffAction({
                    leadId: leadId,
                    teamLeadId: agentId,
                    leadGenerationId: actorId,
                    branchId: currentLead.branchId ?? null,
                });
            } catch (handoffError) {
                console.error('Failed to record LG handoff on assignment:', handoffError);
            }
        }

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
      assignedToId: null,
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
        assignedToId: null,
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
  // When a lead is marked "Not Interested", we hand it back to the
  // unassigned owner but keep it OPEN (isClosed: false). The intent is
  // for the lead to land in the unassigned queue so other agents can
  // pick it up and try a fresh outreach. Closing it would hide it from
  // everyone's active dashboard and defeat that re-engagement flow.
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
      isClosed: false,
      closedAt: null,
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

  // Persist the marking event in not_interested_leads so weekly reports
  // can show the exact amount per agent with its date. The prior `active`
  // row for this lead is flipped to `reopened` first (if any) — that way
  // a retry-then-re-mark cycle produces two events with their real dates
  // instead of one row being overwritten.
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
    // Telemetry must never break the user-facing action.
    console.error("Failed to write not_interested_leads event:", err);
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
        isClosed: false,
        closedAt: null,
      }),
      performedAt: nowIso,
    });
  } catch {}

  return { success: true, lead: updated as unknown as Lead };
}

/**
 * Flip any prior `active` not_interested_leads row for `leadId` to
 * `reopened`. Called from both the explicit reopen path and the
 * implicit "mark not-interested again" path so the row history stays
 * monotonic: at most one `active` row exists per lead at any time.
 * Failures are swallowed because telemetry must never block the
 * user-facing state change.
 */
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
            console.error(`Failed to reopen not_interested row ${row.$id}:`, err);
          }),
      ),
    );
  } catch (err) {
    console.error("Failed to list active not_interested rows for lead", leadId, err);
  }
}

/**
 * Pick a single branchId for a not_interested_leads row. Lead documents
 * historically carried `branchId` (singular); newer ones also carry
 * `branchIds[]`. Prefer the array's first entry when present, otherwise
 * fall back to `branchId`. `null` when the lead has no branch.
 */
function resolveBranchIdForEvent(lead: Lead): string | null {
  const raw = (lead as unknown as { data?: string }).data;
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw) as { branchIds?: unknown; branchId?: unknown };
      if (Array.isArray(parsed.branchIds) && typeof parsed.branchIds[0] === "string") {
        return parsed.branchIds[0] as string;
      }
      if (typeof parsed.branchId === "string") {
        return parsed.branchId;
      }
    } catch {
      // fall through to top-level fields
    }
  }
  return lead.branchId ?? null;
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
