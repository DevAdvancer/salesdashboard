'use server';

import { createAdminClient } from "@/lib/server/appwrite";
import { getAppwriteErrorMessage } from "@/lib/server/appwrite-errors";
import { Lead, LeadData, LeadListFilters, UserRole, CreateLeadInput } from "@/lib/types";
import { Query, ID, Permission, Role } from "node-appwrite";
import { COLLECTIONS } from "@/lib/constants/appwrite";
import { getSpecialBranchLeadAccess } from '@/lib/constants/special-lead-access';
import { logAction } from "@/lib/services/audit-service";
import { assertAuthenticatedUserId } from "@/lib/server/current-user";
import { createNotificationsForRecipients } from "@/lib/server/notifications";

const DATABASE_ID = process.env.NEXT_PUBLIC_APPWRITE_DATABASE_ID!;
const LEADS_COLLECTION_ID = process.env.NEXT_PUBLIC_APPWRITE_LEADS_COLLECTION_ID!;
const USERS_COLLECTION_ID = process.env.NEXT_PUBLIC_APPWRITE_USERS_COLLECTION_ID!;

// Helper to validate Appwrite ID format
function isValidId(id: string | null | undefined): boolean {
    if (!id) return false;
    const validIdPattern = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,35}$/;
    return validIdPattern.test(id);
}

// Server-side lead uniqueness validation
async function validateLeadUniqueness(
    data: LeadData,
    excludeLeadId?: string
): Promise<{ isValid: boolean; duplicateField?: string; existingLeadId?: string; existingBranchId?: string }> {
    const { databases } = await createAdminClient();
    const email = data.email as string | undefined;
    const phone = data.phone as string | undefined;

    if (email) {
        const queries = [Query.contains('data', [email])];
        const response = await databases.listDocuments(DATABASE_ID, LEADS_COLLECTION_ID, queries);
        for (const doc of response.documents) {
            if (excludeLeadId && doc.$id === excludeLeadId) continue;
            try {
                const leadData = JSON.parse(doc.data as string) as LeadData;
                if (leadData.email === email) {
                    return {
                        isValid: false,
                        duplicateField: 'email',
                        existingLeadId: doc.$id,
                        existingBranchId: (doc.branchId as string) || undefined,
                    };
                }
            } catch {}
        }
    }

    if (phone) {
        const queries = [Query.contains('data', [phone])];
        const response = await databases.listDocuments(DATABASE_ID, LEADS_COLLECTION_ID, queries);
        for (const doc of response.documents) {
            if (excludeLeadId && doc.$id === excludeLeadId) continue;
            try {
                const leadData = JSON.parse(doc.data as string) as LeadData;
                if (leadData.phone === phone) {
                    return {
                        isValid: false,
                        duplicateField: 'phone',
                        existingLeadId: doc.$id,
                        existingBranchId: (doc.branchId as string) || undefined,
                    };
                }
            } catch {}
        }
    }

    return { isValid: true };
}

// Helper to get hierarchy permissions (server-side)
async function getHierarchyPermissions(userId: string): Promise<string[]> {
    const permissions: string[] = [];
    try {
        const { databases } = await createAdminClient();
        let currentId = userId;
        const visited = new Set<string>();

        while (currentId && !visited.has(currentId) && visited.size < 5) {
            if (!isValidId(currentId)) break;
            visited.add(currentId);

            try {
                const user = await databases.getDocument(DATABASE_ID, USERS_COLLECTION_ID, currentId);
                const supervisors = new Set<string>();
                if (user.teamLeadId) supervisors.add(user.teamLeadId);
                if (user.managerId) supervisors.add(user.managerId);
                if (user.managerIds && user.managerIds.length > 0) {
                    user.managerIds.forEach((mid: string) => supervisors.add(mid));
                }

                for (const supId of supervisors) {
                    if (!visited.has(supId) && isValidId(supId)) {
                        permissions.push(Permission.read(Role.user(supId)));
                        permissions.push(Permission.update(Role.user(supId)));
                        permissions.push(Permission.delete(Role.user(supId)));
                    }
                }

                if (user.teamLeadId) currentId = user.teamLeadId;
                else if (user.managerId) currentId = user.managerId;
                else if (user.managerIds && user.managerIds.length > 0) currentId = user.managerIds[0];
                else break;
            } catch (e) {
                break;
            }
        }
    } catch (e) {
        console.error('Error fetching hierarchy permissions:', e);
    }
    return permissions;
}

