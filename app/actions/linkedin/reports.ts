"use server";
import { ID, Permission, Query, Role } from "node-appwrite";
import { createAdminClient } from "@/lib/server/appwrite";
import { assertAuthenticatedUserId, getAuthenticatedUserDoc } from "@/lib/server/current-user";
import { COLLECTIONS, DATABASE_ID } from "@/lib/constants/appwrite";
import type { Lead, LinkedinAccount, LinkedinAccountType, LinkedinRequest, LinkedinRequestStatus, User } from "@/lib/types";
import { LINKEDIN_ACCEPTED_LEAD_GRACE_DAYS, LINKEDIN_SENT_MANUAL_WITHDRAW_DAYS, shouldAutoWithdrawLinkedinRequest, LINKEDIN_ACCEPTED_AUTO_WITHDRAW_DAYS, LINKEDIN_SENT_AUTO_WITHDRAW_DAYS } from "@/lib/utils/linkedin-withdrawal-reminders";
import { workingDaysInRange } from "@/lib/utils/dashboard-kpi";
import { listAllDocuments } from "@/lib/server/appwrite-pagination";
import { expandIsoDateToEnd, expandIsoDateToStart } from "@/lib/utils/iso-date-range";
import { listHolidayDateKeys } from "@/lib/server/holiday-calendar";
import { getAgentsByTeamLead, getAssignableUsers, getUserByIdOrNull } from "@/lib/services/user-service";
import { normalizeCompany, normalizeUrl, parseDateOnly, toUtcDayStartIso, toUtcDayEndIso, daysBetweenUtc, assertDateIso, normalizeLeadOutcomeStatus, getLeadOutcomeLabel, getLinkedinRequestLeadSnapshot, getLinkedinRequestLeadOutcomeLabel, isBlockingLinkedinRequest, createGeneralChatMessage, logAuditAction, canManageLinkedinAccounts, canSeeLinkedinReports, canReadLinkedinAccountsLikeAdmin, resolveLinkedinReportTeamLeadId, assertLinkedinReportTeamScope, assertAgentIsInTeam, getEtDateKey, getLinkedinAccountDoc, getTeamLeadAssignedUserIds, listDelegatedSourceUserIdsForToday, assertAccessibleLinkedinAccount, getSalesUserIds, resolveScopeUsersForLinkedin, LinkedinConnectionKpiRow, AutoWithdrawResult } from "./shared";
import { parseIsoDateLocal, daysInMonthLocal } from "../lead/sync-helpers";
import { getCurrentEasternIsoDate } from "@/lib/utils/eastern-date";
import { computeLinkedinStatsForDate } from "@/lib/server/stats-aggregator";

export async function getLinkedinWeeklyReportAction(input: {
  currentUserId: string;
  teamLeadId?: string | null;
  startDate: string;
  endDate: string;
}) {
  await assertAuthenticatedUserId(input.currentUserId);
  const user = await getAuthenticatedUserDoc();
  if (!canSeeLinkedinReports(user)) {
    throw new Error("Unauthorized");
  }

  const effectiveTeamLeadId = resolveLinkedinReportTeamLeadId(user, input.teamLeadId);
  assertLinkedinReportTeamScope(user, effectiveTeamLeadId);

  const startDate = expandIsoDateToStart(input.startDate).slice(0, 10);
  const endDate = expandIsoDateToEnd(input.endDate).slice(0, 10);

  const { databases } = await createAdminClient();

  const queries = [
    Query.greaterThanEqual("dateKey", startDate),
    Query.lessThanEqual("dateKey", endDate),
    Query.orderAsc("$id"),
  ];

  if (effectiveTeamLeadId && effectiveTeamLeadId !== "all") {
    queries.unshift(Query.equal("teamLeadId", effectiveTeamLeadId));
  }

  const stats = await listAllDocuments<any>({
    databases,
    databaseId: DATABASE_ID,
    collectionId: COLLECTIONS.LINKEDIN_DAILY_STATS,
    queries,
    pageLimit: 100,
    maxPages: 100,
  });

  const todayIso = getCurrentEasternIsoDate();
  if (startDate <= todayIso && endDate >= todayIso) {
    const todayStats = await computeLinkedinStatsForDate(todayIso);
    for (let i = stats.length - 1; i >= 0; i--) {
      if (stats[i].dateKey === todayIso) {
        stats.splice(i, 1);
      }
    }
    stats.push(...todayStats);
  }

  const agentIds = Array.from(new Set(stats.map((r) => r.agentId).filter(Boolean)));
  const salesAgentIds = await getSalesUserIds(databases, agentIds);
  const salesStats = stats.filter((r) => salesAgentIds.has(r.agentId));
  const visibleStats = user.role === "team_lead"
    ? salesStats.filter((stat) => stat.agentId !== user.$id)
    : salesStats;

  type Row = {
    agentId: string;
    accountId: string;
    company: string;
    idName: string;
    accountType: LinkedinAccountType;
    sent: number;
    coldCalls: number;
    accepted: number;
    leadsGenerated: number;
    closures: number;
    notAccepted: number;
    withdrawn: number;
  };

  const map = new Map<string, Row>();

  for (const stat of visibleStats) {
    const key = `${stat.agentId}-${stat.accountId}`;
    const existing = map.get(key) ?? {
      agentId: stat.agentId,
      accountId: stat.accountId,
      company: stat.company || "",
      idName: stat.idName || "",
      accountType: stat.accountType || "main",
      sent: 0,
      coldCalls: 0,
      accepted: 0,
      leadsGenerated: 0,
      closures: 0,
      notAccepted: 0,
      withdrawn: 0,
    };

    existing.sent += stat.sent || 0;
    existing.coldCalls += stat.coldCalls || 0;
    existing.accepted += stat.accepted || 0;
    existing.leadsGenerated += stat.leadsGenerated || 0;
    existing.closures += stat.closures || 0;
    existing.notAccepted += stat.notAccepted || 0;
    existing.withdrawn += stat.withdrawn || 0;

    map.set(key, existing);
  }

  return {
    startDate: input.startDate,
    endDate: input.endDate,
    rows: Array.from(map.values()).sort((a, b) =>
      a.company.localeCompare(b.company) || a.idName.localeCompare(b.idName)
    ),
  };
}

