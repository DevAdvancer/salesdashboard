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
import { parseLeadDataSafely, restoreNotInterestedDuplicateLead, createLeadAction, updateLeadAction, reopenLeadAction, getLeadAuditName, buildAuditChanges, getDuplicateValue } from "./mutations";

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
        specialBranchId,
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

    const projectedQueries = [...queries];
    if (!filters.searchQuery) {
      projectedQueries.push(Query.select(LEADS_LIST_SELECT));
    }

    if (wantExport || Boolean(salesUserIds)) {
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
        leads = leads.filter((lead) => leadMatchesDepartmentScope(lead, salesUserIds));
      }

      if (filters.searchQuery) {
        const queryStr = filters.searchQuery.trim();
        const searchLower = queryStr.toLowerCase();
        let visaStatusMatch: string | null = null;
        if (searchLower.startsWith('visastatus:')) {
          visaStatusMatch = queryStr.slice('visastatus:'.length).trim();
        }

        leads = leads.filter((lead) => {
          try {
            const data = JSON.parse(lead.data) as LeadData;

            if (visaStatusMatch !== null) {
              const vsQuery = visaStatusMatch.toLowerCase();
              return String(data.visaStatus || '').toLowerCase().includes(vsQuery);
            }

            return (lead.data || '').toLowerCase().includes(searchLower);
          } catch (e) {
            return false;
          }
        });
      }

      if (!wantExport) {
        const start = (page - 1) * pageSize;
        return {
          leads: leads.slice(start, start + pageSize),
          total: leads.length,
          page,
          pageSize,
        };
      }

      return { leads, total: leads.length, page: 1, pageSize: leads.length };
    }

    // When search is active, fetch ALL visible leads using listAllDocuments
    // (which handles pagination automatically) then filter in memory and paginate.
    // This ensures leads on pages beyond the first can be found by search.
    if (filters.searchQuery) {
      const allLeads = await listAllDocuments<Lead>({
        databases,
        databaseId: DATABASE_ID,
        collectionId: LEADS_COLLECTION_ID,
        queries: queries.filter(
          (q) => !String(q).startsWith('limit(') && !String(q).startsWith('offset(')
        ),
        pageLimit: 100,
        maxPages: 500,
      });

      let leads = allLeads;

      // Apply search filter in memory
      const queryStr = filters.searchQuery.trim();
      const searchLower = queryStr.toLowerCase();
      let visaStatusMatch: string | null = null;
      if (searchLower.startsWith('visastatus:')) {
        visaStatusMatch = queryStr.slice('visastatus:'.length).trim();
      }

      leads = leads.filter((lead) => {
        try {
          const data = JSON.parse(lead.data) as LeadData;

          if (visaStatusMatch !== null) {
            const vsQuery = visaStatusMatch.toLowerCase();
            return String(data.visaStatus || '').toLowerCase().includes(vsQuery);
          }

          return (lead.data || '').toLowerCase().includes(searchLower);
        } catch (e) {
          return false;
        }
      });

      // Paginate the filtered results
      const start = (page - 1) * pageSize;
      return {
        leads: leads.slice(start, start + pageSize),
        total: leads.length,
        page,
        pageSize,
      };
    }

    // Non-search path: use pagination directly from Appwrite
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

    return {
      leads: response.documents as unknown as Lead[],
      total: response.total ?? response.documents.length,
      page,
      pageSize,
    };
    } catch (error: any) {
    console.error('Error listing leads (action):', error);
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
    const specialBranchId = getSpecialBranchLeadAccess(
      userDoc.email as string | undefined
    );
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
        specialBranchId,
        branchIds,
        true
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
    } catch (error: any) {
    console.error('Error listing lead counts (action):', error);
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
    const isKpiEligible = (user: any): boolean =>
            Boolean(
              user &&
              user.isActive !== false &&
              user.department === "sales" &&
              (user.role === "agent" || user.role === "team_lead")
            );
    let scopeUsers: any[] = [];
    if (input.role === "agent" || input.role === "lead_generation") {
    const self = await getUserByIdOrNull(databases, input.userId);
    scopeUsers = isKpiEligible(self) ? [self] : [];
    } else if (input.role === "team_lead") {
    const self = await getUserByIdOrNull(databases, input.userId);
    const agents = await getAgentsByTeamLead(databases, input.userId);
    scopeUsers = [self, ...agents].filter(isKpiEligible);
    } else {
    // admin / developer / monitor / operations
    if (input.teamLeadId) {
      const selected = await getUserByIdOrNull(databases, input.teamLeadId);
      const agents = await getAgentsByTeamLead(databases, input.teamLeadId);
      scopeUsers = [selected, ...agents].filter(isKpiEligible);
    } else {
      const allUsers = await listAllDocuments<any>({
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

    const queries: string[] = [];
    if (input.dateRange.from) {
    queries.push(Query.greaterThanEqual('$createdAt', expandIsoDateToStart(input.dateRange.from)));
    }

    if (input.dateRange.to) {
    queries.push(Query.lessThanEqual('$createdAt', expandIsoDateToEnd(input.dateRange.to)));
    }

    queries.push(Query.orderDesc('$createdAt'));
    queries.push(Query.orderDesc('$id'));
    queries.push(Query.select(['$id', 'ownerId', 'assignedToId', 'data']));
    const allLeads = await listAllDocuments<any>({
            databases,
            databaseId: DATABASE_ID,
            collectionId: LEADS_COLLECTION_ID,
            queries,
            pageLimit: 100,
            maxPages: 500,
          });
    const niQueries: string[] = [];
    if (input.dateRange.from) {
    niQueries.push(Query.greaterThanEqual("markedAt", expandIsoDateToStart(input.dateRange.from)));
    }

    if (input.dateRange.to) {
    niQueries.push(Query.lessThanEqual("markedAt", expandIsoDateToEnd(input.dateRange.to)));
    }

    niQueries.push(Query.select(['$id', 'userId']));
    const niEvents = await listAllDocuments<any>({
            databases,
            databaseId: DATABASE_ID,
            collectionId: COLLECTIONS.NOT_INTERESTED_LEADS,
            queries: niQueries,
            pageLimit: 100,
            maxPages: 500,
          }).catch(() => []);
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

    const kpiRows = scopeUsers.map((user) => {
            // Count leads created by this user (excluding referral sources):
            const createdCount = allLeads.filter((lead) => {
              let creatorId = lead.ownerId;
              try {
                const leadData = JSON.parse(lead.data);
                if (leadData && leadData.creatorId) {
                  creatorId = leadData.creatorId;
                }
              } catch {}

              if (creatorId !== user.$id) return false;

              // Exclude referral sources from KPI
              try {
                const leadData = JSON.parse(lead.data);
                if (leadData && isReferralSource(leadData.source)) {
                  return false;
                }
              } catch {}

              return true;
            }).length;

            // Count leads assigned to this user:
            const assignedCount = allLeads.filter((lead) => lead.assignedToId === user.$id).length;

            // Count active Not Interested events attributed to this user:
            const niCount = niEvents.filter((event) => {
              const attributed = event.previousAssignedToId || event.previousOwnerId;
              return attributed === user.$id && (!event.status || event.status === "active");
            }).length;

            return {
              userId: user.$id,
              userName: user.name,
              userRole: user.role,
              leadCount: createdCount,
              assignedLeadCount: assignedCount,
              notInterestedCount: niCount,
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
    return a.userName.localeCompare(b.userName);
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

export function parseIsoDateLocal(iso: string): Date {
    const [year, month, day] = iso.split("-").map(Number);
    return new Date(year, month - 1, day);
}

export function daysInMonthLocal(isoDate: string): number {
    const date = parseIsoDateLocal(isoDate);
    return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
}

export async function getUserByIdOrNull(databases: any, userId: string): Promise<any | null> {
    try {
    return await databases.getDocument(DATABASE_ID, COLLECTIONS.USERS, userId);
    } catch {
    return null;
    }
}

export async function getAgentsByTeamLead(databases: any, teamLeadId: string): Promise<any[]> {
    try {
    return await listAllDocuments<any>({
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

export function normalizeSource(value: unknown): string {
    if (typeof value !== "string") return "";
    return value.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function isReferralSource(source: unknown): boolean {
    return normalizeSource(source) === "referral";
}
