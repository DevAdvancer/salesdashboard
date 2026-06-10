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
import { notifyDuplicateLeadUpdateAttemptAction } from "@/app/actions/lead-duplicates";
import { normalizeLinkedinProfileUrl } from "@/lib/utils/linkedin";
import { listAllDocuments } from "@/lib/server/appwrite-pagination";
import {
  isAllowedLeadStatusTransition,
  normalizeLeadStatus,
} from "@/lib/utils/lead-status-workflow";

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
function normalizeDuplicateFieldValue(
    field: 'email' | 'phone' | 'linkedinProfileUrl',
    value: unknown
) {
    if (typeof value !== 'string') return '';
    if (field === 'email') return value.trim().toLowerCase();
    if (field === 'phone') {
        const digits = value.replace(/\D/g, '');
        return digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
    }
    return normalizeLinkedinProfileUrl(value) ?? '';
}

const REQUIRED_LEAD_FIELD_LABELS: Record<string, string> = {
    firstName: 'First Name',
    lastName: 'Last Name',
    name: 'Name',
    legalName: 'Legal Name',
    email: 'Email',
    phone: 'Phone',
    visaStatus: 'Visa Status',
    linkedinProfileUrl: 'LinkedIn profile URL',
    linkedinProfile: 'LinkedIn profile URL',
};

function isBlankLeadValue(value: unknown) {
    if (typeof value === 'string') return value.trim().length === 0;
    if (Array.isArray(value)) return value.length === 0;
    return value === null || value === undefined;
}

function shouldIgnoreLinkedinDuplicate(
    doc: Record<string, unknown>,
    leadData: LeadData,
) {
    const status = typeof doc.status === 'string' ? doc.status : leadData.status;
    const normalizedStatus = normalizeLeadStatus(status);
    return normalizedStatus === 'notinterested' || normalizedStatus === 'backedout';
}

function assertRequiredLeadData(data: LeadData) {
    for (const [key, label] of Object.entries(REQUIRED_LEAD_FIELD_LABELS)) {
        if (Object.prototype.hasOwnProperty.call(data, key) && isBlankLeadValue(data[key])) {
            throw new Error(`${label} is required.`);
        }
    }
}

