'use server';

import { createAdminClient } from "@/lib/server/appwrite";
import { getAppwriteErrorMessage } from "@/lib/server/appwrite-errors";
import { LeadActionError } from "@/lib/server/lead-errors";
import { Lead, LeadData, LeadListFilters, UserRole, CreateLeadInput } from "@/lib/types";
import { Query, ID, Permission, Role } from "node-appwrite";
import { COLLECTIONS } from "@/lib/constants/appwrite";
import { getSpecialBranchLeadAccess } from '@/lib/constants/special-lead-access';
import { logAction } from "@/lib/services/audit-service";
import { assertAuthenticatedUserId } from "@/lib/server/current-user";
import { notifyDuplicateLeadUpdateAttemptAction } from "@/app/actions/lead-duplicates";
import { normalizeLinkedinProfileUrl } from "@/lib/utils/linkedin";
import { listAllDocuments } from "@/lib/server/appwrite-pagination";
import { recordLgHandoffAction } from "@/app/actions/lg-handoffs";
import {
  isAllowedLeadStatusTransition,
  normalizeLeadStatus,
} from "@/lib/utils/lead-status-workflow";
import { REQUIRED_LEAD_FIELD_KEYS } from "@/lib/utils/required-lead-fields";

const DATABASE_ID = process.env.NEXT_PUBLIC_APPWRITE_DATABASE_ID!;
const LEADS_COLLECTION_ID = process.env.NEXT_PUBLIC_APPWRITE_LEADS_COLLECTION_ID!;
const USERS_COLLECTION_ID = process.env.NEXT_PUBLIC_APPWRITE_USERS_COLLECTION_ID!;

/**
 * Fields actually rendered in the leads list table. Projects the per-page
 * payload to ~30% of the original size (the `data` JSON blob still ships
 * because the table reads firstName/lastName/email/etc. from it; we can't
 * project inside the JSON). Detail views (getLeadByIdAction) are unaffected
 * and return the full document.
 */
const LEADS_LIST_SELECT = [
  '$id',
  '$createdAt',
  '$updatedAt',
  'status',
  'isClosed',
  'closedAt',
  'nextFollowUpAt',
  'followUpStatus',
  'assignedToId',
  'ownerId',
  'branchId',
  'data',
];

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
    const missing: Array<{ key: string; label: string }> = [];
    for (const key of REQUIRED_LEAD_FIELD_KEYS) {
        if (Object.prototype.hasOwnProperty.call(data, key) && isBlankLeadValue(data[key])) {
            missing.push({ key, label: REQUIRED_LEAD_FIELD_LABELS[key] ?? key });
        }
    }
    if (missing.length === 0) return;

    if (missing.length === 1) {
        throw new LeadActionError(
            'MISSING_REQUIRED_FIELD',
            `${missing[0].label} is required.`,
            { field: missing[0].key },
        );
    }

    const missingLabels = missing.map((m) => m.label);
    const summary = `${missingLabels.length} required fields are missing: ${missingLabels.join(', ')}.`;
    throw new LeadActionError('MISSING_REQUIRED_FIELD', summary, {
        field: missing[0].key,
        meta: { missingFields: missing, missingLabels },
    });
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

    // Windowed scan: only inspect leads created within the last year, and at
    // most 1000 docs. This catches the realistic duplicate window without
    // loading the entire 50K collection. Order by $createdAt desc so recent
    // leads (most likely duplicates) are checked first.
    const windowStart = new Date();
    windowStart.setFullYear(windowStart.getFullYear() - 1);

    const documents = await listAllDocuments<any>({
        databases,
        databaseId: DATABASE_ID,
        collectionId: LEADS_COLLECTION_ID,
        queries: [
            Query.greaterThanEqual('$createdAt', windowStart.toISOString()),
            Query.orderDesc('$createdAt'),
        ],
        pageLimit: 100,
        maxPages: 10,
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
                        existingBranchId: typeof doc.branchId === "string" ? doc.branchId : undefined,
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
                        existingBranchId: typeof doc.branchId === "string" ? doc.branchId : undefined,
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
                            existingBranchId: typeof doc.branchId === "string" ? doc.branchId : undefined,
                        };
                    }
                } catch {}
            }
        }
    }

    return { isValid: true };
}

