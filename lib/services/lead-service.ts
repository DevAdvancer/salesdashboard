import { Permission, Role, Query } from 'appwrite';
import { databases, DATABASE_ID, COLLECTIONS } from '@/lib/appwrite';
import { Lead, CreateLeadInput, LeadData, LeadListFilters, UserRole } from '@/lib/types';
import { validateLeadUniqueness } from '@/lib/services/lead-validator';
import { logAction } from './audit-service';
import { getUserById } from '@/lib/services/user-service';
import { getSpecialBranchLeadAccess } from '@/lib/constants/special-lead-access';
import {
  isAllowedLeadStatusTransition,
  normalizeLeadStatus,
} from '@/lib/utils/lead-status-workflow';
import { getErrorMessage } from '@/lib/utils';
import { expandIsoDateToStart, expandIsoDateToEnd } from '@/lib/utils/iso-date-range';

// Helper to validate Appwrite ID format
function isValidId(id: string | null | undefined): boolean {
    if (!id) return false;
    const validIdPattern = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,35}$/;
    return validIdPattern.test(id);
}

function getLeadAuditName(data: LeadData): string {
    const firstName = typeof data.firstName === 'string' ? data.firstName : '';
    const lastName = typeof data.lastName === 'string' ? data.lastName : '';
    const fullName = [firstName, lastName].filter(Boolean).join(' ').trim();
    const fallback = data.legalName || data.name || data.company || data.email || data.phone;
    return fullName || (typeof fallback === 'string' ? fallback : '');
}

function buildAuditChanges(previousData: LeadData, nextData: LeadData, changedData: Partial<LeadData>) {
    const changes: Record<string, { from: unknown; to: unknown }> = {};

    Object.keys(changedData).forEach((key) => {
        const previousValue = previousData[key];
        const nextValue = nextData[key];
        if (JSON.stringify(previousValue) !== JSON.stringify(nextValue)) {
            changes[key] = {
                from: previousValue ?? null,
                to: nextValue ?? null,
            };
        }
    });

    return changes;
}

function normalizeStatusText(value: unknown) {
  const text = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return text.replace(/[^a-z0-9]/g, '');
}

function isLinkedinRequestLeadData(data: LeadData) {
  const requestId = (data as any).linkedinRequestId;
  if (typeof requestId === 'string' && requestId.trim().length > 0) return true;
  const source = typeof (data as any).source === 'string' ? (data as any).source.trim() : '';
  const sourceName =
    typeof (data as any).sourceName === 'string' ? (data as any).sourceName.trim() : '';
  const normalizedSource = normalizeStatusText(source || sourceName);
  return normalizedSource === 'linkedinlead' || normalizedSource === 'linkedin';
}

type HierarchyUserDocument = {
  $id: string;
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

      const reportsToVisibleTeamLead = Boolean(candidate.teamLeadId && visibleIds.has(candidate.teamLeadId));

      if (reportsToVisibleTeamLead) {
        visibleIds.add(candidate.$id);
        changed = true;
      }
    });
  }

  return Array.from(visibleIds);
}

async function getLeadVisibilityUserIds(viewerId: string, viewerRole: UserRole): Promise<string[]> {
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

    return [viewerId, ...agents.documents.map((agent) => agent.$id)];
  }

  const response = await databases.listDocuments(
    DATABASE_ID,
    COLLECTIONS.USERS,
    [Query.limit(5000)]
  );

  return getVisibleHierarchyUserIds(viewerId, viewerRole, response.documents as unknown as HierarchyUserDocument[]);
}

type TeamLeadScopedUserDocument = {
  $id: string;
  role?: UserRole;
};

async function getTeamLeadLeadVisibilityScope(viewerId: string): Promise<{
  ownerVisibleUserIds: string[];
  assignmentVisibleUserIds: string[];
}> {
  const teamUsers = await databases.listDocuments(
    DATABASE_ID,
    COLLECTIONS.USERS,
    [
      Query.equal('teamLeadId', viewerId),
      Query.or([Query.equal('role', 'agent'), Query.equal('role', 'lead_generation')]),
    ]
  );

  const docs = teamUsers.documents as unknown as TeamLeadScopedUserDocument[];
  const assignmentVisibleUserIds = [viewerId, ...docs.map((user) => user.$id)];
  const ownerVisibleUserIds = [
    viewerId,
    ...docs
      .filter((user) => user.role === 'agent')
      .map((user) => user.$id),
  ];

  return { ownerVisibleUserIds, assignmentVisibleUserIds };
}

