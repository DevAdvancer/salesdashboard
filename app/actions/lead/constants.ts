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
import { validateLeadUniqueness, validateLeadUniquenessAction, enrichDuplicateResult } from "./validation";
import { isNotInterestedStatus, normalizeStatusText, isLinkedinRequestLeadData } from "./status";
import { getHierarchyPermissions, HierarchyUserDocument, getVisibleHierarchyUserIds, getLeadVisibilityUserIds, TeamLeadScopedUserDocument, getTeamLeadLeadVisibilityScope, appendHierarchyLeadVisibilityQuery, appendTeamLeadLeadVisibilityQuery, UserDocument, normalizeDepartment, getDepartmentScopedUserIds, leadMatchesDepartmentScope, isMonitorRole, isOperationsRole, isAdminLikeReadAllRole, assertSalesCrmAccess, assertLeadReopenAllowed, assertLeadUpdateAllowed } from "./visibility";
import { restoreNotInterestedDuplicateLead, createLeadAction, updateLeadAction, reopenLeadAction } from "./mutations";
import { getLeadAction, listLeadsAction, listLeadCountsAction, loadLeadTargetProgressAction, LeadCounts, getUserByIdOrNull, getAgentsByTeamLead} from "./queries";
import { normalizeSource, isReferralSource } from "@/lib/utils/lead-source";
import { REQUIRED_LEAD_FIELD_LABELS, isValidId, normalizeDuplicateFieldValue, isBlankLeadValue, shouldIgnoreLinkedinDuplicate, assertRequiredLeadData } from "./sync-helpers";
import { parseLeadDataSafely, getLeadAuditName, buildAuditChanges, getDuplicateValue } from "./sync-helpers";
import { parseIsoDateLocal, daysInMonthLocal } from "./sync-helpers";

export const DATABASE_ID = process.env.NEXT_PUBLIC_APPWRITE_DATABASE_ID!;
export const LEADS_COLLECTION_ID = process.env.NEXT_PUBLIC_APPWRITE_LEADS_COLLECTION_ID!;
export const USERS_COLLECTION_ID = process.env.NEXT_PUBLIC_APPWRITE_USERS_COLLECTION_ID!;
/**
 * Fields actually rendered in the leads list table. Projects the per-page
 * payload to ~30% of the original size (the `data` JSON blob still ships
 * because the table reads firstName/lastName/email/etc. from it; we can't
 * project inside the JSON). Detail views (getLeadByIdAction) are unaffected
 * and return the full document.
 */
export const LEADS_LIST_SELECT = [
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