export async function loadLinkedinConnectionKpiAction(input: {
      userId: string;
      role: string;
      teamLeadId?: string;
      branchIds?: string[];
      dateRange: { from?: string; to?: string };
    }): Promise<LinkedinConnectionKpiRow[]> {
    await assertAuthenticatedUserId(input.userId);
    const { databases } = await createAdminClient();
    const scopeUsers = await resolveScopeUsersForLinkedin({
            userId: input.userId,
            role: input.role,
            teamLeadId: input.teamLeadId,
            branchIds: input.branchIds,
          });
    if (scopeUsers.length === 0) {
    return [];
    }

    const accountsRes = await databases.listDocuments(
      DATABASE_ID,
      COLLECTIONS.LINKEDIN_ACCOUNTS,
      [
        Query.equal("isActive", true),
        Query.limit(2000),
      ]
    );
    const allAccounts = (accountsRes.documents as unknown as LinkedinAccount[]).filter(
            (acc) => scopeUsers.some((u) => u.$id === acc.assignedUserId)
          );
    if (allAccounts.length === 0) {
    return [];
    }

    const queries: string[] = [];
    if (input.dateRange.from) {
      queries.push(Query.greaterThanEqual("dateSent", expandIsoDateToStart(input.dateRange.from)));
    }

    if (input.dateRange.to) {
      queries.push(Query.lessThanEqual("dateSent", expandIsoDateToEnd(input.dateRange.to)));
    }

    queries.push(Query.orderDesc("dateSent"));
    // Removed Query.select to avoid Appwrite 400 error
    const allRequests = await listAllDocuments<LinkedinRequest>({
      databases,
      databaseId: DATABASE_ID,
      collectionId: COLLECTIONS.LINKEDIN_REQUESTS,
      queries,
      pageLimit: 100,
      maxPages: 500,
    });
    const activeRequests = allRequests.filter((doc) => {
      const isActive = doc.isActive ?? true;
      return isActive && doc.status !== "withdrawn";
    });
    
    const fromIso = input.dateRange.from;
    const toIso = input.dateRange.to ?? input.dateRange.from;
    const holidayDateKeys = fromIso && toIso
              ? await listHolidayDateKeys({ databases, from: fromIso, to: toIso })
              : [];
    const singleDay = Boolean(fromIso && toIso && fromIso === toIso);
    let daysCount: number;
    let mode: "daily" | "monthly";
    if (singleDay) {
    daysCount = workingDaysInRange(fromIso!, toIso!, holidayDateKeys);
    mode = "daily";
    } else if (fromIso && toIso) {
    daysCount = workingDaysInRange(fromIso, toIso, holidayDateKeys);
    mode = "monthly";
    } else {
    const effectiveDate = toIso ?? new Date().toISOString().slice(0, 10);
    daysCount = daysInMonthLocal(effectiveDate);
    mode = "monthly";
    }

    const userRowsMap = new Map<string, {
            userId: string;
            userName: string;
            sentCount: number;
            target: number;
            companies: string[];
            idNames: string[];
          }>();
    for (const account of allAccounts) {
    const user = scopeUsers.find((u) => u.$id === account.assignedUserId);
    const userId = account.assignedUserId;
    const userName = user?.name ?? "Unknown";
    
    // Calculate sent count for this account from active requests
    const sentCount = activeRequests.filter((req) => req.accountId === account.$id).length;
    const target = (account.connectionLimit ?? 0) * daysCount;

    const existing = userRowsMap.get(userId) ?? {
      userId,
      userName,
      sentCount: 0,
      target: 0,
      companies: [],
      idNames: [],
    };

    existing.sentCount += sentCount;
    existing.target += target;
    if (account.company) existing.companies.push(account.company);
    if (account.idName) existing.idNames.push(account.idName);

    userRowsMap.set(userId, existing);
    }

    const kpiRows = Array.from(userRowsMap.values()).map((u) => {
            const uniqCompanies = Array.from(new Set(u.companies));
            const uniqIdNames = Array.from(new Set(u.idNames));
            return {
              accountId: u.userId, // use userId as the unique key
              idName: u.userName,
              company: uniqCompanies.length > 0 ? uniqCompanies.join(", ") : "LinkedIn",
              userName: u.userName,
              userId: u.userId,
              sentCount: u.sentCount,
              target: u.target,
              mode,
              idNames: uniqIdNames,
            };
          });
    kpiRows.sort((a, b) => {
    const aMet = a.target > 0 && a.sentCount >= a.target;
    const bMet = b.target > 0 && b.sentCount >= b.target;
    if (aMet !== bMet) return aMet ? 1 : -1;
    const aGap = a.target - a.sentCount;
    const bGap = b.target - b.sentCount;
    if (aGap !== bGap) return bGap - aGap;
    return a.idName.localeCompare(b.idName);
    });
    return kpiRows;
}
