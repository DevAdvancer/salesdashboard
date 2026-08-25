"use server";

import { Query } from "node-appwrite";
import { createAdminClient } from "@/lib/server/appwrite";
import { assertAuthenticatedUserId } from "@/lib/server/current-user";
import { DATABASE_ID, COLLECTIONS } from "@/lib/constants/appwrite";
import type { UserRole } from "@/lib/types";
import { getDepartmentScopedUserIds } from "@/app/actions/lead/visibility";
import { isAdminLikeReadAllRole, appendTeamLeadLeadVisibilityQuery, leadMatchesDepartmentScope } from "@/lib/services/lead/visibility";
import { getTeamLeadLeadVisibilityScope } from "@/app/actions/lead/visibility";
import { buildDepartmentScopeQuery, isDepartmentScopeInlineEnabled } from "@/lib/server/department-scope-query";
import { expandIsoDateToStart, expandIsoDateToEnd } from "@/lib/utils/iso-date-range";
import { listAllDocuments } from "@/lib/server/appwrite-pagination";

export async function getDashboardTopMetricsCountsAction(
  userId: string,
  userRole: UserRole,
  branchIds: string[] | undefined,
  dateFrom: string | undefined,
  dateTo: string | undefined
) {
  await assertAuthenticatedUserId(userId);
  const { databases } = await createAdminClient();

  const visibilityQueries: string[] = [];
  
  const salesUserIds = isAdminLikeReadAllRole(userRole)
    ? await getDepartmentScopedUserIds(databases, "sales")
    : null;

  if (userRole === "agent") {
    visibilityQueries.push(
      Query.or([
        Query.equal("assignedToId", userId),
        Query.equal("ownerId", userId),
      ])
    );
  } else if (userRole === "lead_generation") {
    visibilityQueries.push(Query.equal("ownerId", userId));
  } else if (userRole === "team_lead") {
    const { ownerVisibleUserIds, assignmentVisibleUserIds } =
      await getTeamLeadLeadVisibilityScope(databases, userId);
    appendTeamLeadLeadVisibilityQuery(
      visibilityQueries,
      ownerVisibleUserIds,
      assignmentVisibleUserIds,
      branchIds,
      true
    );
  }



  const activeQueries = [
    ...visibilityQueries,
    Query.equal("isClosed", false),
    Query.select(["$id"]),
    Query.limit(1),
  ];
  if (dateFrom) activeQueries.push(Query.greaterThanEqual("$createdAt", expandIsoDateToStart(dateFrom)));
  if (dateTo) activeQueries.push(Query.lessThanEqual("$createdAt", expandIsoDateToEnd(dateTo)));

  activeQueries.push(Query.notEqual('status', 'Not Interested'));
  activeQueries.push(Query.notEqual('status', 'Not-Interested'));

  const closedQueries = [
    ...visibilityQueries,
    Query.equal("isClosed", true),
    Query.select(["$id"]),
    Query.limit(1),
  ];

  if (salesUserIds && isDepartmentScopeInlineEnabled()) {
    const departmentScopeQuery = buildDepartmentScopeQuery(salesUserIds);
    if (departmentScopeQuery) {
      closedQueries.push(departmentScopeQuery);
    }
  }
  
  if (dateFrom) closedQueries.push(Query.greaterThanEqual("closedAt", expandIsoDateToStart(dateFrom)));
  if (dateTo) closedQueries.push(Query.lessThanEqual("closedAt", expandIsoDateToEnd(dateTo)));
  
  const excludedStatuses = [
    "Backout",
    "Backed Out",
    "Backedout",
    "Backed out",
    "Not-Interested",
    "Not Interested"
  ];
  
  for (const status of excludedStatuses) {
    closedQueries.push(Query.notEqual("status", status));
  }

  const [activeResult, closedResult] = await Promise.all([
    databases.listDocuments(DATABASE_ID, COLLECTIONS.LEADS, activeQueries),
    databases.listDocuments(DATABASE_ID, COLLECTIONS.LEADS, closedQueries),
  ]);
  
  const activeCount = activeResult.total;
  const closedCount = closedResult.total;

  return { activeLeads: activeCount, closedLeads: closedCount };
}
