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
    const startDate = expandIsoDateToStart(input.startDate);
    const endDate = expandIsoDateToEnd(input.endDate);
    const { databases } = await createAdminClient();
    const pageSize = 100;
    let cursor: string | null = null;
    const all: LinkedinRequest[] = [];
    while (true) {
    const queries = [
      Query.greaterThanEqual("dateSent", startDate),
      Query.lessThanEqual("dateSent", endDate),
      Query.limit(pageSize),
      Query.orderAsc("$id"),
    ];
    if (effectiveTeamLeadId && effectiveTeamLeadId !== "all") {
      queries.unshift(Query.equal("teamLeadId", effectiveTeamLeadId));
    }
    if (cursor) queries.push(Query.cursorAfter(cursor));

    const page = await databases.listDocuments(
      DATABASE_ID,
      COLLECTIONS.LINKEDIN_REQUESTS,
      queries,
    );

    const docs = page.documents as unknown as LinkedinRequest[];
    all.push(...docs);
    if (docs.length < pageSize) break;
    cursor = docs.at(-1)?.$id ?? null;
    if (!cursor) break;
    }

    const uniqueRequests = Array.from(
            new Map(all.map((r) => [r.$id, r] as const)).values(),
          );
    const agentIds = Array.from(
            new Set(uniqueRequests.map((r) => r.agentId).filter(Boolean)),
          );
    const salesAgentIds = await getSalesUserIds(databases, agentIds);
    const salesRequests = uniqueRequests.filter((r) => salesAgentIds.has(r.agentId));
    const visibleRequests = user.role === "team_lead"
              ? salesRequests.filter((request) => request.agentId !== user.$id)
              : salesRequests;
    const leadIds = Array.from(
      new Set(visibleRequests.map((r) => (typeof r.leadId === "string" && r.leadId ? r.leadId : null)).filter(Boolean))
    ) as string[];

    const accountIds = Array.from(
            new Set(visibleRequests.map((r) => r.accountId).filter(Boolean)),
          );
    const accountsMap = new Map<string, LinkedinAccount>();
    const leadById = new Map<string, { isClosed: boolean; status: string }>();

    await Promise.all([
      (async () => {
        if (accountIds.length > 0) {
          const chunkSize = 100;
          for (let i = 0; i < accountIds.length; i += chunkSize) {
            const chunk = accountIds.slice(i, i + chunkSize);
            const accounts = await databases.listDocuments(
              DATABASE_ID,
              COLLECTIONS.LINKEDIN_ACCOUNTS,
              [
                Query.equal("$id", chunk), 
                Query.select(["$id", "accountType", "idName"]),
                Query.limit(chunkSize)
              ],
            );
            (accounts.documents as unknown as LinkedinAccount[]).forEach((a) => {
              accountsMap.set(a.$id, a);
            });
          }
        }
      })(),
      (async () => {
        if (leadIds.length > 0) {
          const chunkSize = 100;
          for (let i = 0; i < leadIds.length; i += chunkSize) {
            const chunk = leadIds.slice(i, i + chunkSize);
            const response = await databases.listDocuments(DATABASE_ID, COLLECTIONS.LEADS, [
              Query.equal("$id", chunk),
              Query.select(["$id", "status", "isClosed"]),
              Query.limit(chunkSize),
            ]);
            for (const doc of response.documents as unknown as Array<{ $id: string; status?: unknown; isClosed?: unknown }>) {
              leadById.set(doc.$id, {
                isClosed: Boolean(doc.isClosed),
                status: typeof doc.status === "string" ? doc.status : "",
              });
            }
          }
        }
      })()
    ]);

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
    const leadIdsByKey = new Map<string, Set<string>>();
    for (const req of visibleRequests) {
    const account = accountsMap.get(req.accountId);
    const accountType = (account?.accountType ?? "main") as LinkedinAccountType;
    const idName = account?.idName ?? req.accountId;
    const key = `${req.agentId}-${req.accountId}`;
    const existing = map.get(key) ?? {
      agentId: req.agentId,
      accountId: req.accountId,
      company: req.company,
      idName,
      accountType,
      sent: 0,
      coldCalls: 0,
      accepted: 0,
      leadsGenerated: 0,
      closures: 0,
      notAccepted: 0,
      withdrawn: 0,
    };
    existing.sent += 1;
    if (req.coldCall) {
      existing.coldCalls += 1;
    }
    const status = req.status;
    const isActive = req.isActive !== false;
    if (status === "accepted") {
      existing.accepted += 1;
    } else if (status === "withdrawn" || !isActive) {
      existing.withdrawn += 1;
    } else {
      existing.notAccepted += 1;
    }

    const leadId = typeof req.leadId === "string" && req.leadId ? req.leadId : null;
    if (leadId) {
      const set = leadIdsByKey.get(key) ?? new Set<string>();
      set.add(leadId);
      leadIdsByKey.set(key, set);
    }
    map.set(key, existing);
    }

    // leadById is already fetched above in parallel

    for (const [key, row] of map.entries()) {
    const leadIdsForKey = leadIdsByKey.get(key);
    if (!leadIdsForKey) continue;
    row.leadsGenerated = leadIdsForKey.size;
    let closures = 0;
    for (const leadId of leadIdsForKey) {
      const lead = leadById.get(leadId);
      if (!lead) continue;
      const normalizedStatus = lead.status.trim().toLowerCase().replace(/\s+/g, "");
      if (lead.isClosed && normalizedStatus === "won") {
        closures += 1;
      }
    }
    row.closures = closures;
    }

    return {
    startDate,
    endDate,
    rows: Array.from(map.values()).sort((a, b) =>
      a.company.localeCompare(b.company) || a.idName.localeCompare(b.idName),
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
              Query.select(["$id", "assignedUserId", "company", "idName", "connectionLimit"]),
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
    queries.push(Query.select(['$id', 'accountId', 'isActive', 'status', 'dateSent']));
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
