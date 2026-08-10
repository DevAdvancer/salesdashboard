'use server';
import { unstable_cache } from "next/cache";
import type { Databases } from 'node-appwrite';
import { isReferralSource } from '@/lib/utils/lead-source';
import { createAdminClient } from "@/lib/server/appwrite";
import { getAppwriteErrorMessage } from "@/lib/server/appwrite-errors";
import { parseIsoDateLocal, daysInMonthLocal } from "./sync-helpers";
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
import { getCurrentEasternIsoDate } from "@/lib/utils/eastern-date";
import { workingDaysInRange, type KpiRow } from "@/lib/utils/dashboard-kpi";
import { listHolidayDateKeys } from "@/lib/server/holiday-calendar";
import { buildDepartmentScopeQuery, isDepartmentScopeInlineEnabled } from "@/lib/server/department-scope-query";
import { DATABASE_ID, LEADS_COLLECTION_ID, USERS_COLLECTION_ID, LEADS_LIST_SELECT } from "./constants";
import { validateLeadUniqueness, validateLeadUniquenessAction, enrichDuplicateResult } from "./validation";
import { isNotInterestedStatus, normalizeStatusText, isLinkedinRequestLeadData } from "./status";
import { getHierarchyPermissions, HierarchyUserDocument, getVisibleHierarchyUserIds, getLeadVisibilityUserIds, TeamLeadScopedUserDocument, getTeamLeadLeadVisibilityScope, appendHierarchyLeadVisibilityQuery, appendTeamLeadLeadVisibilityQuery, UserDocument, normalizeDepartment, getDepartmentScopedUserIds, leadMatchesDepartmentScope, isMonitorRole, isOperationsRole, isAdminLikeReadAllRole, assertSalesCrmAccess, assertLeadReopenAllowed, assertLeadUpdateAllowed } from "./visibility";
import { restoreNotInterestedDuplicateLead, createLeadAction, updateLeadAction, reopenLeadAction } from "./mutations";
import { logger } from '@/lib/utils/logger';
import { REQUIRED_LEAD_FIELD_LABELS, isValidId, normalizeDuplicateFieldValue, isBlankLeadValue, shouldIgnoreLinkedinDuplicate, assertRequiredLeadData } from "./sync-helpers";
import { parseLeadDataSafely, getLeadAuditName, buildAuditChanges, getDuplicateValue } from "./sync-helpers";