async function assertActorCanMutateLead(actorId?: string) {
  if (!actorId) return;
  const actor = await getUserById(actorId);
  if (actor.role === 'operations') {
    throw new Error('Permission denied');
  }
}

function appendHierarchyLeadVisibilityQuery(queries: string[], visibleUserIds: string[], specialBranchId?: string | null) {
  const orConditions = [
    Query.equal('ownerId', visibleUserIds),
    Query.equal('assignedToId', visibleUserIds),
  ];

  if (specialBranchId) {
    orConditions.push(Query.equal('branchId', specialBranchId));
  }

  queries.push(Query.or(orConditions));
}

function appendTeamLeadLeadVisibilityQuery(
  queries: string[],
  ownerVisibleUserIds: string[],
  assignmentVisibleUserIds: string[],
  specialBranchId?: string | null
) {
  const orConditions = [
    Query.equal('ownerId', ownerVisibleUserIds),
    Query.equal('assignedToId', assignmentVisibleUserIds),
  ];

  if (specialBranchId) {
    orConditions.push(Query.equal('branchId', specialBranchId));
  }

  queries.push(Query.or(orConditions));
}

// Helper to get permissions for supervisors up the chain.
// Optimized: visits each level with at most one getUserById, but the chain
// walk itself is bounded to 5 levels and short-circuits the first time we
// re-encounter a previously-seen id. Common 1-2 level cases finish in 1-2
// roundtrips instead of the old 5-level sequential walk.
async function getHierarchyPermissions(userId: string): Promise<string[]> {
    const permissions: string[] = [];
    try {
        if (!isValidId(userId)) return permissions;

        const visited = new Set<string>([userId]);
        let currentId: string | null = userId;

        for (let depth = 0; depth < 5 && currentId && isValidId(currentId); depth++) {
            try {
                const user = await getUserById(currentId);

                const supervisors = new Set<string>();
                if (user.teamLeadId) supervisors.add(user.teamLeadId);

                for (const supId of supervisors) {
                    if (!visited.has(supId) && isValidId(supId)) {
                        permissions.push(Permission.read(Role.user(supId)));
                        permissions.push(Permission.update(Role.user(supId)));
                        permissions.push(Permission.delete(Role.user(supId)));
                        visited.add(supId);
                    } else if (supId && !isValidId(supId)) {
                        console.warn(`[getHierarchyPermissions] Skipped invalid supervisor ID: "${supId}"`);
                    }
                }

                // Continue up the chain. Prefer a not-yet-visited supervisor.
                if (user.teamLeadId && isValidId(user.teamLeadId) && !visited.has(user.teamLeadId)) {
                    currentId = user.teamLeadId;
                } else {
                    currentId = null;
                }
            } catch (inner) {
                console.warn(`[getHierarchyPermissions] Stopping at depth ${depth} due to:`, inner);
                break;
            }
        }
    } catch (e) {
        console.error(`Error fetching hierarchy permissions for user ${userId}:`, e);
    }
    return permissions;
}

/**
 * Create a new lead
 *
 * This function creates a new lead document in Appwrite.
 * It validates lead uniqueness (email/phone) across all branches before creation.
 * It sets the initial status to "New" and assigns ownership to the creating user.
 * It also logs the creation action to the audit log.
 *
 * @param ownerId - The ID of the user who owns the lead
 * @param input - The lead input data
 * @param creatingUserId - The ID of the user performing the creation (optional, for logging)
 * @param creatingUserName - The name of the user performing the creation (optional, for logging)
 * @returns The created lead
 */