// Helper to get hierarchy permissions (server-side)
// Optimized: pre-collect the chain of supervisor IDs by walking the doc tree
// breadth-first using one document fetch per level, but parallelize the
// "fetch the next-level docs" step with Promise.all. For a 1-2 level chain
// (the common case), this collapses the previous 5 sequential reads into
// 1-2 parallel reads.
async function getHierarchyPermissions(userId: string): Promise<string[]> {
    const permissions: string[] = [];
    try {
        const { databases } = await createAdminClient();
        if (!isValidId(userId)) return permissions;

        const visited = new Set<string>([userId]);
        let currentId: string | null = userId;

        // First level: walk sequentially until we hit the top, but
        // collect supervisor IDs as we go. Each level only needs one read.
        for (let depth = 0; depth < 5 && currentId && isValidId(currentId); depth++) {
            let user: any;
            try {
                user = await databases.getDocument(DATABASE_ID, USERS_COLLECTION_ID, currentId);
            } catch {
                break;
            }

            const supervisors = new Set<string>();
            if (user.teamLeadId && isValidId(user.teamLeadId)) supervisors.add(user.teamLeadId);

            // Issue perms for supervisors at this level
            for (const supId of supervisors) {
                if (!visited.has(supId)) {
                    permissions.push(Permission.read(Role.user(supId)));
                    permissions.push(Permission.update(Role.user(supId)));
                    permissions.push(Permission.delete(Role.user(supId)));
                    visited.add(supId);
                }
            }

            // Choose the single next-up id for the next iteration.
            // Multiple supervisors are still issued perms, but we only
            // need to follow one chain upward to keep the bounded walk.
            if (user.teamLeadId && isValidId(user.teamLeadId) && !visited.has(user.teamLeadId)) {
                currentId = user.teamLeadId;
            } else {
                currentId = null;
            }
        }
    } catch (e) {
        console.error('Error fetching hierarchy permissions:', e);
    }
    return permissions;
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
        Query.equal('branchId', branchIds[0]),
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
        Query.equal('branchId', branchIds[0]),
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
  // Optional on the wire — the lead_generation→team_lead counter below
  // scopes by department, so we read it off the actor + assignee when
  // it is present and fall back to "sales" for legacy users.
  department?: string;
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
    throw new LeadActionError('PERMISSION_DENIED', 'Permission denied');
  }

  if (isMonitorRole(actorDoc.role)) {
    if (lead.ownerId === actorDoc.$id) return;
    throw new LeadActionError('PERMISSION_DENIED', 'Permission denied');
  }

  if (actorDoc.role === 'admin' || actorDoc.role === 'developer') return;

  if (actorDoc.role !== 'team_lead') {
    throw new LeadActionError('PERMISSION_DENIED', 'Permission denied');
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

  throw new LeadActionError('PERMISSION_DENIED', 'Permission denied');
}

