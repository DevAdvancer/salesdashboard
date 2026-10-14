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
import { listLinkedinReportRequests } from "@/lib/server/linkedin-report-requests";
import { summarizeLinkedinRequests } from "@/lib/utils/linkedin-report-summary";
import { listLinkedinReportLeadActivity } from "@/lib/server/linkedin-report-leads";

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

  const { databases } = await createAdminClient();
  const [requests, leadActivity] = await Promise.all([
    listLinkedinReportRequests({ databases, startDate: input.startDate,
      endDate: input.endDate, teamLeadId: effectiveTeamLeadId }),
    listLinkedinReportLeadActivity({ databases, startDate: input.startDate,
      endDate: input.endDate, teamLeadId: effectiveTeamLeadId }),
  ]);
  const agentIds = [...new Set([...requests, ...leadActivity.map(item => item.request)]
    .map(request => request.agentId).filter(Boolean))];
  const salesAgentIds = await getSalesUserIds(databases, agentIds);
  const visible = requests.filter(request => salesAgentIds.has(request.agentId));
  const visibleActivity = leadActivity.filter(item => salesAgentIds.has(item.request.agentId));
  const accountIds = [...new Set([...visible, ...visibleActivity.map(item => item.request)]
    .map(request => request.accountId).filter(Boolean))];
  const accounts = new Map<string, LinkedinAccount>();
  for (let i = 0; i < accountIds.length; i += 100) {
    const page = await databases.listDocuments(DATABASE_ID, COLLECTIONS.LINKEDIN_ACCOUNTS,
      [Query.equal("$id", accountIds.slice(i, i + 100)), Query.limit(100)]);
    for (const account of page.documents as unknown as LinkedinAccount[]) accounts.set(account.$id, account);
  }

  return {
    startDate: input.startDate,
    endDate: input.endDate,
    rows: summarizeLinkedinRequests(visible, accounts, visibleActivity),
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
      queries.push(Query.greaterThanEqual("dateKey", expandIsoDateToStart(input.dateRange.from).slice(0, 10)));
    }

    if (input.dateRange.to) {
      queries.push(Query.lessThanEqual("dateKey", expandIsoDateToEnd(input.dateRange.to).slice(0, 10)));
    }

    const stats = await listAllDocuments<any>({
      databases,
      databaseId: DATABASE_ID,
      collectionId: COLLECTIONS.LINKEDIN_DAILY_STATS,
      queries,
      pageLimit: 100,
      maxPages: 100,
    });

    const startDate = input.dateRange.from ? expandIsoDateToStart(input.dateRange.from).slice(0, 10) : "";
    const endDate = input.dateRange.to ? expandIsoDateToEnd(input.dateRange.to).slice(0, 10) : (startDate || "");
    const todayIso = getCurrentEasternIsoDate();
    
    if (startDate && startDate <= todayIso && endDate >= todayIso) {
      const todayStats = await computeLinkedinStatsForDate(todayIso);
      for (let i = stats.length - 1; i >= 0; i--) {
        if (stats[i].dateKey === todayIso) {
          stats.splice(i, 1);
        }
      }
      stats.push(...todayStats);
    }
    
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
    
    // Calculate sent count for this account
    const accountStats = stats.filter((s) => s.accountId === account.$id);
    const sentCount = accountStats.reduce((sum, s) => sum + (s.sent || 0), 0);
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
