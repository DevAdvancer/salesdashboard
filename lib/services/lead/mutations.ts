import { Permission, Role } from 'appwrite';
import { databases, DATABASE_ID, COLLECTIONS } from '@/lib/appwrite';
import { Lead, CreateLeadInput, LeadData } from '@/lib/types';
import { validateLeadUniqueness } from '@/lib/services/lead-validator';
import { logAction } from '@/lib/services/audit-service';
import { getUserById } from '@/lib/services/user-service';
import { getErrorMessage } from '@/lib/utils';
import { isAllowedLeadStatusTransition, normalizeLeadStatus } from '@/lib/utils/lead-status-workflow';

import { getLead } from './queries';
import { getHierarchyPermissions } from './visibility';
import {
  isLinkedinRequestLeadData,
} from './utils';
import { isValidId, getLeadAuditName, buildAuditChanges } from "../../../app/actions/lead/sync-helpers";

export async function assertActorCanMutateLead(actorId?: string) {
  if (!actorId) return;
  const actor = await getUserById(actorId);
  if (actor.role === 'operations') {
    throw new Error('Permission denied');
  }
}

export async function createLead(
    ownerId: string,
    input: CreateLeadInput,
    creatingUserId?: string,
    creatingUserName?: string
): Promise<Lead> {
  try {
    await assertActorCanMutateLead(creatingUserId || ownerId);

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

    const dataWithCreator = {
      ...input.data,
      creatorId: finalOwnerId,
    };
    const dataJson = JSON.stringify(dataWithCreator);

    const ownerDoc = await getUserById(finalOwnerId);
    const ownerIsMonitor = ownerDoc.role === 'monitor';

    const permissions: string[] = [
      Permission.read(Role.user(finalOwnerId)),
    ];
    if (ownerDoc.role !== 'operations') {
      permissions.push(
        Permission.update(Role.user(finalOwnerId)),
        Permission.delete(Role.user(finalOwnerId)),
      );
    }

    const ownerHierarchyPerms = await getHierarchyPermissions(finalOwnerId);
    permissions.push(...ownerHierarchyPerms);

    if (input.assignedToId) {
      if (isValidId(input.assignedToId)) {
          permissions.push(Permission.read(Role.user(input.assignedToId)));
          if (!ownerIsMonitor || input.assignedToId !== finalOwnerId) {
            permissions.push(Permission.update(Role.user(input.assignedToId)));
          }

          const assignedHierarchyPerms = await getHierarchyPermissions(input.assignedToId);
          permissions.push(...assignedHierarchyPerms);
      } else {
          console.warn(`[createLead] Skipped invalid assignedToId: "${input.assignedToId}"`);
      }
    }

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

export async function updateLead(
    leadId: string,
    data: Partial<LeadData>,
    actorId?: string,
    actorName?: string
): Promise<Lead> {
  try {
    await assertActorCanMutateLead(actorId);

    let actorRole: import('@/lib/types').UserRole | undefined;
    if (actorId) {
      try {
        const actor = await getUserById(actorId);
        actorRole = actor.role as import('@/lib/types').UserRole;
      } catch {
        actorRole = undefined;
      }
    }

    const currentLead = await getLead(leadId);
    const currentData = JSON.parse(currentLead.data) as LeadData;

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

    const validation = await validateLeadUniqueness(updatedData, leadId);
    if (!validation.isValid) {
      throw new Error(
        `Duplicate ${validation.duplicateField} found in lead ${validation.existingLeadId}` +
        (validation.existingBranchId ? ` (branch: ${validation.existingBranchId})` : '')
      );
    }

    const dataJson = JSON.stringify(updatedData);

    const lead = await databases.updateDocument(
      DATABASE_ID,
      COLLECTIONS.LEADS,
      leadId,
      {
        data: dataJson,
        status: updatedData.status || currentLead.status,
      }
    );

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

export async function reopenLead(
    leadId: string,
    actorId?: string,
    actorName?: string
): Promise<Lead> {
  try {
    await assertActorCanMutateLead(actorId);

    const currentLead = await getLead(leadId);
    let leadName = '';
    try {
      leadName = getLeadAuditName(JSON.parse(currentLead.data) as LeadData);
    } catch {}

    const permissions: string[] = [
      Permission.read(Role.user(currentLead.ownerId)),
      Permission.update(Role.user(currentLead.ownerId)),
      Permission.delete(Role.user(currentLead.ownerId)),
    ];

    if (currentLead.assignedToId) {
      permissions.push(
        Permission.read(Role.user(currentLead.assignedToId)),
        Permission.update(Role.user(currentLead.assignedToId))
      );
    }

    const lead = await databases.updateDocument(
      DATABASE_ID,
      COLLECTIONS.LEADS,
      leadId,
      {
        isClosed: false,
      },
      permissions
    );

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

export async function assignLead(
    leadId: string,
    agentId: string,
    actorId?: string,
    actorName?: string
): Promise<Lead> {
  try {
    await assertActorCanMutateLead(actorId);

    const currentLead = await getLead(leadId);
    let leadName = '';
    try {
      leadName = getLeadAuditName(JSON.parse(currentLead.data) as LeadData);
    } catch {}

    const permissions: string[] = [
      Permission.read(Role.user(currentLead.ownerId)),
      Permission.update(Role.user(currentLead.ownerId)),
      Permission.delete(Role.user(currentLead.ownerId)),
    ];

    if (!currentLead.isClosed) {
      permissions.push(
        Permission.read(Role.user(agentId)),
        Permission.update(Role.user(agentId))
      );
    } else {
      permissions.push(Permission.read(Role.user(agentId)));
    }

    const lead = await databases.updateDocument(
      DATABASE_ID,
      COLLECTIONS.LEADS,
      leadId,
      {
        assignedToId: agentId,
      },
      permissions
    );

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