export async function getLeadAction(leadId: string, viewerId: string): Promise<Lead> {
    await assertAuthenticatedUserId(viewerId);
    const { databases } = await createAdminClient();
    try {
    const viewerDoc = await databases.getDocument(
      DATABASE_ID,
      COLLECTIONS.USERS,
      viewerId
    ) as unknown as UserDocument;
    assertSalesCrmAccess(viewerDoc);

    const lead = await databases.getDocument(
      DATABASE_ID,
      LEADS_COLLECTION_ID,
      leadId
    ) as unknown as Lead;

    if (isAdminLikeReadAllRole(viewerDoc.role)) {
      // Admin-like roles (admin/developer/monitor/operations) see all leads
      // across all branches via the paginated listLeadsAction path. Mirror
      // that here so a lead visible on /leads is also viewable in /leads/[id];
      // previously the dept-scope post-filter rejected some rows that the
      // list had returned, breaking the detail page.
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
    } catch (error: unknown) {
    if (error instanceof LeadActionError) throw error;
    logger.error('Error fetching lead (action):', error);
    throw new LeadActionError(
      'UNKNOWN',
      (error as any)?.message || 'Failed to fetch lead',
      { cause: error },
    );
    }
}

export async function listLeadsAction(filters: LeadListFilters, userId: string, _userRole: UserRole, branchIds?: string[], options?: {
    /** Page number (1-indexed). Defaults to 1. */
    page?: number;
    /** Items per page. Defaults to 20. Maximum 100. */
    pageSize?: number;
    /** If true, ignore pagination and fetch as many as possible (for export). */
    forExport?: boolean;
    /** If true, skip admin-only department post-filtering on historical exports. */
    skipDepartmentScope?: boolean;
    }): Promise<{ leads: Lead[]; total: number; page: number; pageSize: number }> {
    try {
    await assertAuthenticatedUserId(userId);
    const { databases } = await createAdminClient();
    const queries: string[] = [];

    // Role-based filtering
    const userDoc = await databases.getDocument(DATABASE_ID, COLLECTIONS.USERS, userId) as unknown as UserDocument;
    assertSalesCrmAccess(userDoc);
    const userRole = userDoc.role;
    const skipDepartmentScope = options?.skipDepartmentScope === true;
    let salesUserIds =
      isAdminLikeReadAllRole(userRole) && !skipDepartmentScope
        ? await getDepartmentScopedUserIds(databases, 'sales')
        : null;


    if (userRole === 'agent') {
      // Agents see leads assigned to them OR leads they created
      const orConditions = [
          Query.equal('assignedToId', userId),
          Query.equal('ownerId', userId),
      ];
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

        const teamIds = [filters.teamLeadId, ...agents.map((agent) => agent.$id)]
          .filter((candidateId) => salesUserIds?.has(candidateId) ?? true);
        if (teamIds.length === 0) {
          return { leads: [], total: 0, page: 1, pageSize: 0 };
        }
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
        branchIds,
        true,
      );
    }

    // Express the department scope as a query instead of walking the whole
    // collection and filtering with leadMatchesDepartmentScope below. Nulling
    // salesUserIds is what makes the walk branch fall through to the single
    // paginated listDocuments call. This runs after the role branch on
    // purpose: the teamLeadId branch narrows its teamIds with salesUserIds,
    // and doing that narrowing is not equivalent to ORing the scope on top.
    // Export keeps the walk (see wantExport below): its callers need the full
    // set, so there is nothing to save and nothing to risk changing there.
    if (salesUserIds && options?.forExport !== true && isDepartmentScopeInlineEnabled()) {
      const departmentScopeQuery = buildDepartmentScopeQuery(salesUserIds);
      if (departmentScopeQuery) {
        queries.push(departmentScopeQuery);
        salesUserIds = null;
      }
    }

    if (filters.ids && filters.ids.length > 0) {
      queries.push(Query.equal('$id', filters.ids));
    }

    // Filter by closed status (default to active leads)
    if (filters.isClosed !== undefined) {
      queries.push(Query.equal('isClosed', filters.isClosed));
    } else {
      queries.push(Query.equal('isClosed', false));
    }

    const normalizedRequestedStatus =
      typeof filters.status === 'string'
        ? filters.status.trim().toLowerCase().replace(/[^a-z0-9]/g, '')
        : '';
    const shouldExcludeNotInterestedFromActiveList =
      (filters.isClosed === undefined || filters.isClosed === false) &&
      normalizedRequestedStatus !== 'notinterested';

    if (shouldExcludeNotInterestedFromActiveList) {
      queries.push(Query.notEqual('status', 'Not Interested'));
      queries.push(Query.notEqual('status', 'Not-Interested'));
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

    // Apply owner filter
    if (filters.ownerId) {
      queries.push(Query.equal('ownerId', filters.ownerId));
    }

    // Apply "my leads" filter — leads owned by OR assigned to the requesting user
    if (filters.mine) {
      queries.push(Query.or([
        Query.equal('ownerId', userId),
        Query.equal('assignedToId', userId),
      ]));
    }

    // Apply assigned agent filter
    if (filters.assignedToId) {
      queries.push(Query.equal('assignedToId', filters.assignedToId));
    }

    // Apply branch filter
    if (filters.branchId) {
      queries.push(Query.equal('branchId', filters.branchId));
    }

    // Apply date range filters. The dashboard sends `dateFrom` / `dateTo`
    // as YYYY-MM-DD strings; expand them to the inclusive day boundaries
    // so leads created later in the same day aren't dropped by a string
    // comparison (e.g. `'2026-06-22T12:34Z' <= '2026-06-22'` is false).
    if (filters.dateFrom) {
      const from = expandIsoDateToStart(filters.dateFrom);
      queries.push(Query.greaterThanEqual('$createdAt', from));
    }
    if (filters.dateTo) {
      const to = expandIsoDateToEnd(filters.dateTo);
      queries.push(Query.lessThanEqual('$createdAt', to));
    }
    if (filters.closedAtFrom) {
      const from = expandIsoDateToStart(filters.closedAtFrom);
      queries.push(Query.greaterThanEqual('closedAt', from));
    }
    if (filters.closedAtTo) {
      const to = expandIsoDateToEnd(filters.closedAtTo);
      queries.push(Query.lessThanEqual('closedAt', to));
    }

    // Order by creation date (newest first)
    queries.push(Query.orderDesc('$createdAt'));
    queries.push(Query.orderDesc('$id')); // Tie-breaker for cursor pagination

    // Pagination: clamp pageSize to a max of 100 to prevent abuse.
    // forExport=true bypasses pagination and pulls up to 10K rows (used by
    // the CSV export handler). export callers don't need total/pagination.
    const wantExport = options?.forExport === true;
    const page = wantExport ? 1 : Math.max(1, options?.page ?? 1);
    const pageSize = wantExport ? 10000 : Math.min(100, Math.max(1, options?.pageSize ?? 20));

    // We can now use Appwrite native fulltext search since we added the `data_search_idx` index.
    if (filters.searchQuery) {
      let queryStr = filters.searchQuery.trim();
      let visaStatusMatch: string | null = null;
      if (queryStr.toLowerCase().startsWith('visastatus:')) {
        visaStatusMatch = queryStr.slice('visastatus:'.length).trim();
        // Visa status search is specific and might not use fulltext efficiently 
        // since it's just one word. But we can still search the whole JSON string
        queryStr = visaStatusMatch;
      }
      if (queryStr) {
        queries.push(Query.search('data', queryStr));
      }
    }

    const projectedQueries = [...queries];
    projectedQueries.push(Query.select(LEADS_LIST_SELECT));

    if (wantExport || Boolean(salesUserIds)) {
      if (wantExport) {
        const allLeads = await listAllDocuments<Lead>({
          databases,
          databaseId: DATABASE_ID,
          collectionId: LEADS_COLLECTION_ID,
          queries: projectedQueries,
          pageLimit: 100,
          maxPages: 500,
        });

        let leads = allLeads;
        if (salesUserIds) {
          leads = leads.filter((lead) => leadMatchesDepartmentScope(lead, salesUserIds!));
        }
        return { leads, total: leads.length, page: 1, pageSize: leads.length };
      } else {
        // We are paginating with a memory filter (salesUserIds). 
        // DO NOT fetch all leads. Fetch in batches until we fulfill the requested page.
        const targetCount = pageSize;
        const startOffset = (page - 1) * pageSize;
        let accumulatedLeads: Lead[] = [];
        let cursor: string | undefined = undefined;
        let hasMore = true;
        let batchCount = 0;
        
        while (hasMore && accumulatedLeads.length < startOffset + targetCount && batchCount < 20) {
          const batchQueries = [...projectedQueries, Query.limit(100)];
          if (cursor) {
            batchQueries.push(Query.cursorAfter(cursor));
          }
          
          const batchRes = await databases.listDocuments(
            DATABASE_ID,
            LEADS_COLLECTION_ID,
            batchQueries
          );
          
          const batchDocs = batchRes.documents as unknown as Lead[];
          if (batchDocs.length === 0) {
            hasMore = false;
            break;
          }
          
          cursor = batchDocs[batchDocs.length - 1].$id;
          
          const filteredBatch = batchDocs.filter((lead) => 
            leadMatchesDepartmentScope(lead, salesUserIds!)
          );
          
          accumulatedLeads.push(...filteredBatch);
          batchCount++;
          
          if (!filters.searchQuery && accumulatedLeads.length >= targetCount) {
             // If not searching, just grab the first page and stop immediately.
             break;
          }
        }
        
        const finalLeads = accumulatedLeads.slice(startOffset, startOffset + targetCount);
        const hasSearch = Boolean(filters?.searchQuery?.trim());
        const effectiveTotal = hasSearch ? accumulatedLeads.length : finalLeads.length;

        return {
          leads: finalLeads,
          total: effectiveTotal,
          page,
          pageSize,
        };
      }
    }

    if (!wantExport) {
      queries.push(Query.limit(pageSize));
      queries.push(Query.offset((page - 1) * pageSize));
    }

    // Apply Query.select projection to trim the per-page payload
    queries.push(Query.select(LEADS_LIST_SELECT));

    const response = await databases.listDocuments(
      DATABASE_ID,
      LEADS_COLLECTION_ID,
      queries
    );

    // If searching, allow pagination by returning the actual total.
    // If not searching, restrict to just the fetched page (e.g. 10 leads) to eliminate full table scans.
    const hasSearch = Boolean(filters?.searchQuery?.trim());
    const effectiveTotal = (wantExport || hasSearch) 
      ? (response.total ?? response.documents.length) 
      : response.documents.length;

    return {
      leads: response.documents as unknown as Lead[],
      total: effectiveTotal,
      page,
      pageSize,
    };
    } catch (error: unknown) {
    logger.error('Error listing leads (action):', error);
    throw new Error(getAppwriteErrorMessage(error) || 'Failed to list leads');
    }
}

export async function listLeadCountsAction(userId: string, _userRole: UserRole, branchIds?: string[], filters?: LeadListFilters): Promise<LeadCounts> {
    try {
    await assertAuthenticatedUserId(userId);
    const { databases } = await createAdminClient();

    // Fetch the caller doc once so we can build the visibility queries.
    const userDoc = await databases.getDocument(
      DATABASE_ID,
      USERS_COLLECTION_ID,
      userId
    ) as unknown as UserDocument;
    assertSalesCrmAccess(userDoc);
    const userRole = userDoc.role;
    let salesUserIds =
      isAdminLikeReadAllRole(userRole)
        ? await getDepartmentScopedUserIds(databases, 'sales')
        : null;

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
        const teamIds = [filters.teamLeadId, ...agents.map((a) => a.$id)]
          .filter((candidateId) => salesUserIds?.has(candidateId) ?? true);
        if (teamIds.length === 0) {
          return {
            active: 0,
            closed: 0,
            unassigned: 0,
            byStatus: {
              New: 0,
              Contacted: 0,
              Interested: 0,
              'Not Interested': 0,
              Backout: 0,
              Closed: 0,
            },
          };
        }
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
        branchIds,
        true,
      );
    }

    // Same swap as listLeadsAction: with the scope expressed as a query the
    // buckets below can be counted by Appwrite's `total`, instead of walking
    // every page of the collection and counting in memory. Placed after the
    // role branch because the teamLeadId branch narrows teamIds with
    // salesUserIds, which is not the same predicate as ORing the scope on top.
    if (salesUserIds && isDepartmentScopeInlineEnabled()) {
      const departmentScopeQuery = buildDepartmentScopeQuery(salesUserIds);
      if (departmentScopeQuery) {
        visibilityQueries.push(departmentScopeQuery);
        salesUserIds = null;
      }
    }

    // Optional filter scope (branch / date / status). These are applied
    // on top of the visibility scope.
    if (filters?.branchId) {
      visibilityQueries.push(Query.equal('branchId', filters.branchId));
    }
    if (filters?.dateFrom) {
      visibilityQueries.push(Query.greaterThanEqual('$createdAt', expandIsoDateToStart(filters.dateFrom)));
    }
    if (filters?.dateTo) {
      visibilityQueries.push(Query.lessThanEqual('$createdAt', expandIsoDateToEnd(filters.dateTo)));
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

    if (salesUserIds) {
      const leads = await listAllDocuments<Lead>({
        databases,
        databaseId: DATABASE_ID,
        collectionId: LEADS_COLLECTION_ID,
        queries: [...visibilityQueries, Query.select(['$id', 'ownerId', 'assignedToId', 'isClosed', 'status'])],
        pageLimit: 100,
        maxPages: 500,
      });
      const scopedLeads = leads.filter((lead) => leadMatchesDepartmentScope(lead, salesUserIds));
      const byStatus: Record<string, number> = {};
      STATUS_BUCKETS.forEach((status) => {
        byStatus[status] = scopedLeads.filter((lead) => lead.status === status).length;
      });

      return {
        active: scopedLeads.filter((lead) => lead.isClosed !== true).length,
        closed: scopedLeads.filter((lead) => lead.isClosed === true).length,
        unassigned: scopedLeads.filter(
          (lead) => lead.isClosed !== true && (!lead.assignedToId || !lead.ownerId),
        ).length,
        byStatus,
      };
    }

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
    } catch (error: unknown) {
    logger.error('Error listing lead counts (action):', error);
    throw new Error(
      getAppwriteErrorMessage(error) || 'Failed to list lead counts'
    );
    }
}

