import { Permission, Role, Query } from 'appwrite';
import { databases, DATABASE_ID, COLLECTIONS } from '@/lib/appwrite';
import { Lead, CreateLeadInput, LeadData, LeadListFilters, UserRole } from '@/lib/types';
import { validateLeadUniqueness } from '@/lib/services/lead-validator';
import { logAction } from './audit-service';

/**
 * Create a new lead
 *
 * This function creates a new lead with the provided data.
 * It validates lead uniqueness (email/phone) across all branches before creation.
 * It automatically sets ownerId to the creating user's ID (Requirement 4.1).
 * It sets the branchId from the input (auto-set from user's branch, or admin-specified).
 * It sets document-level permissions based on owner and assigned agent.
 *
 * @param creatingUserId - The ID of the user creating the lead (auto-set as ownerId)
 * @param input - The lead creation input
 * @param creatingUserName - The name of the user creating the lead (optional, for logging)
 * @returns The created lead
 */
export async function createLead(creatingUserId: string, input: CreateLeadInput, creatingUserName?: string): Promise<Lead> {
  try {
    // Validate lead uniqueness before creating
    const validation = await validateLeadUniqueness(input.data);
    if (!validation.isValid) {
      throw new Error(
        `Duplicate ${validation.duplicateField} found in lead ${validation.existingLeadId}` +
        (validation.existingBranchId ? ` (branch: ${validation.existingBranchId})` : '')
      );
    }

    // Auto-set ownerId to the creating user's ID (Requirement 4.1)
    const ownerId = creatingUserId;

    // Serialize lead data to JSON
    const dataJson = JSON.stringify(input.data);

    // Build permissions array
    const permissions: string[] = [
      // Owner (creator) has full access
      Permission.read(Role.user(ownerId)),
      Permission.update(Role.user(ownerId)),
      Permission.delete(Role.user(ownerId)),
    ];

    // If assigned to an agent, grant them read and update access
    if (input.assignedToId) {
      permissions.push(
        Permission.read(Role.user(input.assignedToId)),
        Permission.update(Role.user(input.assignedToId))
      );
    }

    // Create the lead document with branchId
    const lead = await databases.createDocument(
      DATABASE_ID,
      COLLECTIONS.LEADS,
      'unique()',
      {
        data: dataJson,
        status: input.status || 'New',
        ownerId: ownerId,
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
            actorId: creatingUserId,
            actorName: creatingUserName,
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
      // Agents see only leads assigned to them
      queries.push(Query.equal('assignedToId', userId));
    } else if (userRole === 'admin') {
      // Admins see all leads across all branches — no branch/owner filter
    } else if (userRole === 'manager') {
      // Managers can see all leads from all branches (no filtering needed)
    } else if (userRole === 'team_lead') {
      // Team Leads see only leads in their branches
      if (branchIds && branchIds.length > 0) {
        queries.push(Query.equal('branchId', branchIds));
      } else {
        // Team Lead without branches sees only their own leads
        queries.push(Query.equal('ownerId', userId));
      }
    }

    // Filter by closed status (default to active leads)
    if (filters.isClosed !== undefined) {
      queries.push(Query.equal('isClosed', filters.isClosed));
    } else {
      queries.push(Query.equal('isClosed', false));
    }

    // Apply status filter
    if (filters.status) {
      queries.push(Query.equal('status', filters.status));
    }

    // Apply assigned agent filter (for managers and admins)
    if (filters.assignedToId && (userRole === 'manager' || userRole === 'team_lead' || userRole === 'admin')) {
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
