'use server';
import { createAdminClient } from "@/lib/server/appwrite";
import { getAppwriteErrorMessage } from "@/lib/server/appwrite-errors";
import { LeadActionError } from "@/lib/server/lead-errors";
import { Lead, LeadData, LeadListFilters, UserRole, CreateLeadInput, Department } from "@/lib/types";
import { Query, ID, Permission, Role } from "node-appwrite";
import { COLLECTIONS } from "@/lib/constants/appwrite";
import { getSpecialBranchLeadAccess } from "@/lib/constants/special-lead-access";
import { logAction } from "@/lib/services/audit-service";
import { assertAuthenticatedUserId, getAuthenticatedAccount } from "@/lib/server/current-user";
import { notifyDuplicateLeadUpdateAttemptAction } from "@/app/actions/lead-duplicates";
import { normalizeLinkedinProfileUrl } from "@/lib/utils/linkedin";
import { listAllDocuments } from "@/lib/server/appwrite-pagination";
import { recordLgHandoffAction } from "@/app/actions/lg-handoffs";
import { markPriorNotInterestedRowsReopened, notInterestedLeadAction } from "@/lib/actions/lead/status";
import { isAllowedLeadStatusTransition, normalizeLeadStatus } from "@/lib/utils/lead-status-workflow";
import { REQUIRED_LEAD_FIELD_KEYS } from "@/lib/utils/required-lead-fields";
import { expandIsoDateToStart, expandIsoDateToEnd } from "@/lib/utils/iso-date-range";
import { workingDaysInRange, type KpiRow } from "@/lib/utils/dashboard-kpi";
import { listHolidayDateKeys } from "@/lib/server/holiday-calendar";
import { buildDepartmentScopeQuery, isDepartmentScopeInlineEnabled } from "@/lib/server/department-scope-query";
import { DATABASE_ID, LEADS_COLLECTION_ID, USERS_COLLECTION_ID, LEADS_LIST_SELECT } from "./constants";
import { isValidId, normalizeDuplicateFieldValue, REQUIRED_LEAD_FIELD_LABELS, isBlankLeadValue, shouldIgnoreLinkedinDuplicate, assertRequiredLeadData, validateLeadUniqueness, validateLeadUniquenessAction, enrichDuplicateResult } from "./validation";
import { isNotInterestedStatus, normalizeStatusText, isLinkedinRequestLeadData } from "./status";
import { getHierarchyPermissions, HierarchyUserDocument, getVisibleHierarchyUserIds, getLeadVisibilityUserIds, TeamLeadScopedUserDocument, getTeamLeadLeadVisibilityScope, appendHierarchyLeadVisibilityQuery, appendTeamLeadLeadVisibilityQuery, UserDocument, normalizeDepartment, getDepartmentScopedUserIds, leadMatchesDepartmentScope, isMonitorRole, isOperationsRole, isAdminLikeReadAllRole, assertSalesCrmAccess, assertLeadReopenAllowed, assertLeadUpdateAllowed } from "./visibility";
import { getLeadAction, listLeadsAction, listLeadCountsAction, loadLeadTargetProgressAction, LeadCounts, parseIsoDateLocal, daysInMonthLocal, getUserByIdOrNull, getAgentsByTeamLead, normalizeSource, isReferralSource } from "./queries";

export function parseLeadDataSafely(data: string): LeadData {
    try {
        return JSON.parse(data) as LeadData;
    } catch {
        return {};
    }
}

