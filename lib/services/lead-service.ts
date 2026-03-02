import { Permission, Role, Query } from 'appwrite';
import { databases, DATABASE_ID, COLLECTIONS } from '@/lib/appwrite';
import { Lead, CreateLeadInput, LeadData, LeadListFilters, UserRole } from '@/lib/types';
import { validateLeadUniqueness } from '@/lib/services/lead-validator';
import { logAction } from './audit-service';
import { getUserById } from '@/lib/services/user-service';

// Helper to validate Appwrite ID format
function isValidId(id: string | null | undefined): boolean {
    if (!id) return false;
    const validIdPattern = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,35}$/;
    return validIdPattern.test(id);
}

// Helper to get permissions for supervisors up the chain
async function getHierarchyPermissions(userId: string): Promise<string[]> {
    const permissions: string[] = [];
    try {
        let currentId = userId;
        const visited = new Set<string>();

        // Walk up the hierarchy (max 5 levels to prevent loops)
        while (currentId && !visited.has(currentId) && visited.size < 5) {
            // Validate ID format before fetching
            if (!isValidId(currentId)) {
                console.warn(`[getHierarchyPermissions] Stopping traversal at invalid ID: "${currentId}"`);
                break;
            }

            visited.add(currentId);

            const user = await getUserById(currentId);

            // Add supervisors
            const supervisors = new Set<string>();
            if (user.teamLeadId) supervisors.add(user.teamLeadId);
            if (user.managerId) supervisors.add(user.managerId);
            if (user.managerIds && user.managerIds.length > 0) {
                user.managerIds.forEach(mid => supervisors.add(mid));
            }

            // Add permissions for supervisors
            for (const supId of supervisors) {
                if (!visited.has(supId) && isValidId(supId)) {
                    permissions.push(Permission.read(Role.user(supId)));
                    permissions.push(Permission.update(Role.user(supId)));
                    permissions.push(Permission.delete(Role.user(supId))); // Supervisors can delete? Maybe.
                } else if (supId && !isValidId(supId)) {
                    console.warn(`[getHierarchyPermissions] Skipped invalid supervisor ID: "${supId}"`);
                }
            }

            // Move up to the next level (prefer Team Lead -> Manager -> Primary Manager)
            // If multiple managers, we just pick the primary one to continue the chain up.
            // If user has teamLeadId, next is teamLeadId.
            // If user has managerId, next is managerId.
            // This assumes single-path hierarchy for simplicity, though multiple managers get access.
            if (user.teamLeadId) {
                currentId = user.teamLeadId;
            } else if (user.managerId) {
                currentId = user.managerId;
            } else if (user.managerIds && user.managerIds.length > 0) {
                currentId = user.managerIds[0];
            } else {
                break; // Top of chain
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
    const dataJson = JSON.stringify(input.data);

    // Build permissions array
    const permissions: string[] = [
      // Owner (creator) has full access
      Permission.read(Role.user(finalOwnerId)),
      Permission.update(Role.user(finalOwnerId)),
      Permission.delete(Role.user(finalOwnerId)),
    ];

    // Add owner's hierarchy permissions
    const ownerHierarchyPerms = await getHierarchyPermissions(finalOwnerId);
    permissions.push(...ownerHierarchyPerms);

    // If assigned to an agent, grant them read and update access
    if (input.assignedToId) {
      if (isValidId(input.assignedToId)) {
          permissions.push(
            Permission.read(Role.user(input.assignedToId)),
            Permission.update(Role.user(input.assignedToId))
          );

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
        branchId: input.branchId || null,
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
            metadata: { ...input.data, branchId: input.branchId }
        });
    }

    return createdLead;
  } catch (error: any) {
    console.error('Error creating lead:', error);
    throw new Error(error.message || 'Failed to create lead');
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
    // Get the current lead to merge data
    const currentLead = await getLead(leadId);
    const currentData = JSON.parse(currentLead.data) as LeadData;

    // Merge current data with updates
    const updatedData = { ...currentData, ...data };

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
            metadata: data
        });
    }

    return lead as unknown as Lead;
  } catch (error: any) {
    console.error('Error updating lead:', error);
    throw new Error(error.message || 'Failed to update lead');
  }
}

/**
 * Delete a lead
 *
 * This function permanently deletes a lead from the database.
 * Only the owner (manager) can delete leads.
 *
 * @param leadId - The ID of the lead to delete
 * @param actorId - The ID of the user performing the delete (optional, for logging)
 * @param actorName - The name of the user performing the delete (optional, for logging)
 */
export async function deleteLead(leadId: string, actorId?: string, actorName?: string): Promise<void> {
  try {
    await databases.deleteDocument(DATABASE_ID, COLLECTIONS.LEADS, leadId);

    // Log audit
    if (actorId && actorName) {
         await logAction({
            action: 'LEAD_DELETE',
            actorId: actorId,
            actorName: actorName,
            targetId: leadId,
            targetType: 'LEAD'
        });
    }
  } catch (error: any) {
    console.error('Error deleting lead:', error);
    throw new Error(error.message || 'Failed to delete lead');
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
  } catch (error: any) {
    console.error('Error fetching lead:', error);
    throw new Error(error.message || 'Failed to fetch lead');
  }
}