export async function createLead(
    ownerId: string,
    input: CreateLeadInput,
    creatingUserId?: string,
    creatingUserName?: string
): Promise<Lead> {
  try {
    await assertActorCanMutateLead(creatingUserId || ownerId);

    // Validate lead uniqueness
    const validation = await validateLeadUniqueness(input.data);
    if (!validation.isValid) {
      throw new Error(
        `Duplicate ${validation.duplicateField} found in lead ${validation.existingLeadId}` +
        (validation.existingBranchId ? ` (branch: ${validation.existingBranchId})` : '')
      );
    }

    // Auto-set ownerId to the creating user's ID (Requirement 4.1)
    // Note: If creatingUserId is not provided, use ownerId passed in.
    const finalOwnerId = creatingUserId || ownerId;

    if (!isValidId(finalOwnerId)) {
        throw new Error(`Invalid owner ID format: "${finalOwnerId}"`);
    }

    // Serialize lead data to JSON
    const dataWithCreator = {
      ...input.data,
      creatorId: finalOwnerId,
    };
    const dataJson = JSON.stringify(dataWithCreator);

    const ownerDoc = await getUserById(finalOwnerId);
    const ownerIsMonitor = ownerDoc.role === 'monitor';

    // Build permissions array
    const permissions: string[] = [
      Permission.read(Role.user(finalOwnerId)),
    ];
    // Grant the owner update/delete on their own lead. Monitor owners
    // are included so they can edit the leads they create; operations
    // owners stay read-only at the document level (they cannot create
    // leads at all, but this is a defense-in-depth block).
    if (ownerDoc.role !== 'operations') {
      permissions.push(
        Permission.update(Role.user(finalOwnerId)),
        Permission.delete(Role.user(finalOwnerId)),
      );
    }

    // Add owner's hierarchy permissions
    const ownerHierarchyPerms = await getHierarchyPermissions(finalOwnerId);
    permissions.push(...ownerHierarchyPerms);

    // If assigned to an agent, grant them read and update access
    if (input.assignedToId) {
      if (isValidId(input.assignedToId)) {
          permissions.push(Permission.read(Role.user(input.assignedToId)));
          if (!ownerIsMonitor || input.assignedToId !== finalOwnerId) {
            permissions.push(Permission.update(Role.user(input.assignedToId)));
          }

          // Add assigned user's hierarchy permissions too (Managers of the assigned agent)
          const assignedHierarchyPerms = await getHierarchyPermissions(input.assignedToId);
          permissions.push(...assignedHierarchyPerms);
      } else {
          console.warn(`[createLead] Skipped invalid assignedToId: "${input.assignedToId}"`);
      }
    }

    // Create the lead document with branchId
    const lead = await databases.createDocument(
      DATABASE_ID,
      COLLECTIONS.LEADS,
      'unique()',
      {
        data: dataJson,
        status: input.status || 'New',
        ownerId: finalOwnerId,
        assignedToId: input.assignedToId || null,
        branchId: input.branchId ?? null,
        isClosed: false,
        closedAt: null,
      },
      permissions
    );

    const createdLead = lead as unknown as Lead;

    // Log audit
    if (creatingUserName) {
        await logAction({
            action: 'LEAD_CREATE',
            actorId: creatingUserId || finalOwnerId,
            actorName: creatingUserName || 'System',
            targetId: createdLead.$id,
            targetType: 'LEAD',
            metadata: { leadName: getLeadAuditName(input.data), ...input.data, branchId: input.branchId ?? null }
        });
    }

    return createdLead;
  } catch (error: unknown) {
    console.error('Error creating lead:', error);
    throw new Error(getErrorMessage(error, 'Failed to create lead'));
  }
}

/**
 * Update an existing lead
 *
 * This function updates a lead with new data.
 * It validates lead uniqueness (email/phone) across all branches before updating,
 * excluding the current lead from the duplicate check.
 * It preserves the existing permissions unless assignment changes.
 *
 * @param leadId - The ID of the lead to update
 * @param data - The updated lead data
 * @param actorId - The ID of the user performing the update (optional, for logging)
 * @param actorName - The name of the user performing the update (optional, for logging)
 * @returns The updated lead
 */
