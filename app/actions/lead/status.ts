import { createAdminClient } from "@/lib/server/appwrite";
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
import { validateLeadUniqueness, validateLeadUniquenessAction, enrichDuplicateResult } from "./validation";
import { getHierarchyPermissions, HierarchyUserDocument, getVisibleHierarchyUserIds, getLeadVisibilityUserIds, TeamLeadScopedUserDocument, getTeamLeadLeadVisibilityScope, appendHierarchyLeadVisibilityQuery, appendTeamLeadLeadVisibilityQuery, UserDocument, normalizeDepartment, getDepartmentScopedUserIds, leadMatchesDepartmentScope, isMonitorRole, isOperationsRole, isAdminLikeReadAllRole, assertSalesCrmAccess, assertLeadReopenAllowed, assertLeadUpdateAllowed } from "./visibility";
import { restoreNotInterestedDuplicateLead, createLeadAction, updateLeadAction, reopenLeadAction } from "./mutations";
import { getLeadAction, listLeadsAction, listLeadCountsAction, loadLeadTargetProgressAction, LeadCounts, getUserByIdOrNull, getAgentsByTeamLead} from "./queries";
import { normalizeSource, isReferralSource } from "@/lib/utils/lead-source";
import { REQUIRED_LEAD_FIELD_LABELS, isValidId, normalizeDuplicateFieldValue, isBlankLeadValue, shouldIgnoreLinkedinDuplicate, assertRequiredLeadData } from "./sync-helpers";
import { parseLeadDataSafely, getLeadAuditName, buildAuditChanges, getDuplicateValue } from "./sync-helpers";
import { parseIsoDateLocal, daysInMonthLocal } from "./sync-helpers";

export function isNotInterestedStatus(status: unknown): boolean {
    return typeof status === 'string' && normalizeLeadStatus(status) === 'notinterested';
}

export function normalizeStatusText(value: unknown) {
    const text = typeof value === 'string' ? value.trim().toLowerCase() : '';
    return text.replace(/[^a-z0-9]/g, '');
}

export function isLinkedinRequestLeadData(data: LeadData) {
    const dataRecord = data as Record<string, unknown>;
    const requestId = dataRecord.linkedinRequestId;
    if (typeof requestId === 'string' && requestId.trim().length > 0) return true;
    const source = typeof dataRecord.source === 'string' ? dataRecord.source.trim() : '';
    const sourceName = typeof dataRecord.sourceName === 'string' ? dataRecord.sourceName.trim() : '';
    const normalizedSource = normalizeStatusText(source || sourceName);
    return normalizedSource === 'linkedinlead' || normalizedSource === 'linkedin';
}