type HierarchyUserDocument = {
  $id: string;
  managerId?: string | null;
  managerIds?: string[];
  assistantManagerId?: string | null;
  assistantManagerIds?: string[];
  teamLeadId?: string | null;
};

function getVisibleHierarchyUserIds(viewerId: string, viewerRole: UserRole, users: HierarchyUserDocument[]): string[] {
  if (viewerRole === 'agent') return [viewerId];

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

async function getLeadVisibilityUserIds(databases: any, viewerId: string, viewerRole: UserRole): Promise<string[]> {
  if (viewerRole === 'agent') return [viewerId];

  if (viewerRole === 'team_lead') {
    const agents = await databases.listDocuments(
      DATABASE_ID,
      COLLECTIONS.USERS,
      [
        Query.equal('teamLeadId', viewerId),
        Query.or([Query.equal('role', 'agent'), Query.equal('role', 'lead_generation')]),
      ]
    );

    return [viewerId, ...agents.documents.map((agent: { $id: string }) => agent.$id)];
  }

  const response = await databases.listDocuments(
    DATABASE_ID,
    COLLECTIONS.USERS,
    [Query.limit(5000)]
  );

  return getVisibleHierarchyUserIds(viewerId, viewerRole, response.documents as HierarchyUserDocument[]);
}

function appendHierarchyLeadVisibilityQuery(
  queries: string[],
  visibleUserIds: string[],
  specialBranchId?: string | null,
  branchIds?: string[],
  includeBackedOutForBranches?: boolean,
) {
  const orConditions = [
    Query.equal('ownerId', visibleUserIds),
    Query.equal('assignedToId', visibleUserIds),
  ];

  if (specialBranchId) {
    orConditions.push(Query.equal('branchId', specialBranchId));
  }

  if (includeBackedOutForBranches && branchIds && branchIds.length > 0) {
    orConditions.push(
      Query.and([
        Query.equal('branchId', branchIds),
        Query.equal('isClosed', true),
        Query.equal('status', ['Backout', 'Backed Out', 'Backedout', 'Backed out']),
      ]),
    );
  }

  queries.push(Query.or(orConditions));
}

type UserDocument = {
  $id: string;
  email?: string;
  role: UserRole;
  branchIds?: string[];
  branchId?: string | null;
};

async function assertLeadReopenAllowed(
  databases: Awaited<ReturnType<typeof createAdminClient>>['databases'],
  actorDoc: UserDocument,
  lead: Lead
) {
  if (actorDoc.role === 'admin') return;

  if (actorDoc.role !== 'manager' && actorDoc.role !== 'team_lead') {
    throw new Error('Permission denied');
  }

  const specialBranchId = getSpecialBranchLeadAccess(actorDoc.email);
  if (specialBranchId && lead.branchId === specialBranchId) return;

  const visibleUserIds = await getLeadVisibilityUserIds(databases, actorDoc.$id, actorDoc.role);
  if (
    visibleUserIds.includes(lead.ownerId) ||
    (lead.assignedToId ? visibleUserIds.includes(lead.assignedToId) : false)
  ) {
    return;
  }

  throw new Error('Permission denied');
}

export async function createLeadAction(
    ownerId: string,
    input: CreateLeadInput,
    creatingUserId?: string,
    creatingUserName?: string
): Promise<Lead> {
    try {
        await assertAuthenticatedUserId(creatingUserId || ownerId);
        const { databases } = await createAdminClient();

        // Validate uniqueness
        const validation = await validateLeadUniqueness(input.data);
        if (!validation.isValid) {
            throw new Error(
                `Duplicate ${validation.duplicateField} found in lead ${validation.existingLeadId}` +
                (validation.existingBranchId ? ` (branch: ${validation.existingBranchId})` : '')
            );
        }

        const finalOwnerId = creatingUserId || ownerId;
        if (!isValidId(finalOwnerId)) {
             throw new Error(`Invalid owner ID format: "${finalOwnerId}"`);
        }

        const dataJson = JSON.stringify(input.data);

        // Permissions
        const permissions: string[] = [
            Permission.read(Role.user(finalOwnerId)),
            Permission.update(Role.user(finalOwnerId)),
            Permission.delete(Role.user(finalOwnerId)),
        ];

        // Add hierarchy permissions
        const hierarchyPerms = await getHierarchyPermissions(finalOwnerId);
        permissions.push(...hierarchyPerms);

        // Assigned agent permissions
        if (input.assignedToId) {
             if (isValidId(input.assignedToId)) {
                 permissions.push(
                     Permission.read(Role.user(input.assignedToId)),
                     Permission.update(Role.user(input.assignedToId))
                 );
                 // Add assigned agent's managers too
                 const assignedHierarchyPerms = await getHierarchyPermissions(input.assignedToId);
                 permissions.push(...assignedHierarchyPerms);
             }
        }

        // Remove duplicates in permissions
        const uniquePermissions = [...new Set(permissions)];

        const lead = await databases.createDocument(
            DATABASE_ID,
            LEADS_COLLECTION_ID,
            ID.unique(),
            {
                data: dataJson,
                status: input.status || 'New',
                ownerId: finalOwnerId,
                assignedToId: input.assignedToId || null,
                branchId: input.branchId || null,
                isClosed: false,
                closedAt: null,
            },
            uniquePermissions
        );

        // Log Audit
        // Note: logAction is a client-side service wrapper usually?
        // Wait, logAction in 'audit-service' uses databases.createDocument.
        // If we import it from '@/lib/services/audit-service', it might use client SDK.
        // We should reimplement simplified logging here or ensure audit-service works on server.
        // For now, let's skip audit log or assume it works if env vars are same.
        // Actually, better to implement logging here using Admin Client to be safe.

        try {
            if (creatingUserName) {
                 await databases.createDocument(
                     DATABASE_ID,
                     process.env.NEXT_PUBLIC_APPWRITE_AUDIT_LOGS_COLLECTION_ID!,
                     ID.unique(),
                     {
                        action: 'LEAD_CREATE',
                        actorId: creatingUserId || finalOwnerId,
                        actorName: creatingUserName || 'System',
                        targetId: lead.$id,
                        targetType: 'LEAD',
                        metadata: JSON.stringify({ ...input.data, branchId: input.branchId }),
                        performedAt: new Date().toISOString()
                     }
                 );
            }
        } catch (e) {
            console.error("Failed to log audit action", e);
        }

        try {
            if (creatingUserId && !input.assignedToId) {
                const creator = await databases.getDocument(
                    DATABASE_ID,
                    COLLECTIONS.USERS,
                    creatingUserId
                ) as any;

                if (creator?.role === 'lead_generation') {
                    const recipientIds: Array<string | null | undefined> = creator.teamLeadId
                      ? [creator.teamLeadId]
                      : [
                          creator.managerId || null,
                          Array.isArray(creator.managerIds) ? creator.managerIds[0] : null,
                        ];

                    let leadName = '';
                    try {
                        const payload = input.data as any;
                        const firstName = String(payload?.firstName ?? '').trim();
                        const lastName = String(payload?.lastName ?? '').trim();
                        leadName = [firstName, lastName].filter(Boolean).join(' ').trim();
                    } catch {}

                    await createNotificationsForRecipients(
                        databases,
                        recipientIds,
                        {
                            type: 'lead_unassigned',
                            title: 'Unassigned lead generated',
                            body: `${creatingUserName || 'Lead generation'} generated ${leadName || 'a lead'} but it is not assigned to any agent.`,
                            targetId: lead.$id,
                            targetType: 'LEAD',
                        }
                    );
                }
            }
        } catch (e) {
            console.error("Failed to create unassigned lead notification", e);
        }

        return lead as unknown as Lead;
    } catch (error: any) {
        console.error('Error creating lead (action):', error);
        throw new Error(error.message || 'Failed to create lead');
    }
}

export async function reopenLeadAction(
    leadId: string,
    actorId?: string,
    actorName?: string
): Promise<Lead> {
    if (actorId) {
        await assertAuthenticatedUserId(actorId);
    } else {
        throw new Error("Unauthorized");
    }
    const { databases } = await createAdminClient();
    try {
        const actorDoc = await databases.getDocument(
            DATABASE_ID,
            COLLECTIONS.USERS,
            actorId
        ) as unknown as UserDocument;

        // Get the current lead
        const currentLead = await databases.getDocument(DATABASE_ID, LEADS_COLLECTION_ID, leadId) as unknown as Lead;
        await assertLeadReopenAllowed(databases, actorDoc, currentLead);

        // Build permissions with update access restored
        const { Permission, Role } = await import("node-appwrite");

        const newPermissions = [
             Permission.read(Role.user(currentLead.ownerId)),
             Permission.update(Role.user(currentLead.ownerId)),
             Permission.delete(Role.user(currentLead.ownerId)),
        ];

        if (currentLead.assignedToId) {
             newPermissions.push(
                 Permission.read(Role.user(currentLead.assignedToId)),
                 Permission.update(Role.user(currentLead.assignedToId))
             );
        }

        const lead = await databases.updateDocument(
            DATABASE_ID,
            LEADS_COLLECTION_ID,
            leadId,
            {
                isClosed: false,
            },
            newPermissions
        );

        return lead as unknown as Lead;
    } catch (error: any) {
        console.error('Error reopening lead (action):', error);
        throw new Error(error.message || 'Failed to reopen lead');
    }
}
export async function listLeadsAction(
  filters: LeadListFilters,
  userId: string,
  _userRole: UserRole,
  branchIds?: string[]
): Promise<Lead[]> {
  try {
    await assertAuthenticatedUserId(userId);
    const { databases } = await createAdminClient();
    const queries: string[] = [];

    // Role-based filtering
    const userDoc = await databases.getDocument(DATABASE_ID, COLLECTIONS.USERS, userId) as unknown as UserDocument;
    const userRole = userDoc.role;

    const specialBranchId = getSpecialBranchLeadAccess(userDoc.email as string | undefined);

    if (userRole === 'agent') {
      // Agents see leads assigned to them OR leads they created
      const orConditions = [
          Query.equal('assignedToId', userId),
          Query.equal('ownerId', userId),
      ];
      if (specialBranchId) {
        orConditions.push(Query.equal('branchId', specialBranchId));
      }
      queries.push(Query.or(orConditions));
    } else if (userRole === 'lead_generation') {
      queries.push(Query.equal('ownerId', userId));
    } else if (userRole === 'admin') {
      // Admins and Managers see all leads across all branches — no branch/owner filter
    } else if (userRole === 'manager') {
      const visibleUserIds = await getLeadVisibilityUserIds(databases, userId, userRole);
      appendHierarchyLeadVisibilityQuery(
        queries,
        visibleUserIds,
        specialBranchId,
        branchIds,
        true,
      );
    } else if (userRole === 'assistant_manager') {
      const visibleUserIds = await getLeadVisibilityUserIds(databases, userId, userRole);
      appendHierarchyLeadVisibilityQuery(
        queries,
        visibleUserIds,
        specialBranchId,
        branchIds,
        true,
      );
    } else if (userRole === 'team_lead') {
      const visibleUserIds = await getLeadVisibilityUserIds(databases, userId, userRole);
      appendHierarchyLeadVisibilityQuery(
        queries,
        visibleUserIds,
        specialBranchId,
        branchIds,
        true,
      );
    }

    /*
      // Assistant Managers see:
      // 1. Leads in their assigned branches
      // 2. OR Leads they own (even if branch not assigned, though rare)
      // 3. OR Leads owned by their Managers (upwards hierarchy)
      // 4. OR Leads owned/assigned to their Subordinates (downwards hierarchy)

      const orConditions = [
        Query.equal('ownerId', userId),
      ];

      // Logic change:
      // Assistant Managers with > 1 branch ALSO see all branch leads (same as Manager).
      // Assistant Managers with 1 branch only see their own leads + subordinate leads.
      const shouldSeeAllBranchLeads = (userRole === 'assistant_manager' && branchIds && branchIds.length > 1);
      console.log('[listLeadsAction] shouldSeeAllBranchLeads:', shouldSeeAllBranchLeads, 'branchIds:', branchIds);

      if (shouldSeeAllBranchLeads && branchIds && branchIds.length > 0) {
        orConditions.push(Query.equal('branchId', branchIds));
      }
      if (specialBranchId) {
        orConditions.push(Query.equal('branchId', specialBranchId));
      }

      // Also include leads from subordinates AND managers (as requested)
      try {
        // Fetch current user to get managerIds (UPWARDS)
        // userDoc is already fetched at the top of the function
        const managerIds: string[] = [];
        if (userDoc.managerId) managerIds.push(userDoc.managerId);
        if (userDoc.managerIds && Array.isArray(userDoc.managerIds)) {
             userDoc.managerIds.forEach((mid: string) => {
                 if (!managerIds.includes(mid)) managerIds.push(mid);
             });
        }

        if (managerIds.length > 0) {
            orConditions.push(Query.equal('ownerId', managerIds));
        }

        // Fetch subordinates (where managerId = userId OR managerIds contains userId) (DOWNWARDS)
        // Using simplified direct queries to avoid complex OR conditions on potential non-indexed fields
        const subordinatesDirect = await databases.listDocuments(
            DATABASE_ID,
            COLLECTIONS.USERS,
            [Query.equal('managerId', userId)]
        );

        // This might fail if managerIds is not indexed or empty in schema, wrap in try-catch or assume it works
        let subordinatesMulti: any = { documents: [] };
        try {
            subordinatesMulti = await databases.listDocuments(
                DATABASE_ID,
                COLLECTIONS.USERS,
                [Query.equal('managerIds', userId)]
            );
        } catch (e) {
            // Ignore if index missing
        }

        const allSubordinates = [...subordinatesDirect.documents, ...subordinatesMulti.documents];
        // Deduplicate
        const uniqueSubordinateIds = [...new Set(allSubordinates.map((d: any) => d.$id))];

        if (uniqueSubordinateIds.length > 0) {
          orConditions.push(Query.equal('ownerId', uniqueSubordinateIds));
          orConditions.push(Query.equal('assignedToId', uniqueSubordinateIds));
        }
      } catch (err) {
        console.error('Error fetching hierarchy for lead visibility:', err);
      }

      // Use OR to combine own leads + branch leads + subordinate leads + manager leads
      if (orConditions.length > 1) {
         console.log('[listLeadsAction] OR conditions applied:', orConditions.length);
         queries.push(Query.or(orConditions));
      } else {
         console.log('[listLeadsAction] Single OR condition applied:', orConditions[0]);
         queries.push(orConditions[0]);
      }
    } else if (userRole === 'team_lead') {
      // Team Leads see:
      // 1. Leads they created (ownerId = userId)
      // 2. Leads created by their assigned agents (ownerId IN agentIds)
      // 3. Leads assigned to their agents (assignedToId IN agentIds)
      // 4. Leads assigned to themselves (assignedToId = userId)

      // Fetch agents for this Team Lead
      const agents = await databases.listDocuments(
        DATABASE_ID,
        COLLECTIONS.USERS,
        [
          Query.equal('teamLeadId', userId),
          Query.equal('role', 'agent'),
        ]
      );

      const teamIds = [userId];
      agents.documents.forEach((agent) => {
        teamIds.push(agent.$id);
      });

      // Filter leads where ownerId OR assignedToId is in the team
      const orConditions = [
        Query.equal('ownerId', teamIds),
        Query.equal('assignedToId', teamIds),
      ];
      if (specialBranchId) {
        orConditions.push(Query.equal('branchId', specialBranchId));
      }

      queries.push(Query.or(orConditions));
    }
    */

    // Filter by closed status (default to active leads)
    if (filters.isClosed !== undefined) {
      queries.push(Query.equal('isClosed', filters.isClosed));
    } else {
      queries.push(Query.equal('isClosed', false));
    }

    // Apply status filter
    if (filters.status) {
      const statusText = typeof filters.status === 'string' ? filters.status : '';
      const normalized = statusText.trim().toLowerCase().replace(/\s+/g, '');
      if (normalized === 'backout' || normalized === 'backedout') {
        queries.push(Query.equal('status', ['Backout', 'Backed Out', 'Backedout', 'Backed out']));
      } else {
        queries.push(Query.equal('status', filters.status));
      }
    }

    // Apply assigned agent filter
    if (filters.assignedToId) {
      queries.push(Query.equal('assignedToId', filters.assignedToId));
    }

    // Apply branch filter
    if (filters.branchId) {
      queries.push(Query.equal('branchId', filters.branchId));
    }

    // Apply date range filters
    if (filters.dateFrom) {
      queries.push(Query.greaterThanEqual('$createdAt', filters.dateFrom));
    }
    if (filters.dateTo) {
      queries.push(Query.lessThanEqual('$createdAt', filters.dateTo));
    }

    // Order by creation date (newest first)
    queries.push(Query.orderDesc('$createdAt'));

    // Set a high limit to fetch all leads
    queries.push(Query.limit(5000));

    // Fetch leads
    const response = await databases.listDocuments(DATABASE_ID, LEADS_COLLECTION_ID, queries);

    // Apply search query filter (in-memory)
    let leads = response.documents as unknown as Lead[];

    if (filters.searchQuery) {
      const searchLower = filters.searchQuery.toLowerCase();
      leads = leads.filter((lead) => {
        try {
            const data = JSON.parse(lead.data) as LeadData;
            return Object.values(data).some((value) =>
            String(value).toLowerCase().includes(searchLower)
            );
        } catch (e) {
            return false;
        }
      });
    }

    return leads;
  } catch (error: any) {
    console.error('Error listing leads (action):', error);
    throw new Error(getAppwriteErrorMessage(error) || 'Failed to list leads');
  }
}