/**
 * List leads with optional filters
 *
 * This function fetches leads with role-based filtering:
 * - Admins see all leads across all branches
 * - Managers see all leads across all branches (full visibility)
 * - Team Leads see only leads in their branches
 * - Agents see only leads assigned to them
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

    // Role-based filtering
    if (userRole === 'agent') {
      // Agents see leads assigned to them OR leads they created
      queries.push(
        Query.or([
          Query.equal('assignedToId', userId),
          Query.equal('ownerId', userId),
        ])
      );
    } else if (userRole === 'admin') {
      // Admins see all leads across all branches — no branch/owner filter
    } else if (userRole === 'manager' || userRole === 'assistant_manager') {
      // Managers & Assistant Managers see:
      // 1. Leads in their assigned branches
      // 2. OR Leads they own
      // 3. OR Leads owned by their Managers (upwards)
      // 4. OR Leads owned/assigned to their Subordinates (downwards)

      const orConditions = [
        Query.equal('ownerId', userId),
      ];

      // Logic change:
      // Managers always see branch leads.
      // Assistant Managers with > 1 branch ALSO see all branch leads (same as Manager).
      // Assistant Managers with 1 branch only see their own leads + subordinate leads.
      const shouldSeeAllBranchLeads = userRole === 'manager' || (userRole === 'assistant_manager' && branchIds && branchIds.length > 1);

      if (shouldSeeAllBranchLeads && branchIds && branchIds.length > 0) {
        orConditions.push(Query.equal('branchId', branchIds));
      }

      try {
        // Fetch subordinates (TLs and Agents)
        const { getSubordinates, getUserById } = await import('@/lib/services/user-service');
        const subordinates = await getSubordinates(userId);

        if (subordinates.length > 0) {
          const subordinateIds = subordinates.map(s => s.$id);
          orConditions.push(Query.equal('ownerId', subordinateIds));
          orConditions.push(Query.equal('assignedToId', subordinateIds));
        }

        // Fetch managers of this user (upwards)
        const currentUser = await getUserById(userId);
        const managerIds: string[] = [];
        if (currentUser.managerId) managerIds.push(currentUser.managerId);
        if (currentUser.managerIds && currentUser.managerIds.length > 0) {
            currentUser.managerIds.forEach(mid => {
                if (!managerIds.includes(mid)) managerIds.push(mid);
            });
        }

        if (managerIds.length > 0) {
            orConditions.push(Query.equal('ownerId', managerIds));
        }

      } catch (err) {
        console.error('Error fetching subordinates/managers for lead visibility:', err);
      }

      if (orConditions.length > 1) {
         queries.push(Query.or(orConditions));
      } else {
         queries.push(orConditions[0]);
      }
    } else if (userRole === 'team_lead') {
      // Team Leads see:
      // 1. Leads in their branches
      // 2. Leads they created (ownerId = userId)
      // 3. Leads created by their assigned agents (ownerId IN agentIds)

      const orConditions = [
        Query.equal('ownerId', userId),
      ];

      if (branchIds && branchIds.length > 0) {
        orConditions.push(Query.equal('branchId', branchIds));
      }

      try {
        // Dynamic import to avoid potential circular dependencies
        const { getAgentsByTeamLead } = await import('@/lib/services/user-service');
        const agents = await getAgentsByTeamLead(userId);

        if (agents.length > 0) {
          const agentIds = agents.map(a => a.$id);
          orConditions.push(Query.equal('ownerId', agentIds));
        }
      } catch (err) {
        console.error('Error fetching team agents for lead visibility:', err);
      }

      if (orConditions.length > 1) {
        queries.push(Query.or(orConditions));
      } else {
        queries.push(orConditions[0]);
      }
    }

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

    // Apply assigned agent filter (for managers and admins)
    if (filters.assignedToId && (userRole === 'manager' || userRole === 'team_lead' || userRole === 'admin' || userRole === 'assistant_manager')) {
      queries.push(Query.equal('assignedToId', filters.assignedToId));
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
  } catch (error: any) {
    console.error('Error listing leads:', error);
    throw new Error(error.message || 'Failed to list leads');
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
    actorName?: string
): Promise<Lead> {
  try {
    // Get the current lead to preserve owner and assigned agent
    const currentLead = await getLead(leadId);

    // Build new permissions (read-only for agent, full access for owner)
    const permissions: string[] = [
      Permission.read(Role.user(currentLead.ownerId)),
      Permission.update(Role.user(currentLead.ownerId)),
      Permission.delete(Role.user(currentLead.ownerId)),
    ];

    // Agent gets read-only access
    if (currentLead.assignedToId) {
      permissions.push(Permission.read(Role.user(currentLead.assignedToId)));
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
            metadata: { isClosed: true, status: closedStatus }
        });
    }

    return lead as unknown as Lead;
  } catch (error: any) {
    console.error('Error closing lead:', error);
    throw new Error(error.message || 'Failed to close lead');
  }
}

/**
 * Reopen a closed lead (manager only)
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
    // Get the current lead
    const currentLead = await getLead(leadId);

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
            metadata: { isClosed: false }
        });
    }

    return lead as unknown as Lead;
  } catch (error: any) {
    console.error('Error reopening lead:', error);
    throw new Error(error.message || 'Failed to reopen lead');
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
    // Get the current lead
    const currentLead = await getLead(leadId);

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
            metadata: { assignedToId: agentId }
        });
    }

    return lead as unknown as Lead;
  } catch (error: any) {
    console.error('Error assigning lead:', error);
    throw new Error(error.message || 'Failed to assign lead');
  }
}