export async function restoreNotInterestedDuplicateLead(input: {
        databases: Awaited<ReturnType<typeof createAdminClient>>['databases'];
        duplicateLeadId: string;
        nextOwnerId: string;
        createInput: CreateLeadInput;
        actorId: string;
        actorName?: string;
    }): Promise<Lead> {
    const { databases, duplicateLeadId, nextOwnerId, createInput, actorId, actorName } = input;
    const existingLead = await databases.getDocument(
                DATABASE_ID,
                LEADS_COLLECTION_ID,
                duplicateLeadId,
            ) as unknown as Lead;
    if (!isNotInterestedStatus(existingLead.status)) {
        throw new LeadActionError('DUPLICATE_FIELD', 'A lead with this value already exists.', {
            meta: { existingLeadId: duplicateLeadId },
        });
    }

    const currentData = parseLeadDataSafely(existingLead.data);
    const mergedData: LeadData = {
                ...currentData,
                ...createInput.data,
            };
    if (!createInput.data.linkedinRequestId) {
        delete (mergedData as Record<string, unknown>).linkedinRequestId;
    }

    const existingCreatorId = typeof currentData.creatorId === 'string' && currentData.creatorId.trim()
                    ? currentData.creatorId
                    : null;
    mergedData.creatorId = existingCreatorId ?? nextOwnerId;
    const nextAssignedToId = createInput.assignedToId || nextOwnerId;
    const permissions: string[] = [
                Permission.read(Role.user(nextOwnerId)),
                Permission.update(Role.user(nextOwnerId)),
                Permission.delete(Role.user(nextOwnerId)),
            ];
    permissions.push(...await getHierarchyPermissions(nextOwnerId));
    if (nextAssignedToId && nextAssignedToId !== nextOwnerId) {
        permissions.push(
            Permission.read(Role.user(nextAssignedToId)),
            Permission.update(Role.user(nextAssignedToId)),
        );
        permissions.push(...await getHierarchyPermissions(nextAssignedToId));
    }

    const nowIso = new Date().toISOString();
    const reopenedLead = await databases.updateDocument(
                DATABASE_ID,
                LEADS_COLLECTION_ID,
                duplicateLeadId,
                {
                    data: JSON.stringify(mergedData),
                    status: createInput.status || 'New',
                    ownerId: nextOwnerId,
                    assignedToId: nextAssignedToId,
                    branchId: createInput.branchId ?? existingLead.branchId ?? null,
                    isClosed: false,
                    closedAt: null,
                },
                [...new Set(permissions)],
            );
    await markPriorNotInterestedRowsReopened(duplicateLeadId, actorId, databases, nowIso);
    try {
        await databases.createDocument(
            DATABASE_ID,
            process.env.NEXT_PUBLIC_APPWRITE_AUDIT_LOGS_COLLECTION_ID!,
            ID.unique(),
            {
                action: 'LEAD_UPDATE',
                actorId,
                actorName: actorName || 'System',
                targetId: duplicateLeadId,
                targetType: 'LEAD',
                metadata: JSON.stringify({
                    restoredFromStatus: existingLead.status,
                    ownerId: nextOwnerId,
                    assignedToId: nextAssignedToId,
                    isClosed: false,
                    closedAt: null,
                }),
                performedAt: nowIso,
            }
        );
    } catch (error) {
        console.error('Failed to log restored not interested lead', error);
    }

    return reopenedLead as unknown as Lead;
}