export async function updateLead(
    leadId: string,
    data: Partial<LeadData>,
    actorId?: string,
    actorName?: string
): Promise<Lead> {
  try {
    await assertActorCanMutateLead(actorId);

    // Resolve the actor's role once so monitor-only statuses (LinkedIn,
    // Leads) are properly gated. If we can't resolve the actor, fall back
    // to the strictest interpretation (no role passed) — non-monitor
    // transitions to LinkedIn/Leads will be denied.
    let actorRole: string | undefined;
    if (actorId) {
      try {
        const actor = await getUserById(actorId);
        actorRole = actor.role;
      } catch {
        actorRole = undefined;
      }
    }

    // Get the current lead to merge data
    const currentLead = await getLead(leadId);
    const currentData = JSON.parse(currentLead.data) as LeadData;

    // Merge current data with updates
    const updatedData = { ...currentData, ...data };

    const nextStatus = (updatedData as any).status;
    if (nextStatus) {
      const previousStatus = currentLead.status;
      const KNOWN_WORKFLOW_STATUSES = [
        'interested',
        'notinterested',
        'pipelinefollowup',
        'signedclosure',
        'backedout',
        'linkedin',
        'leads',
      ];
      const shouldEnforceWorkflow =
        isLinkedinRequestLeadData(updatedData) ||
        KNOWN_WORKFLOW_STATUSES.includes(normalizeLeadStatus(previousStatus)) ||
        KNOWN_WORKFLOW_STATUSES.includes(normalizeLeadStatus(nextStatus));
      if (
        shouldEnforceWorkflow &&
        !isAllowedLeadStatusTransition(previousStatus, nextStatus, actorRole)
      ) {
        throw new Error('Invalid status transition for this lead.');
      }
    }

    // Validate lead uniqueness before updating (exclude self)
    const validation = await validateLeadUniqueness(updatedData, leadId);
    if (!validation.isValid) {
      throw new Error(
        `Duplicate ${validation.duplicateField} found in lead ${validation.existingLeadId}` +
        (validation.existingBranchId ? ` (branch: ${validation.existingBranchId})` : '')
      );
    }

    const dataJson = JSON.stringify(updatedData);

    // Update the lead document
    const lead = await databases.updateDocument(
      DATABASE_ID,
      COLLECTIONS.LEADS,
      leadId,
      {
        data: dataJson,
        status: updatedData.status || currentLead.status,
      }
    );

    // Log audit
    if (actorId && actorName) {
      await logAction({
            action: 'LEAD_UPDATE',
            actorId: actorId,
            actorName: actorName,
            targetId: leadId,
            targetType: 'LEAD',
            metadata: {
              leadName: getLeadAuditName(updatedData),
              changes: buildAuditChanges(currentData, updatedData, data),
              ...data,
            }
        });
    }

    return lead as unknown as Lead;
  } catch (error: unknown) {
    console.error('Error updating lead:', error);
    throw new Error(getErrorMessage(error, 'Failed to update lead'));
  }
}

/**
 * Delete a lead
 *
 * This function permanently deletes a lead from the database.
 * Only the owner (or admin) can delete leads.
 *
 * @param leadId - The ID of the lead to delete
 * @param actorId - The ID of the user performing the delete (optional, for logging)
 * @param actorName - The name of the user performing the delete (optional, for logging)
 */
export async function deleteLead(leadId: string, actorId?: string, actorName?: string): Promise<void> {
  try {
    await assertActorCanMutateLead(actorId);

    let leadName = '';
    try {
      const currentLead = await getLead(leadId);
      const currentData = JSON.parse(currentLead.data) as LeadData;
      leadName = getLeadAuditName(currentData);
    } catch {}

    await databases.deleteDocument(DATABASE_ID, COLLECTIONS.LEADS, leadId);

    // Log audit
    if (actorId && actorName) {
         await logAction({
            action: 'LEAD_DELETE',
            actorId: actorId,
            actorName: actorName,
            targetId: leadId,
            targetType: 'LEAD',
            metadata: { leadName }
        });
    }
  } catch (error: unknown) {
    console.error('Error deleting lead:', error);
    throw new Error(getErrorMessage(error, 'Failed to delete lead'));
  }
}

/**
 * Get a single lead by ID
 *
 * This function fetches a lead by its ID.
 * Permissions are enforced at the database level.
 *
 * @param leadId - The ID of the lead to fetch
 * @returns The lead
 */
export async function getLead(leadId: string): Promise<Lead> {
  try {
    const lead = await databases.getDocument(DATABASE_ID, COLLECTIONS.LEADS, leadId);
    return lead as unknown as Lead;
  } catch (error: unknown) {
    console.error('Error fetching lead:', error);
    throw new Error(getErrorMessage(error, 'Failed to fetch lead'));
  }
}