async function validateLeadUniqueness(
    data: LeadData,
    excludeLeadId?: string
): Promise<{
    isValid: boolean;
    duplicateField?: 'email' | 'phone' | 'linkedinProfileUrl';
    existingLeadId?: string;
    existingBranchId?: string;
}> {
    const { databases } = await createAdminClient();
    const email = data.email as string | undefined;
    const phone = data.phone as string | undefined;
    const linkedinProfileUrl = (data as any).linkedinProfileUrl as string | undefined;
    const linkedinProfile = (data as any).linkedinProfile as string | undefined;
    const linkedinValue = (linkedinProfileUrl || linkedinProfile || '').trim();
    const documents = await listAllDocuments<any>({
        databases,
        databaseId: DATABASE_ID,
        collectionId: LEADS_COLLECTION_ID,
        queries: [Query.orderAsc('$id')],
        pageLimit: 100,
        maxPages: 500,
    });

    if (email) {
        const inputEmail = normalizeDuplicateFieldValue('email', email);
        for (const doc of documents) {
            if (excludeLeadId && doc.$id === excludeLeadId) continue;
            try {
                const leadData = JSON.parse(doc.data as string) as LeadData;
                if (inputEmail && normalizeDuplicateFieldValue('email', leadData.email) === inputEmail) {
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
        const inputPhone = normalizeDuplicateFieldValue('phone', phone);
        for (const doc of documents) {
            if (excludeLeadId && doc.$id === excludeLeadId) continue;
            try {
                const leadData = JSON.parse(doc.data as string) as LeadData;
                if (inputPhone && normalizeDuplicateFieldValue('phone', leadData.phone) === inputPhone) {
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

    if (linkedinValue) {
        const inputNormalized = normalizeLinkedinProfileUrl(linkedinValue);
        if (inputNormalized) {
            for (const doc of documents) {
                if (excludeLeadId && doc.$id === excludeLeadId) continue;
                try {
                    const leadData = JSON.parse(doc.data as string) as LeadData;
                    const docNormalized = normalizeLinkedinProfileUrl(
                      (leadData as any).linkedinProfileUrl || (leadData as any).linkedinProfile,
                    );
                    if (docNormalized && docNormalized === inputNormalized) {
                        if (shouldIgnoreLinkedinDuplicate(doc as Record<string, unknown>, leadData)) {
                            continue;
                        }
                        return {
                            isValid: false,
                            duplicateField: 'linkedinProfileUrl',
                            existingLeadId: doc.$id,
                            existingBranchId: (doc.branchId as string) || undefined,
                        };
                    }
                } catch {}
            }
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
    const agents = await listAllDocuments<{ $id: string }>({
      databases,
      databaseId: DATABASE_ID,
      collectionId: COLLECTIONS.USERS,
      queries: [
        Query.equal('teamLeadId', viewerId),
        Query.or([Query.equal('role', 'agent'), Query.equal('role', 'lead_generation')]),
        Query.orderAsc('$id'),
      ],
      pageLimit: 100,
      maxPages: 100,
    });

    return [viewerId, ...agents.map((agent) => agent.$id)];
  }

  const users = await listAllDocuments<HierarchyUserDocument>({
    databases,
    databaseId: DATABASE_ID,
    collectionId: COLLECTIONS.USERS,
    queries: [Query.orderAsc('$id')],
    pageLimit: 100,
    maxPages: 500,
  });

  return getVisibleHierarchyUserIds(viewerId, viewerRole, users);
}

type TeamLeadScopedUserDocument = {
  $id: string;
  role?: UserRole;
};

async function getTeamLeadLeadVisibilityScope(databases: any, viewerId: string): Promise<{
  ownerVisibleUserIds: string[];
  assignmentVisibleUserIds: string[];
}> {
  const teamUsers = await listAllDocuments<TeamLeadScopedUserDocument>({
    databases,
    databaseId: DATABASE_ID,
    collectionId: COLLECTIONS.USERS,
    queries: [
      Query.equal('teamLeadId', viewerId),
      Query.or([Query.equal('role', 'agent'), Query.equal('role', 'lead_generation')]),
      Query.orderAsc('$id'),
    ],
    pageLimit: 100,
    maxPages: 100,
  });

  const assignmentVisibleUserIds = [viewerId, ...teamUsers.map((user) => user.$id)];
  const ownerVisibleUserIds = [
    viewerId,
    ...teamUsers
      .filter((user) => user.role === 'agent')
      .map((user) => user.$id),
  ];

  return { ownerVisibleUserIds, assignmentVisibleUserIds };
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

function appendTeamLeadLeadVisibilityQuery(
  queries: string[],
  ownerVisibleUserIds: string[],
  assignmentVisibleUserIds: string[],
  specialBranchId?: string | null,
  branchIds?: string[],
  includeBackedOutForBranches?: boolean,
) {
  const orConditions = [
    Query.equal('ownerId', ownerVisibleUserIds),
    Query.equal('assignedToId', assignmentVisibleUserIds),
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

function isMonitorRole(role: UserRole) {
  return role === 'monitor';
}

function isOperationsRole(role: UserRole) {
  return role === 'operations';
}

function isAdminLikeReadAllRole(role: UserRole) {
  return role === 'admin' || role === 'developer' || role === 'monitor' || role === 'operations';
}

async function assertLeadReopenAllowed(
  databases: Awaited<ReturnType<typeof createAdminClient>>['databases'],
  actorDoc: UserDocument,
  lead: Lead
) {
  if (isOperationsRole(actorDoc.role)) {
    throw new Error('Permission denied');
  }

  if (isMonitorRole(actorDoc.role)) {
    if (lead.ownerId === actorDoc.$id) return;
    throw new Error('Permission denied');
  }

  if (actorDoc.role === 'admin' || actorDoc.role === 'developer') return;

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

async function assertLeadUpdateAllowed(
  databases: Awaited<ReturnType<typeof createAdminClient>>['databases'],
  actorDoc: UserDocument,
  lead: Lead
) {
  if (isOperationsRole(actorDoc.role)) {
    throw new Error('Permission denied');
  }

  if (isMonitorRole(actorDoc.role)) {
    if (lead.ownerId === actorDoc.$id) return;
    throw new Error('Permission denied');
  }

  if (actorDoc.role === 'admin' || actorDoc.role === 'developer') return;

  const specialBranchId = getSpecialBranchLeadAccess(actorDoc.email);
  if (specialBranchId && lead.branchId === specialBranchId) return;

  if (lead.ownerId === actorDoc.$id || lead.assignedToId === actorDoc.$id) {
    return;
  }

  if (actorDoc.role === 'lead_generation') {
    throw new Error('Permission denied');
  }

  const visibleUserIds = await getLeadVisibilityUserIds(databases, actorDoc.$id, actorDoc.role);
  if (
    visibleUserIds.includes(lead.ownerId) ||
    (lead.assignedToId ? visibleUserIds.includes(lead.assignedToId) : false)
  ) {
    return;
  }

  throw new Error('Permission denied');
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

function getDuplicateValue(data: LeadData, field: 'email' | 'phone' | 'linkedinProfileUrl') {
  if (field === 'linkedinProfileUrl') {
    const value = (data.linkedinProfileUrl ?? data.linkedinProfile) as unknown;
    return typeof value === 'string' ? value : undefined;
  }

  const value = data[field] as unknown;
  return typeof value === 'string' ? value : undefined;
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

export async function createLeadAction(
    ownerId: string,
    input: CreateLeadInput,
    creatingUserId?: string,
    creatingUserName?: string
): Promise<Lead> {
    try {
        await assertAuthenticatedUserId(creatingUserId || ownerId);
        const { databases } = await createAdminClient();

        const finalOwnerId = creatingUserId || ownerId;
        if (!isValidId(finalOwnerId)) {
             throw new Error(`Invalid owner ID format: "${finalOwnerId}"`);
        }

        const actorDoc = await databases.getDocument(
            DATABASE_ID,
            COLLECTIONS.USERS,
            finalOwnerId
        ) as unknown as UserDocument;

        if (isOperationsRole(actorDoc.role)) {
            throw new Error('Permission denied');
        }

        assertRequiredLeadData(input.data);

        // Validate uniqueness
        const validation = await validateLeadUniqueness(input.data);
        if (!validation.isValid) {
            throw new Error(
                `Duplicate ${validation.duplicateField} found in lead ${validation.existingLeadId}` +
                (validation.existingBranchId ? ` (branch: ${validation.existingBranchId})` : '')
            );
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

export async function updateLeadAction(
    leadId: string,
    data: Partial<LeadData>,
    actorId: string,
    actorName?: string
): Promise<Lead> {
    await assertAuthenticatedUserId(actorId);
    const { databases } = await createAdminClient();

    try {
        const actorDoc = await databases.getDocument(
            DATABASE_ID,
            COLLECTIONS.USERS,
            actorId
        ) as unknown as UserDocument;

        const currentLead = await databases.getDocument(
            DATABASE_ID,
            LEADS_COLLECTION_ID,
            leadId
        ) as unknown as Lead;
        await assertLeadUpdateAllowed(databases, actorDoc, currentLead);

        const currentData = JSON.parse(currentLead.data) as LeadData;
        const updatedData = { ...currentData, ...data };

        assertRequiredLeadData(updatedData);

        const nextStatus = (updatedData as any).status;
        if (nextStatus) {
            const previousStatus = currentLead.status;
            const shouldEnforceWorkflow =
                isLinkedinRequestLeadData(updatedData) ||
                ['interested', 'notinterested', 'pipelinefollowup', 'signedclosure', 'backedout'].includes(
                    normalizeLeadStatus(previousStatus),
                ) ||
                ['pipelinefollowup', 'signedclosure', 'backedout'].includes(
                    normalizeLeadStatus(nextStatus),
                );
            if (
                shouldEnforceWorkflow &&
                !isAllowedLeadStatusTransition(previousStatus, nextStatus)
            ) {
                throw new Error('Invalid status transition for this lead.');
            }
        }

        const validation = await validateLeadUniqueness(updatedData, leadId);
        if (!validation.isValid && validation.duplicateField && validation.existingLeadId) {
            try {
                await notifyDuplicateLeadUpdateAttemptAction({
                    actorId,
                    actorName: actorName || actorDoc.$id,
                    leadId,
                    duplicateField: validation.duplicateField,
                    duplicateValue: getDuplicateValue(updatedData, validation.duplicateField),
                    existingLeadId: validation.existingLeadId,
                });
            } catch (error) {
                console.error('Failed to notify duplicate lead update attempt:', error);
            }

            throw new Error(
                `Duplicate ${validation.duplicateField} found in lead ${validation.existingLeadId}` +
                (validation.existingBranchId ? ` (branch: ${validation.existingBranchId})` : '')
            );
        }

        const lead = await databases.updateDocument(
            DATABASE_ID,
            LEADS_COLLECTION_ID,
            leadId,
            {
                data: JSON.stringify(updatedData),
                status: (updatedData.status as string) || currentLead.status,
            }
        );

        if (actorName) {
            try {
                await databases.createDocument(
                    DATABASE_ID,
                    process.env.NEXT_PUBLIC_APPWRITE_AUDIT_LOGS_COLLECTION_ID!,
                    ID.unique(),
                    {
                        action: 'LEAD_UPDATE',
                        actorId,
                        actorName,
                        targetId: leadId,
                        targetType: 'LEAD',
                        metadata: JSON.stringify({
                            leadName: getLeadAuditName(updatedData),
                            changes: buildAuditChanges(currentData, updatedData, data),
                            ...data,
                        }),
                        performedAt: new Date().toISOString(),
                    }
                );
            } catch (error) {
                console.error('Failed to log lead update action', error);
            }
        }

        return lead as unknown as Lead;
    } catch (error: any) {
        console.error('Error updating lead (action):', error);
        throw new Error(error.message || 'Failed to update lead');
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

export async function getLeadAction(
  leadId: string,
  viewerId: string
): Promise<Lead> {
  await assertAuthenticatedUserId(viewerId);
  const { databases } = await createAdminClient();

  try {
    const viewerDoc = await databases.getDocument(
      DATABASE_ID,
      COLLECTIONS.USERS,
      viewerId
    ) as unknown as UserDocument;

    const lead = await databases.getDocument(
      DATABASE_ID,
      LEADS_COLLECTION_ID,
      leadId
    ) as unknown as Lead;

    if (isAdminLikeReadAllRole(viewerDoc.role)) {
      return lead;
    }

    const specialBranchId = getSpecialBranchLeadAccess(viewerDoc.email);
    if (specialBranchId && lead.branchId === specialBranchId) {
      return lead;
    }

    if (lead.ownerId === viewerId || lead.assignedToId === viewerId) {
      return lead;
    }

    if (viewerDoc.role === 'lead_generation') {
      throw new Error('Permission denied');
    }

    const visibleUserIds = await getLeadVisibilityUserIds(databases, viewerId, viewerDoc.role);
    if (
      visibleUserIds.includes(lead.ownerId) ||
      (lead.assignedToId ? visibleUserIds.includes(lead.assignedToId) : false)
    ) {
      return lead;
    }

    throw new Error('Permission denied');
  } catch (error: any) {
    console.error('Error fetching lead (action):', error);
    throw new Error(error.message || 'Failed to fetch lead');
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
    } else if (isAdminLikeReadAllRole(userRole)) {
      // Admins and Managers see all leads across all branches — no branch/owner filter
      if (filters.teamLeadId) {
        const agents = await listAllDocuments<{ $id: string }>({
          databases,
          databaseId: DATABASE_ID,
          collectionId: COLLECTIONS.USERS,
          queries: [
            Query.equal('teamLeadId', filters.teamLeadId),
            Query.or([Query.equal('role', 'agent'), Query.equal('role', 'lead_generation')]),
            Query.orderAsc('$id'),
          ],
          pageLimit: 100,
          maxPages: 100,
        });

        const teamIds = [filters.teamLeadId, ...agents.map((agent) => agent.$id)];
        queries.push(
          Query.or([Query.equal('ownerId', teamIds), Query.equal('assignedToId', teamIds)]),
        );
      }
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
      const { ownerVisibleUserIds, assignmentVisibleUserIds } =
        await getTeamLeadLeadVisibilityScope(databases, userId);
      appendTeamLeadLeadVisibilityQuery(
        queries,
        ownerVisibleUserIds,
        assignmentVisibleUserIds,
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
      const normalized = statusText.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
      if (normalized === 'backout' || normalized === 'backedout') {
        queries.push(Query.equal('status', ['Backout', 'Backed Out', 'Backedout', 'Backed out']));
      } else if (normalized === 'notinterested') {
        queries.push(Query.equal('status', ['Not-Interested', 'Not Interested']));
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

    // Apply search query filter (in-memory)
    let leads = await listAllDocuments<Lead>({
      databases,
      databaseId: DATABASE_ID,
      collectionId: LEADS_COLLECTION_ID,
      queries,
      pageLimit: 100,
      maxPages: 500,
    });

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