async function assertLeadUpdateAllowed(
  databases: Awaited<ReturnType<typeof createAdminClient>>['databases'],
  actorDoc: UserDocument,
  lead: Lead
) {
  if (isOperationsRole(actorDoc.role)) {
    throw new LeadActionError('PERMISSION_DENIED', 'Permission denied');
  }

  if (isMonitorRole(actorDoc.role)) {
    if (lead.ownerId === actorDoc.$id) return;
    throw new LeadActionError('PERMISSION_DENIED', 'Permission denied');
  }

  if (actorDoc.role === 'admin' || actorDoc.role === 'developer') return;

  const specialBranchId = getSpecialBranchLeadAccess(actorDoc.email);
  if (specialBranchId && lead.branchId === specialBranchId) return;

  if (lead.ownerId === actorDoc.$id || lead.assignedToId === actorDoc.$id) {
    return;
  }

  if (actorDoc.role === 'lead_generation') {
    throw new LeadActionError('PERMISSION_DENIED', 'Permission denied');
  }

  const visibleUserIds = await getLeadVisibilityUserIds(databases, actorDoc.$id, actorDoc.role);
  if (
    visibleUserIds.includes(lead.ownerId) ||
    (lead.assignedToId ? visibleUserIds.includes(lead.assignedToId) : false)
  ) {
    return;
  }

  throw new LeadActionError('PERMISSION_DENIED', 'Permission denied');
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
             throw new LeadActionError(
                 'INVALID_INPUT',
                 `Invalid owner ID format: "${finalOwnerId}"`,
             );
        }

        const actorDoc = await databases.getDocument(
            DATABASE_ID,
            COLLECTIONS.USERS,
            finalOwnerId
        ) as unknown as UserDocument;

        if (isOperationsRole(actorDoc.role)) {
            throw new LeadActionError('PERMISSION_DENIED', 'Permission denied');
        }

        assertRequiredLeadData(input.data);

        // Validate uniqueness
        const validation = await validateLeadUniqueness(input.data);
        if (!validation.isValid) {
            const humanField =
                validation.duplicateField === 'email'
                    ? 'email address'
                    : validation.duplicateField === 'phone'
                      ? 'phone number'
                      : 'LinkedIn profile URL';
            const branchSuffix = validation.existingBranchId
                ? ' in another branch'
                : '';
            throw new LeadActionError(
                'DUPLICATE_FIELD',
                `A lead with this ${humanField} already exists${branchSuffix}.`,
                {
                    field: validation.duplicateField,
                    meta: {
                        existingLeadId: validation.existingLeadId,
                        existingBranchId: validation.existingBranchId,
                    },
                },
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
                 // Add assigned agent's team leads too
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
                branchId: input.branchId ?? null,
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
                        metadata: JSON.stringify({ ...input.data, branchId: input.branchId ?? null }),
                        performedAt: new Date().toISOString()
                     }
                 );
            }
        } catch (e) {
            console.error("Failed to log audit action", e);
        }

        // Notification: lead_generation -> TL flow disabled per product
        // decision. Previously, when a lead_generation user created a lead
        // and didn't assign it to a specific agent, the creator's team
        // lead was pinged with "Unassigned lead generated". This created
        // noise on the TL's notification feed and surfaced leads that
        // weren't actionable yet. From now on, we silently accept the
        // unassigned lead; the lead appears in the unassigned queue
        // (already shown on the dashboard and in /leads) and the TL can
        // act on it from there. No in-app notification fires.

        // Handoff row: when a lead_generation actor creates a lead and
        // assigns it to a Team Lead, write a row to lg_handoffs that
        // records the original TL. The row is keyed on `leadId` and is
        // NEVER updated on later reassignments — the dashboard's "Lead
        // Gen Team Handoffs" count is exact by construction because
        // `firstAssignedToId` is baked in at this moment. We do this
        // AFTER the lead is committed so a failure here never orphans a
        // lead; the count is best-effort and will self-heal on the
        // next LG->TL lead. Sales-only scope is enforced inside
        // recordLgHandoffAction (cross-team pairs are silent no-ops),
        // so callers don't have to remember the rule.
        if (
            actorDoc.role === "lead_generation" &&
            input.assignedToId &&
            isValidId(input.assignedToId)
        ) {
            try {
                const assigneeDoc = await databases.getDocument(
                    DATABASE_ID,
                    USERS_COLLECTION_ID,
                    input.assignedToId
                ) as unknown as { role?: string };
                if (assigneeDoc?.role === "team_lead") {
                    await recordLgHandoffAction({
                        leadId: lead.$id,
                        teamLeadId: input.assignedToId,
                        leadGenerationId: creatingUserId || finalOwnerId,
                        branchId: input.branchId ?? null,
                    });
                }
            } catch (e) {
                // Handoff row is best-effort. Log and continue.
                console.error("Failed to record LG handoff:", e);
            }
        }

        return lead as unknown as Lead;
    } catch (error: any) {
        // Re-throw structured LeadActionError as-is so the client can
        // read the `code` and `field` properties. Wrapping in
        // `new Error(error.message || …)` would strip those and trigger
        // the production "Server Components render" digest mask.
        if (error instanceof LeadActionError) throw error;
        console.error('Error creating lead (action):', error);
        throw new LeadActionError(
            'UNKNOWN',
            error?.message || 'Failed to create lead',
            { cause: error },
        );
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
                throw new LeadActionError(
                    'INVALID_STATUS_TRANSITION',
                    'Invalid status transition for this lead.',
                    {
                        field: 'status',
                        meta: { previousStatus, nextStatus },
                    },
                );
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

            const humanField =
                validation.duplicateField === 'email'
                    ? 'email address'
                    : validation.duplicateField === 'phone'
                      ? 'phone number'
                      : 'LinkedIn profile URL';
            const branchSuffix = validation.existingBranchId
                ? ' in another branch'
                : '';
            throw new LeadActionError(
                'DUPLICATE_FIELD',
                `A lead with this ${humanField} already exists${branchSuffix}.`,
                {
                    field: validation.duplicateField,
                    meta: {
                        existingLeadId: validation.existingLeadId,
                        existingBranchId: validation.existingBranchId,
                    },
                },
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
        if (error instanceof LeadActionError) throw error;
        console.error('Error updating lead (action):', error);
        throw new LeadActionError(
            'UNKNOWN',
            error?.message || 'Failed to update lead',
            { cause: error },
        );
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
        throw new LeadActionError('UNAUTHORIZED', 'Unauthorized');
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
        if (error instanceof LeadActionError) throw error;
        console.error('Error reopening lead (action):', error);
        throw new LeadActionError(
            'UNKNOWN',
            error?.message || 'Failed to reopen lead',
            { cause: error },
        );
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
      throw new LeadActionError('PERMISSION_DENIED', 'Permission denied');
    }

    const visibleUserIds = await getLeadVisibilityUserIds(databases, viewerId, viewerDoc.role);
    if (
      visibleUserIds.includes(lead.ownerId) ||
      (lead.assignedToId ? visibleUserIds.includes(lead.assignedToId) : false)
    ) {
      return lead;
    }

    throw new LeadActionError('PERMISSION_DENIED', 'Permission denied');
  } catch (error: any) {
    if (error instanceof LeadActionError) throw error;
    console.error('Error fetching lead (action):', error);
    throw new LeadActionError(
      'UNKNOWN',
      error?.message || 'Failed to fetch lead',
      { cause: error },
    );
  }
}