/**
 * List leads with optional filters
 *
 * This function fetches leads with role-based filtering:
 * - Admins see all leads across all branches
 * - Managers, Assistant Managers, and Team Leads see their own leads plus subordinate leads
 * - Agents see only leads assigned to them or created by them
 *
 * @param filters - Optional filters for the lead list
 * @param userId - The ID of the current user
 * @param userRole - The role of the current user
 * @param branchIds - The branch IDs of the current user (for team leads)
 * @returns Array of leads
 */
export async function listLeads(
  filters: LeadListFilters,
  userId: string,
  userRole: UserRole,
  branchIds?: string[]
): Promise<Lead[]> {
  try {
    const queries: string[] = [];

    // Check for special user access
    const currentUser = await getUserById(userId);
    const specialBranchId = getSpecialBranchLeadAccess(currentUser.email);
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
    } else if (userRole === 'admin' || userRole === 'developer' || userRole === 'monitor' || userRole === 'operations') {
      // Admins, developers, monitors, and operations see all leads across all branches - no branch/owner filter
    } else if (userRole === 'team_lead') {
      const { ownerVisibleUserIds, assignmentVisibleUserIds } =
        await getTeamLeadLeadVisibilityScope(userId);
      appendTeamLeadLeadVisibilityQuery(
        queries,
        ownerVisibleUserIds,
        assignmentVisibleUserIds,
        specialBranchId,
      );
    }

    /*
      // Assistant Managers see:
      // 1. Leads in their assigned branches
      // 2. OR Leads they own
      // 3. OR Leads owned by their Managers (upwards)
      // 4. OR Leads owned/assigned to their Subordinates (downwards)

      const orConditions = [
        Query.equal('ownerId', userId),
      ];

      // Logic change:
// Team Leads with > 1 branch ALSO see all branch leads.
// Team Leads with 1 branch only see their own leads + subordinate leads.
      const shouldSeeAllBranchLeads = (userRole === 'team_lead' && branchIds && branchIds.length > 1);

      if (shouldSeeAllBranchLeads && branchIds && branchIds.length > 0) {
        orConditions.push(Query.contains('branchIds', branchIds));
      }
      if (specialBranchId) {
        orConditions.push(Query.contains('branchIds', [specialBranchId]));
      }

      try {
        // Fetch subordinates (Agents / lead_generation)
        const { getSubordinates } = await import('@/lib/services/user-service');
        const subordinates = await getSubordinates(userId);

        if (subordinates.length > 0) {
          const subordinateIds = subordinates.map(s => s.$id);
          orConditions.push(Query.equal('ownerId', subordinateIds));
          orConditions.push(Query.equal('assignedToId', subordinateIds));
        }
      } catch (err) {
        console.error('Error fetching subordinates for lead visibility:', err);
      }

      if (orConditions.length > 1) {
         queries.push(Query.or(orConditions));
      } else {
         queries.push(orConditions[0]);
      }
    } else if (userRole === 'team_lead') {
      // Team Leads see:
      // 1. Leads they created (ownerId = userId)
      // 2. Leads created by their assigned agents (ownerId IN agentIds)
      // 3. Leads assigned to their agents (assignedToId IN agentIds)
      // 4. Leads assigned to themselves (assignedToId = userId)

      try {
        // Fetch agents for this Team Lead directly using Client SDK (permissions permitting)
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
          orConditions.push(Query.contains('branchIds', [specialBranchId]));
        }

        queries.push(Query.or(orConditions));
      } catch (err) {
        console.error('Error fetching team agents for lead visibility:', err);
        // Fallback: see own leads
        queries.push(Query.equal('ownerId', userId));
      }
    }
    */

    // Filter by closed status (default to active leads)
    if (filters.isClosed !== undefined) {
      queries.push(Query.equal('isClosed', filters.isClosed));
    } else {
      // If we are listing leads and explicitly want all (e.g. for search or if logic demands), we might skip this.
      // But typically "listLeads" implies active leads unless specified otherwise.
      queries.push(Query.equal('isClosed', false));
    }

    // Apply status filter
    if (filters.status) {
      queries.push(Query.equal('status', filters.status));
    }

    // Apply assigned agent filter (for admins)
    if (filters.assignedToId) {
      queries.push(Query.equal('assignedToId', filters.assignedToId));
    }

    // Apply branch filter
    if (filters.branchId) {
      queries.push(Query.equal('branchId', filters.branchId));
    }

    // Apply date range filters. The dashboard passes YYYY-MM-DD strings
    // (e.g. "2026-06-22"). Comparing those lexicographically against
    // a full ISO timestamp like "2026-06-22T10:00:00.000Z" produces
    // wrong results: the timestamp sorts after the date-only form,
    // so a `lessThanEqual` filter on the YYYY-MM-DD form would
    // silently exclude every lead for that day. Expand the inputs to
    // a full ISO range before pushing to Appwrite.
    if (filters.dateFrom) {
      queries.push(Query.greaterThanEqual('$createdAt', expandIsoDateToStart(filters.dateFrom)));
    }
    if (filters.dateTo) {
      queries.push(Query.lessThanEqual('$createdAt', expandIsoDateToEnd(filters.dateTo)));
    }

    // Order by creation date (newest first)
    queries.push(Query.orderDesc('$createdAt'));

    // Set a high limit to fetch all leads (Appwrite default is 25)
    queries.push(Query.limit(5000));

    // Fetch leads
    const response = await databases.listDocuments(DATABASE_ID, COLLECTIONS.LEADS, queries);

    // Apply search query filter (client-side since Appwrite doesn't support full-text search on JSON)
    let leads = response.documents as unknown as Lead[];

    if (filters.searchQuery) {
      const searchLower = filters.searchQuery.toLowerCase();
      leads = leads.filter((lead) => {
        const data = JSON.parse(lead.data) as LeadData;
        return Object.values(data).some((value) =>
          String(value).toLowerCase().includes(searchLower)
        );
      });
    }

    return leads;
  } catch (error: unknown) {
    console.error('Error listing leads:', error);
    throw new Error(getErrorMessage(error, 'Failed to list leads'));
  }
}