export async function createLeadAction(ownerId: string, input: CreateLeadInput, creatingUserId?: string, creatingUserName?: string): Promise<Lead> {
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
            if (validation.existingLeadId) {
                const duplicateStatus = validation.existingLeadStatus;
                const shouldRestoreNotInterested =
                    isNotInterestedStatus(duplicateStatus) ||
                    (!duplicateStatus &&
                        isNotInterestedStatus(
                            (
                                await databases.getDocument(
                                    DATABASE_ID,
                                    LEADS_COLLECTION_ID,
                                    validation.existingLeadId,
                                ) as unknown as Lead
                            ).status,
                        ));

                if (shouldRestoreNotInterested) {
                    return restoreNotInterestedDuplicateLead({
                        databases,
                        duplicateLeadId: validation.existingLeadId,
                        nextOwnerId: finalOwnerId,
                        createInput: input,
                        actorId: creatingUserId || finalOwnerId,
                        actorName: creatingUserName || actorDoc.name || actorDoc.$id,
                    });
                }
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
            const agentNames = [];
            if (validation.existingLeadOwnerName) {
                agentNames.push(`owned by ${validation.existingLeadOwnerName}`);
            }
            if (validation.existingLeadAssignedToName) {
                agentNames.push(`assigned to ${validation.existingLeadAssignedToName}`);
            }
            const agentSuffix = agentNames.length > 0
                ? ` (currently ${agentNames.join(' and ')})`
                : '';
            throw new LeadActionError(
                'DUPLICATE_FIELD',
                `A lead with this ${humanField} already exists${branchSuffix}${agentSuffix}.`,
                {
                    field: validation.duplicateField,
                    meta: {
                        existingLeadId: validation.existingLeadId,
                        existingBranchId: validation.existingBranchId,
                        existingLeadOwnerName: validation.existingLeadOwnerName,
                        existingLeadAssignedToName: validation.existingLeadAssignedToName,
                    },
                },
            );
        }

        const dataWithCreator = {
            ...input.data,
            creatorId: finalOwnerId,
        };
        const dataJson = JSON.stringify(dataWithCreator);

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

export async function updateLeadAction(leadId: string, data: Partial<LeadData>, actorId: string, actorName?: string): Promise<Lead> {
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
            const agentNames = [];
            if (validation.existingLeadOwnerName) {
                agentNames.push(`owned by ${validation.existingLeadOwnerName}`);
            }
            if (validation.existingLeadAssignedToName) {
                agentNames.push(`assigned to ${validation.existingLeadAssignedToName}`);
            }
            const agentSuffix = agentNames.length > 0
                ? ` (currently ${agentNames.join(' and ')})`
                : '';
            throw new LeadActionError(
                'DUPLICATE_FIELD',
                `A lead with this ${humanField} already exists${branchSuffix}${agentSuffix}.`,
                {
                    field: validation.duplicateField,
                    meta: {
                        existingLeadId: validation.existingLeadId,
                        existingBranchId: validation.existingBranchId,
                        existingLeadOwnerName: validation.existingLeadOwnerName,
                        existingLeadAssignedToName: validation.existingLeadAssignedToName,
                    },
                },
            );
        }

        const targetStatus = (updatedData as any).status || currentLead.status;
        if (targetStatus === "Not Interested" && currentLead.status !== "Not Interested") {
            const result = await notInterestedLeadAction(leadId, actorId, actorName || actorDoc.name || actorDoc.$id);
            return result.lead as unknown as Lead;
        }

        const oldBranchId = currentLead.branchId;
        const newBranchId = (updatedData as any).branchId ?? oldBranchId ?? null;

        const lead = await databases.updateDocument(
            DATABASE_ID,
            LEADS_COLLECTION_ID,
            leadId,
            {
                data: JSON.stringify(updatedData),
                status: (updatedData.status as string) || currentLead.status,
                branchId: newBranchId,
            }
        );

        if (newBranchId !== oldBranchId) {
            try {
                // If a handoff row exists for this lead, update its branchId too
                const handoffDoc = await databases.getDocument(
                    DATABASE_ID,
                    COLLECTIONS.LG_HANDOFFS,
                    leadId
                );
                if (handoffDoc) {
                    await databases.updateDocument(
                        DATABASE_ID,
                        COLLECTIONS.LG_HANDOFFS,
                        leadId,
                        {
                            branchId: newBranchId,
                        }
                    );
                }
            } catch (err) {
                // Ignore if no handoff row exists
            }
        }

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

export async function reopenLeadAction(leadId: string, actorId?: string, actorName?: string): Promise<Lead> {
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
                status: 'Reopened',
            },
            newPermissions
        );

        // Flip any prior active not_interested_leads row for this lead
        // to `reopened`. Best-effort — telemetry must never block the
        // user-facing state change.
        await markPriorNotInterestedRowsReopened(
            leadId,
            actorId,
            databases,
            new Date().toISOString(),
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

export function getLeadAuditName(data: LeadData): string {
    const firstName = typeof data.firstName === 'string' ? data.firstName : '';
    const lastName = typeof data.lastName === 'string' ? data.lastName : '';
    const fullName = [firstName, lastName].filter(Boolean).join(' ').trim();
    const fallback = data.legalName || data.name || data.company || data.email || data.phone;
    return fullName || (typeof fallback === 'string' ? fallback : '');
}

export function buildAuditChanges(previousData: LeadData, nextData: LeadData, changedData: Partial<LeadData>) {
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

export function getDuplicateValue(data: LeadData, field: 'email' | 'phone' | 'linkedinProfileUrl') {
    if (field === 'linkedinProfileUrl') {
    const value = (data.linkedinProfileUrl ?? data.linkedinProfile) as unknown;
    return typeof value === 'string' ? value : undefined;
    }

    const value = data[field] as unknown;
    return typeof value === 'string' ? value : undefined;
}