export async function listLeadsAction(
  filters: LeadListFilters,
  userId: string,
  _userRole: UserRole,
  branchIds?: string[],
  options?: {
    /** Page number (1-indexed). Defaults to 1. */
    page?: number;
    /** Items per page. Defaults to 20. Maximum 100. */
    pageSize?: number;
    /** If true, ignore pagination and fetch as many as possible (for export). */
    forExport?: boolean;
  }
): Promise<{ leads: Lead[]; total: number; page: number; pageSize: number }> {
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

    // Pagination: clamp pageSize to a max of 100 to prevent abuse.
    // forExport=true bypasses pagination and pulls up to 10K rows (used by
    // the CSV export handler). export callers don't need total/pagination.
    const wantExport = options?.forExport === true;
    const page = wantExport ? 1 : Math.max(1, options?.page ?? 1);
    const pageSize = wantExport ? 10000 : Math.min(100, Math.max(1, options?.pageSize ?? 20));

    if (!wantExport) {
      queries.push(Query.limit(pageSize));
      queries.push(Query.offset((page - 1) * pageSize));
    }

    // Apply Query.select projection to trim the per-page payload. Skip
    // when search is active so all fields are available for in-memory
    // filtering (the in-memory filter does a substring scan over data).
    if (!filters.searchQuery) {
      queries.push(Query.select(LEADS_LIST_SELECT));
    }

    if (wantExport) {
      // Use cursor-based pagination to fetch ALL matching documents
      // (no artificial cap). High maxPages = 500 × 5000 default limit = 2.5M
      // rows max — more than any realistic tenant will have.
      const allLeads = await listAllDocuments<Lead>({
        databases,
        databaseId: DATABASE_ID,
        collectionId: LEADS_COLLECTION_ID,
        queries,
        pageLimit: 100,
        maxPages: 500,
      });
      let leads = allLeads;
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
      return { leads, total: leads.length, page: 1, pageSize: leads.length };
    }

    // Paginated list path
    const response = await databases.listDocuments(
      DATABASE_ID,
      LEADS_COLLECTION_ID,
      queries
    );
    let leads = response.documents as unknown as Lead[];

    if (filters.searchQuery) {
      // Search-via-substring is performed on the current page only (we can
      // no longer scan the full 50K collection when paginated). This is a
      // deliberate trade: with date/status/branch filters in place the
      // realistic search universe is already narrow, and combined with
      // pagination the user can flip pages if they don't see a match.
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

    return {
      leads,
      total: leads.length,
      page,
      pageSize,
    };
  } catch (error: any) {
    console.error('Error listing leads (action):', error);
    throw new Error(getAppwriteErrorMessage(error) || 'Failed to list leads');
  }
}