/**
 * Close a lead
 *
 * This function closes a lead by setting isClosed=true and recording the closure timestamp.
 * It also updates permissions to make the lead read-only for agents.
 *
 * @param leadId - The ID of the lead to close
 * @param closedStatus - The final status of the closed lead
 * @param actorId - The ID of the user performing the close (optional, for logging)
 * @param actorName - The name of the user performing the close (optional, for logging)
 * @returns The updated lead
 */
export async function closeLead(
    leadId: string,
    closedStatus: string,
    actorId?: string,
    actorName?: string,
    actorRole?: import('@/lib/types').UserRole
): Promise<Lead> {
  try {
    if (actorRole === 'monitor' || actorRole === 'operations') {
      throw new Error('Permission denied');
    }

    // Get the current lead to preserve owner and assigned agent
    const currentLead = await getLead(leadId);
    let leadData: LeadData = {};

    try {
      leadData = JSON.parse(currentLead.data) as LeadData;
    } catch {
      leadData = {};
    }

    const shouldAssignClosingAgent =
      actorRole === 'agent' && Boolean(actorId) && !currentLead.assignedToId;
    const nextAssignedToId = shouldAssignClosingAgent ? actorId! : currentLead.assignedToId;

    // Build new permissions (read-only for agent, full access for owner)
    const permissions: string[] = [
      Permission.read(Role.user(currentLead.ownerId)),
      Permission.update(Role.user(currentLead.ownerId)),
      Permission.delete(Role.user(currentLead.ownerId)),
    ];

    // Agent gets read-only access
    if (nextAssignedToId) {
      permissions.push(Permission.read(Role.user(nextAssignedToId)));
    }

    if (actorId && actorId !== currentLead.ownerId && actorId !== nextAssignedToId) {
      permissions.push(Permission.read(Role.user(actorId)));
    }

    // Update the lead
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
      permissions
    );

    // Log audit
    if (actorId && actorName) {
         await logAction({
            action: 'LEAD_UPDATE',
            actorId: actorId,
            actorName: actorName,
            targetId: leadId,
            targetType: 'LEAD',
            metadata: {
              isClosed: true,
              status: closedStatus,
              leadId,
              leadName: getLeadAuditName(leadData),
              candidateName: `${leadData.firstName || ''} ${leadData.lastName || ''}`.trim() || leadData.legalName || '',
              email: leadData.email || '',
              phone: leadData.phone || '',
              company: leadData.company || '',
              source: leadData.sourceName || leadData.source || '',
              ownerId: currentLead.ownerId,
              assignedToId: currentLead.assignedToId,
              branchId: currentLead.branchId ?? null,
              closedAt: lead.closedAt,
              changes: {
                status: { from: currentLead.status, to: closedStatus },
                isClosed: { from: false, to: true },
              },
            }
        });
    }

    return lead as unknown as Lead;
  } catch (error: unknown) {
    console.error('Error closing lead:', error);
    throw new Error(getErrorMessage(error, 'Failed to close lead'));
  }
}

