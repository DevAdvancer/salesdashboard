"use server";
import type { Databases } from 'node-appwrite';
import { createAdminClient } from "@/lib/server/appwrite";
import { isValidId, normalizeDuplicateFieldValue, isBlankLeadValue, shouldIgnoreLinkedinDuplicate, assertRequiredLeadData } from "./sync-helpers";
import { getAppwriteErrorMessage } from "@/lib/server/appwrite-errors";
import { LeadActionError } from "@/lib/server/lead-errors";
import { Lead, LeadData, LeadListFilters, UserRole, CreateLeadInput, Department } from "@/lib/types";
import { Query, ID, Permission, Role } from "node-appwrite";
import { COLLECTIONS } from "@/lib/constants/appwrite";
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
import { isNotInterestedStatus, normalizeStatusText, isLinkedinRequestLeadData } from "./status";
import { getHierarchyPermissions, HierarchyUserDocument, getVisibleHierarchyUserIds, getLeadVisibilityUserIds, TeamLeadScopedUserDocument, getTeamLeadLeadVisibilityScope, appendHierarchyLeadVisibilityQuery, appendTeamLeadLeadVisibilityQuery, UserDocument, normalizeDepartment, getDepartmentScopedUserIds, leadMatchesDepartmentScope, isMonitorRole, isOperationsRole, isAdminLikeReadAllRole, assertSalesCrmAccess, assertLeadReopenAllowed, assertLeadUpdateAllowed } from "./visibility";
import { restoreNotInterestedDuplicateLead, createLeadAction, updateLeadAction, reopenLeadAction } from "./mutations";
import { getLeadAction, listLeadsAction, listLeadCountsAction, loadLeadTargetProgressAction, LeadCounts, getUserByIdOrNull, getAgentsByTeamLead} from "./queries";
import { normalizeSource, isReferralSource } from "@/lib/utils/lead-source";
import { REQUIRED_LEAD_FIELD_LABELS, parseLeadDataSafely, getLeadAuditName, buildAuditChanges, getDuplicateValue } from "./sync-helpers";
import { parseIsoDateLocal, daysInMonthLocal } from "./sync-helpers";


export async function validateLeadUniqueness(data: LeadData, excludeLeadId?: string): Promise<{
        isValid: boolean;
        duplicateField?: 'email' | 'phone' | 'linkedinProfileUrl';
        existingLeadId?: string;
        existingBranchId?: string;
        existingLeadOwnerName?: string;
        existingLeadAssignedToName?: string;
        existingLeadStatus?: string;
    }> {
    const { databases } = await createAdminClient();
    const email = data.email as string | undefined;
    const phone = data.phone as string | undefined;
    const linkedinProfileUrl = (data as any).linkedinProfileUrl as string | undefined;
    const linkedinProfile = (data as any).linkedinProfile as string | undefined;
    const linkedinValue = (linkedinProfileUrl || linkedinProfile || '').trim();
    const windowStart = new Date();
    windowStart.setFullYear(windowStart.getFullYear() - 1);
    const documents = await listAllDocuments<Record<string, unknown>>({
                databases,
                databaseId: DATABASE_ID,
                collectionId: LEADS_COLLECTION_ID,
                queries: [
                    Query.greaterThanEqual('$createdAt', windowStart.toISOString()),
                    Query.orderDesc('$createdAt'),
                    Query.orderDesc('$id'),
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
                    return enrichDuplicateResult(databases, doc, 'email');
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
                    return enrichDuplicateResult(databases, doc, 'phone');
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
                        return enrichDuplicateResult(databases, doc, 'linkedinProfileUrl');
                    }
                } catch {}
            }
        }
    }

    return { isValid: true };
}

export async function validateLeadUniquenessAction(data: LeadData, excludeLeadId?: string) {
    const user = await getAuthenticatedAccount();
    if (!user) throw new Error("Unauthorized");
    return validateLeadUniqueness(data, excludeLeadId);
}

/**
 * Helper to resolve owner/assignee names for a duplicate lead doc.
 * Returns enriched duplicate result with human-readable agent names.
 */
export async function enrichDuplicateResult(databases: Databases, doc: Record<string, unknown>, duplicateField?: 'email' | 'phone' | 'linkedinProfileUrl'): Promise<{
        isValid: boolean;
        duplicateField?: 'email' | 'phone' | 'linkedinProfileUrl';
        existingLeadId?: string;
        existingBranchId?: string;
        existingLeadOwnerName?: string;
        existingLeadAssignedToName?: string;
        existingLeadStatus?: string;
    }> {
    const branchId = typeof doc.branchId === "string" ? doc.branchId : undefined;
    const status = typeof doc.status === "string" ? doc.status : undefined;
    let ownerName: string | undefined;
    let assignedToName: string | undefined;
    try {
        if (doc.ownerId) {
            const ownerDoc = await databases.getDocument(DATABASE_ID, USERS_COLLECTION_ID, doc.ownerId as string);
            ownerName = (ownerDoc as any).name || undefined;
        }
    } catch {
        // Silently ignore if owner doc can't be fetched
    }

    try {
        if (doc.assignedToId) {
            const assignedDoc = await databases.getDocument(DATABASE_ID, USERS_COLLECTION_ID, doc.assignedToId as string);
            assignedToName = (assignedDoc as any).name || undefined;
        }
    } catch {
        // Silently ignore if assignedTo doc can't be fetched
    }

    return {
        isValid: false,
        duplicateField,
        existingLeadId: doc.$id as string,
        existingBranchId: branchId,
        existingLeadOwnerName: ownerName,
        existingLeadAssignedToName: assignedToName,
        existingLeadStatus: status,
    };
}
