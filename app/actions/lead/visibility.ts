import { createAdminClient } from "@/lib/server/appwrite";
import { getAppwriteErrorMessage } from "@/lib/server/appwrite-errors";
import { LeadActionError } from "@/lib/server/lead-errors";
import { Lead, LeadData, LeadListFilters, UserRole, CreateLeadInput, Department } from "@/lib/types";
import { Databases, Query, Models, Client, Users, Permission, Role } from 'node-appwrite';
import { logger } from '@/lib/utils/logger';
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
import { isNotInterestedStatus, normalizeStatusText, isLinkedinRequestLeadData } from "./status";
import { restoreNotInterestedDuplicateLead, createLeadAction, updateLeadAction, reopenLeadAction } from "./mutations";
import { getLeadAction, listLeadsAction, listLeadCountsAction, loadLeadTargetProgressAction, LeadCounts, getUserByIdOrNull, getAgentsByTeamLead} from "./queries";
import { normalizeSource, isReferralSource } from "@/lib/utils/lead-source";

export async function getHierarchyPermissions(userId: string): Promise<string[]> {
    const permissions: string[] = [];
    try {
        const { databases } = await createAdminClient();
        if (!isValidId(userId)) return permissions;

        const visited = new Set<string>([userId]);
        let currentId: string | null = userId;

        // First level: walk sequentially until we hit the top, but
        // collect supervisor IDs as we go. Each level only needs one read.
        for (let depth = 0; depth < 5 && currentId && isValidId(currentId); depth++) {
            let user: Record<string, unknown>;
            try {
                user = await databases.getDocument(DATABASE_ID, USERS_COLLECTION_ID, currentId);
            } catch {
                break;
            }

            const supervisors = new Set<string>();
            if (user.teamLeadId && isValidId(user.teamLeadId as string)) supervisors.add(user.teamLeadId as string);

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
            if (user.teamLeadId && isValidId(user.teamLeadId as string) && !visited.has(user.teamLeadId as string)) {
                currentId = user.teamLeadId as string;
            } else {
                currentId = null;
            }
        }
    } catch (e) {
        logger.error('Error fetching hierarchy permissions:', e);
    }

    return permissions;
}

import {
  HierarchyUserDocument,
  getVisibleHierarchyUserIds,
  appendHierarchyLeadVisibilityQuery,
  appendTeamLeadLeadVisibilityQuery,
  normalizeDepartment,
  leadMatchesDepartmentScope,
  isMonitorRole,
  isOperationsRole,
  isAdminLikeReadAllRole,
} from '@/lib/services/lead/visibility';
import { REQUIRED_LEAD_FIELD_LABELS, isValidId, normalizeDuplicateFieldValue, isBlankLeadValue, shouldIgnoreLinkedinDuplicate, assertRequiredLeadData } from "./sync-helpers";
import { parseLeadDataSafely, getLeadAuditName, buildAuditChanges, getDuplicateValue } from "./sync-helpers";
import { parseIsoDateLocal, daysInMonthLocal } from "./sync-helpers";

export {
  type HierarchyUserDocument,
  getVisibleHierarchyUserIds,
  appendHierarchyLeadVisibilityQuery,
  appendTeamLeadLeadVisibilityQuery,
  normalizeDepartment,
  leadMatchesDepartmentScope,
  isMonitorRole,
  isOperationsRole,
  isAdminLikeReadAllRole,
};

export async function getLeadVisibilityUserIds(databases: Databases, viewerId: string, viewerRole: UserRole): Promise<string[]> {
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

export type TeamLeadScopedUserDocument = {
      $id: string;
      role?: UserRole;
    };

/**
 * (Date helpers `expandIsoDateToStart` / `expandIsoDateToEnd` were
 * promoted to `lib/utils/iso-date-range` so they could be shared with
 * the client-side lead service. The dashboard's YYYY-MM-DD inputs are
 * now expanded against the local timezone before being passed to
 * Appwrite's `$createdAt` filter.)
 */
export async function getTeamLeadLeadVisibilityScope(databases: Databases, viewerId: string): Promise<{
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

export type UserDocument = {
      $id: string;
      name?: string;
      email?: string;
      role: UserRole;
      branchIds?: string[];
      branchId?: string | null;
      // Optional on the wire — the lead_generation→team_lead counter below
      // scopes by department, so we read it off the actor + assignee when
      // it is present and fall back to "sales"
      department?: string;
    };

export async function getDepartmentScopedUserIds(_databases: Awaited<ReturnType<typeof createAdminClient>>['databases'], department: Department): Promise<Set<string>> {
    void _databases;
    const { getDepartmentScopedUserIds: getCached } = await import(
            '@/lib/server/department-user-cache'
          );
    return getCached(department);
}

export function assertSalesCrmAccess(userDoc: UserDocument) {
    if (userDoc.department === 'resume' && !isAdminLikeReadAllRole(userDoc.role)) {
    throw new LeadActionError('PERMISSION_DENIED', 'Resume users cannot access the Sales CRM.');
    }
}

export async function assertLeadReopenAllowed(databases: Awaited<ReturnType<typeof createAdminClient>>['databases'], actorDoc: UserDocument, lead: Lead) {
    if (isOperationsRole(actorDoc.role)) {
    throw new LeadActionError('PERMISSION_DENIED', 'Permission denied');
    }

    if (
    actorDoc.role === 'admin' ||
    actorDoc.role === 'developer' ||
    actorDoc.role === 'monitor'
    ) {
    return;
    }

    if (actorDoc.role !== 'team_lead') {
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

export async function assertLeadUpdateAllowed(databases: Awaited<ReturnType<typeof createAdminClient>>['databases'], actorDoc: UserDocument, lead: Lead) {
    if (isOperationsRole(actorDoc.role)) {
    throw new LeadActionError('PERMISSION_DENIED', 'Permission denied');
    }

    if (actorDoc.role === 'admin' || actorDoc.role === 'developer') {
    return;
    }

    if (actorDoc.role === 'monitor') {
    if (lead.ownerId === actorDoc.$id || lead.assignedToId === actorDoc.$id) {
      return;
    }
    throw new LeadActionError('PERMISSION_DENIED', 'Permission denied');
    }

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