export async function loadLeadTargetProgressAction(input: {
      userId: string;
      role: string;
      teamLeadId?: string;
      branchIds?: string[];
      dateRange: { from?: string; to?: string };
    }): Promise<KpiRow[]> {
    await assertAuthenticatedUserId(input.userId);
    const { databases } = await createAdminClient();
    const isKpiEligible = (user: Record<string, unknown>): boolean =>
            Boolean(
              user &&
              user.isActive !== false &&
              user.department === "sales" &&
              (user.role === "agent" || user.role === "team_lead")
            );
    let scopeUsers: Record<string, unknown>[] = [];
    if (input.role === "agent" || input.role === "lead_generation") {
    const self = await getUserByIdOrNull(databases, input.userId);
    scopeUsers = self && isKpiEligible(self as Record<string, unknown>) ? [self as Record<string, unknown>] : [];
    } else if (input.role === "team_lead") {
    const self = await getUserByIdOrNull(databases, input.userId);
    const agents = await getAgentsByTeamLead(databases, input.userId);
    scopeUsers = [self, ...agents].filter((u): u is Record<string, unknown> => u !== null).filter(isKpiEligible) as Record<string, unknown>[];
    } else {
    // admin / developer / monitor / operations
    if (input.teamLeadId) {
      const selected = await getUserByIdOrNull(databases, input.teamLeadId);
      const agents = await getAgentsByTeamLead(databases, input.teamLeadId);
      scopeUsers = [selected, ...agents].filter((u): u is Record<string, unknown> => u !== null).filter(isKpiEligible) as Record<string, unknown>[];
    } else {
      const allUsers = await listAllDocuments<Record<string, unknown>>({
        databases,
        databaseId: DATABASE_ID,
        collectionId: COLLECTIONS.USERS,
        queries: [Query.orderAsc('$id')],
        pageLimit: 100,
        maxPages: 500,
      });
      scopeUsers = allUsers.filter((user) => {
        if (!isKpiEligible(user)) return false;
        if (input.branchIds && input.branchIds.length > 0) {
          const userBranchIds = Array.isArray(user.branchIds) ? user.branchIds : [];
          const hasOverlap = userBranchIds.some((b: string) => input.branchIds!.includes(b));
          if (!hasOverlap) return false;
        }
        // Exclude agents without a team lead (unassigned agents)
        if (user.role === "agent" && !user.teamLeadId) return false;
        return user.$id !== input.userId;
      });
    }
    }

    const fromIso = input.dateRange.from;
    const toIso = input.dateRange.to ?? input.dateRange.from;
    const holidayDateKeys = fromIso && toIso
              ? await listHolidayDateKeys({ databases, from: fromIso, to: toIso })
              : [];
    const singleDay = Boolean(fromIso && toIso && fromIso === toIso);
    let target: number;
    let mode: "daily" | "monthly";
    if (singleDay) {
      target = workingDaysInRange(fromIso!, toIso!, holidayDateKeys);
      mode = "daily";
    } else if (fromIso && toIso) {
      target = workingDaysInRange(fromIso, toIso, holidayDateKeys);
      mode = "monthly";
    } else {
      const effectiveDate = toIso ?? new Date().toISOString().slice(0, 10);
      target = daysInMonthLocal(effectiveDate);
      mode = "monthly";
    }

    // Delta Fetching Logic
    const dateKeys: string[] = [];
    const todayStr = getCurrentEasternIsoDate().slice(0, 10);
    const startStr = (fromIso ?? todayStr.slice(0, 7) + "-01").slice(0, 10);
    const endStr = (toIso ?? todayStr).slice(0, 10);
    
    let currentStr = startStr;
    const pastDateKeys: string[] = [];
    let includesTodayOrFuture = false;
    
    while (currentStr <= endStr) {
      if (currentStr >= todayStr) {
        includesTodayOrFuture = true;
      } else {
        pastDateKeys.push(currentStr);
      }
      const d = new Date(currentStr + "T12:00:00Z");
      d.setUTCDate(d.getUTCDate() + 1);
      currentStr = d.toISOString().slice(0, 10);
    }

    // 1. Fetch cache (AGENT_DAILY_STATS) for past days
    let pastStats: any[] = [];
    if (pastDateKeys.length > 0) {
      const chunks = [];
      for (let i = 0; i < pastDateKeys.length; i += 100) {
        chunks.push(pastDateKeys.slice(i, i + 100));
      }
      const results = await Promise.all(chunks.map(chunk => 
        listAllDocuments<any>({
          databases,
          databaseId: DATABASE_ID,
          collectionId: COLLECTIONS.AGENT_DAILY_STATS,
          queries: [Query.equal("dateKey", chunk)],
          pageLimit: 100,
          maxPages: 100,
        })
      ));
      pastStats = results.flat();
    }

    // 2. Fetch delta for today/future
    let todayCreatedLeads: any[] = [];
    let todayNiEvents: any[] = [];
    
    if (includesTodayOrFuture || endStr >= todayStr) {
      // We only need to fetch leads from today onwards up to endStr
      const fetchStart = startStr >= todayStr ? startStr : todayStr;
      const startIsoBound = expandIsoDateToStart(fetchStart);
      const endIsoBound = expandIsoDateToEnd(endStr);
      
      todayCreatedLeads = await listAllDocuments<any>({
        databases,
        databaseId: DATABASE_ID,
        collectionId: LEADS_COLLECTION_ID,
        queries: [
          Query.greaterThanEqual('$createdAt', startIsoBound),
          Query.lessThanEqual('$createdAt', endIsoBound),
          Query.select(['$id', 'ownerId', 'assignedToId', 'data'])
        ],
        pageLimit: 100,
        maxPages: 200,
      });

      todayNiEvents = await listAllDocuments<any>({
        databases,
        databaseId: DATABASE_ID,
        collectionId: COLLECTIONS.NOT_INTERESTED_LEADS,
        queries: [
          Query.greaterThanEqual("markedAt", startIsoBound),
          Query.lessThanEqual("markedAt", endIsoBound),
          Query.select(['$id', 'previousAssignedToId', 'previousOwnerId', 'status'])
        ],
        pageLimit: 100,
        maxPages: 200,
      }).catch(() => []);
    }

    const kpiRows = scopeUsers.map((user) => {
      // Sum from cache
      let cachedLeadCount = 0;
      let cachedAssignedLeadCount = 0;
      let cachedNiCount = 0;
      
      pastStats.forEach(s => {
        if (s.agentId === user.$id) {
          cachedLeadCount += (s.leadsGenerated || 0);
          cachedAssignedLeadCount += (s.assignedLeadCount || 0);
          cachedNiCount += (s.notInterestedMarked || 0);
        }
      });

      // Sum from delta
      const deltaCreatedCount = todayCreatedLeads.filter((lead) => {
        let creatorId = lead.ownerId;
        try {
          const leadData = JSON.parse(lead.data as string);
          if (leadData && leadData.creatorId) creatorId = leadData.creatorId;
        } catch {}
        if (creatorId !== user.$id) return false;
        try {
          const leadData = JSON.parse(lead.data as string);
          if (leadData && isReferralSource(leadData.source)) return false;
        } catch {}
        return true;
      }).length;

      const deltaAssignedCount = todayCreatedLeads.filter((lead) => lead.assignedToId === user.$id).length;

      const deltaNiCount = todayNiEvents.filter((event) => {
        const attributed = event.previousAssignedToId || event.previousOwnerId;
        return attributed === user.$id && (!event.status || event.status === "active");
      }).length;

      return {
        userId: user.$id,
        userName: user.name,
        userRole: user.role,
        leadCount: cachedLeadCount + deltaCreatedCount,
        assignedLeadCount: cachedAssignedLeadCount + deltaAssignedCount,
        notInterestedCount: cachedNiCount + deltaNiCount,
        target,
        mode,
      };
    });
    kpiRows.sort((a, b) => {
    const aMet = a.leadCount >= a.target;
    const bMet = b.leadCount >= b.target;
    if (aMet !== bMet) return aMet ? 1 : -1;
    const aGap = a.target - a.leadCount;
    const bGap = b.target - b.leadCount;
    if (aGap !== bGap) return bGap - aGap;
    return (a.userName as string).localeCompare(b.userName as string);
    });
    return kpiRows as KpiRow[];
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

export async function getUserByIdOrNull(databases: Databases, userId: string): Promise<Record<string, unknown> | null> {
    try {
    return await databases.getDocument(DATABASE_ID, COLLECTIONS.USERS, userId);
    } catch {
    return null;
    }
}

export async function getAgentsByTeamLead(databases: Databases, teamLeadId: string): Promise<Record<string, unknown>[]> {
    try {
    return await listAllDocuments<Record<string, unknown>>({
      databases,
      databaseId: DATABASE_ID,
      collectionId: COLLECTIONS.USERS,
      queries: [
        Query.equal('teamLeadId', teamLeadId),
        Query.orderAsc('$id'),
      ],
      pageLimit: 100,
      maxPages: 100,
    });
    } catch {
    return [];
    }
}