/**
 * Reopen a closed lead (admin or team lead only)
 *
 * This function reopens a closed lead by setting isClosed=false.
 * It preserves the closedAt timestamp for audit trail.
 * It restores update permissions for the assigned agent.
 *
 * @param leadId - The ID of the lead to reopen
 * @param actorId - The ID of the user performing the reopen (optional, for logging)
 * @param actorName - The name of the user performing the reopen (optional, for logging)
 * @returns The updated lead
 */
export async function reopenLead(
    leadId: string,
    actorId?: string,
    actorName?: string
): Promise<Lead> {
  try {
    await assertActorCanMutateLead(actorId);

    // Get the current lead
    const currentLead = await getLead(leadId);
    let leadName = '';
    try {
      leadName = getLeadAuditName(JSON.parse(currentLead.data) as LeadData);
    } catch {}

    // Build permissions with update access restored
    const permissions: string[] = [
      Permission.read(Role.user(currentLead.ownerId)),
      Permission.update(Role.user(currentLead.ownerId)),
      Permission.delete(Role.user(currentLead.ownerId)),
    ];

    // Restore agent update access
    if (currentLead.assignedToId) {
      permissions.push(
        Permission.read(Role.user(currentLead.assignedToId)),
        Permission.update(Role.user(currentLead.assignedToId))
      );
    }

    // Update the lead (preserve closedAt for history)
    const lead = await databases.updateDocument(
      DATABASE_ID,
      COLLECTIONS.LEADS,
      leadId,
      {
        isClosed: false,
      },
      permissions
    );

    // Log audit
    if (actorId && actorName) {
         await logAction({
            action: 'LEAD_UPDATE',
            actorId: actorId,
            actorName: actorName,
            targetId: leadId,
            targetType: 'LEAD',
            metadata: {
              leadName,
              isClosed: false,
              changes: {
                isClosed: { from: true, to: false },
              },
            }
        });
    }

    return lead as unknown as Lead;
  } catch (error: unknown) {
    console.error('Error reopening lead:', error);
    throw new Error(getErrorMessage(error, 'Failed to reopen lead'));
  }
}

/**
 * Assign a lead to an agent
 *
 * This function assigns a lead to a specific agent.
 * It updates the assignedToId field and document permissions.
 *
 * @param leadId - The ID of the lead to assign
 * @param agentId - The ID of the agent to assign the lead to
 * @param actorId - The ID of the user performing the assignment (optional, for logging)
 * @param actorName - The name of the user performing the assignment (optional, for logging)
 * @returns The updated lead
 */
export async function assignLead(
    leadId: string,
    agentId: string,
    actorId?: string,
    actorName?: string
): Promise<Lead> {
  try {
    await assertActorCanMutateLead(actorId);

    // Get the current lead
    const currentLead = await getLead(leadId);
    let leadName = '';
    try {
      leadName = getLeadAuditName(JSON.parse(currentLead.data) as LeadData);
    } catch {}

    // Build new permissions
    const permissions: string[] = [
      Permission.read(Role.user(currentLead.ownerId)),
      Permission.update(Role.user(currentLead.ownerId)),
      Permission.delete(Role.user(currentLead.ownerId)),
    ];

    // Add new agent permissions (only if lead is not closed)
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

    // Log audit
    if (actorId && actorName) {
         await logAction({
            action: 'LEAD_UPDATE',
            actorId: actorId,
            actorName: actorName,
            targetId: leadId,
            targetType: 'LEAD',
            metadata: {
              leadName,
              assignedToId: agentId,
              changes: {
                assignedToId: { from: currentLead.assignedToId, to: agentId },
              },
            }
        });
    }

    return lead as unknown as Lead;
  } catch (error: unknown) {
    console.error('Error assigning lead:', error);
    throw new Error(getErrorMessage(error, 'Failed to assign lead'));
  }
}