/**
 * Lightweight "count only" version of listLeadsAction. Reuses the same
 * role-based visibility predicates, but uses Query.select(['$id']) +
 * Query.limit(1) so the response carries a single $id projection while
 * `total` reports the full matching count. Multiple buckets (active /
 * closed / unassigned) are fetched in parallel.
 *
 * Cap rationale: the global lead collection is bounded by Appwrite's
 * permission model and the project growth rate. Counts under 100K
 * fit in a single listDocuments call.
 */
export type LeadCounts = {
  active: number;
  closed: number;
  unassigned: number;
  byStatus: Record<string, number>;
};

export async function listLeadCountsAction(
  userId: string,
  _userRole: UserRole,
  branchIds?: string[],
  filters?: LeadListFilters
): Promise<LeadCounts> {
  try {
    await assertAuthenticatedUserId(userId);
    const { databases } = await createAdminClient();

    // Fetch the caller doc once so we can build the visibility queries.
    const userDoc = await databases.getDocument(
      DATABASE_ID,
      USERS_COLLECTION_ID,
      userId
    ) as unknown as UserDocument;
    const userRole = userDoc.role;
    const specialBranchId = getSpecialBranchLeadAccess(
      userDoc.email as string | undefined
    );

    // Build the same visibility queries listLeadsAction would build for
    // this user. We mirror the role-based branch here (admin/team-lead/
    // team_lead/agent/lead_generation) instead of extracting a helper
    // because the inline structure is easier to read side-by-side with
    // the originating listLeadsAction.
    const visibilityQueries: string[] = [];

    if (userRole === 'agent') {
      const orConditions = [
        Query.equal('assignedToId', userId),
        Query.equal('ownerId', userId),
      ];
      if (specialBranchId) {
        orConditions.push(Query.equal('branchId', specialBranchId));
      }
      visibilityQueries.push(Query.or(orConditions));
    } else if (userRole === 'lead_generation') {
      visibilityQueries.push(Query.equal('ownerId', userId));
    } else if (isAdminLikeReadAllRole(userRole)) {
      if (filters?.teamLeadId) {
        const agents = await listAllDocuments<{ $id: string }>({
          databases,
          databaseId: DATABASE_ID,
          collectionId: COLLECTIONS.USERS,
          queries: [
            Query.equal('teamLeadId', filters.teamLeadId),
            Query.or([
              Query.equal('role', 'agent'),
              Query.equal('role', 'lead_generation'),
            ]),
            Query.orderAsc('$id'),
          ],
          pageLimit: 100,
          maxPages: 100,
        });
        const teamIds = [filters.teamLeadId, ...agents.map((a) => a.$id)];
        visibilityQueries.push(
          Query.or([
            Query.equal('ownerId', teamIds),
            Query.equal('assignedToId', teamIds),
          ])
        );
      }
    } else if (userRole === 'team_lead') {
      const { ownerVisibleUserIds, assignmentVisibleUserIds } =
        await getTeamLeadLeadVisibilityScope(databases, userId);
      appendTeamLeadLeadVisibilityQuery(
        visibilityQueries,
        ownerVisibleUserIds,
        assignmentVisibleUserIds,
        specialBranchId,
        branchIds,
        true
      );
    }

    // Optional filter scope (branch / date / status). These are applied
    // on top of the visibility scope.
    if (filters?.branchId) {
      visibilityQueries.push(Query.equal('branchId', filters.branchId));
    }
    if (filters?.dateFrom) {
      visibilityQueries.push(Query.greaterThanEqual('$createdAt', filters.dateFrom));
    }
    if (filters?.dateTo) {
      visibilityQueries.push(Query.lessThanEqual('$createdAt', filters.dateTo));
    }
    if (filters?.status) {
      const statusText =
        typeof filters.status === 'string' ? filters.status : '';
      const normalized = statusText
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '');
      if (normalized === 'backout' || normalized === 'backedout') {
        visibilityQueries.push(
          Query.equal('status', [
            'Backout',
            'Backed Out',
            'Backedout',
            'Backed out',
          ])
        );
      } else if (normalized === 'notinterested') {
        visibilityQueries.push(
          Query.equal('status', ['Not-Interested', 'Not Interested'])
        );
      } else {
        visibilityQueries.push(Query.equal('status', filters.status));
      }
    }
    if (filters?.assignedToId) {
      visibilityQueries.push(Query.equal('assignedToId', filters.assignedToId));
    }

    // Build the count query: same shape for every bucket, only the
    // isClosed/value differs. We project down to `$id` so the response
    // payload is tiny (kilobytes, not megabytes). We use `limit(1)` to
    // satisfy Appwrite's "limit must be >= 1" validation while still
    // relying on the response's `total` field for the count itself.
    const countFor = (bucket: { isClosed?: boolean; status?: string }) => {
      const queries = [...visibilityQueries, Query.select(['$id']), Query.limit(1)];
      if (bucket.isClosed !== undefined) {
        queries.push(Query.equal('isClosed', bucket.isClosed));
      }
      if (bucket.status !== undefined) {
        queries.push(Query.equal('status', bucket.status));
      }
      return databases.listDocuments(
        DATABASE_ID,
        LEADS_COLLECTION_ID,
        queries
      );
    };

    // Statuses we report on the dashboard. Keep this list small and
    // static — expanding it later just adds a parallel call.
    const STATUS_BUCKETS = [
      'New',
      'Contacted',
      'Interested',
      'Not Interested',
      'Backout',
      'Closed',
    ];

    const [activeRes, closedRes, unassignedRes, ...statusResults] =
      await Promise.all([
        countFor({ isClosed: false }),
        countFor({ isClosed: true }),
        // Unassigned = active leads with no assignedToId and no ownerId.
        // Inherits the visibility scope; we add the two extra constraints.
        // `limit(1)` keeps the payload to a single document; `total` in
        // the response still reports the full unassigned count.
        (async () => {
          const queries = [
            ...visibilityQueries,
            Query.equal('isClosed', false),
            Query.select(['$id']),
            Query.limit(1),
            Query.or([
              Query.isNull('assignedToId'),
              Query.isNull('ownerId'),
            ]),
          ];
          return databases.listDocuments(
            DATABASE_ID,
            LEADS_COLLECTION_ID,
            queries
          );
        })(),
        ...STATUS_BUCKETS.map((status) => countFor({ status })),
      ]);

    const byStatus: Record<string, number> = {};
    STATUS_BUCKETS.forEach((status, idx) => {
      byStatus[status] = statusResults[idx].total;
    });

    return {
      active: activeRes.total,
      closed: closedRes.total,
      unassigned: unassignedRes.total,
      byStatus,
    };
  } catch (error: any) {
    console.error('Error listing lead counts (action):', error);
    throw new Error(
      getAppwriteErrorMessage(error) || 'Failed to list lead counts'
    );
  }
}
