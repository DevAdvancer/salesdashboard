"use server";
import { ID, Permission, Query, Role } from "node-appwrite";
import { createAdminClient } from "@/lib/server/appwrite";
import { assertAuthenticatedUserId, getAuthenticatedUserDoc } from "@/lib/server/current-user";
import { COLLECTIONS, DATABASE_ID } from "@/lib/constants/appwrite";
import type { AttendanceRecord, Department, LinkedinAccount, User } from "@/lib/types";
import { createNotificationRecord, createNotificationsForRecipients } from "@/lib/server/notifications";
import { getEtDateKey, isAttendanceAdminLikeReadRole, isAttendanceAdminWriteRole, normalizeDepartment, matchesDepartmentScope, getEtHour, assertDateKey, dateKeyToUtcDate, utcDateToDateKey, addDaysUtc, buildInclusiveDateKeys, getIsoWeekStartDateKey, getMonthStartDateKey, getMonthEndDateKey, logAuditAction, getAttendanceDoc, upsertAttendanceDoc, getActiveLinkedinAccountsForUser, getActiveLinkedinAccountsForUsers, formatLinkedinAccountsForNotification } from "./shared";


export async function getAttendanceFlagSummaryAction(input: {
      currentUserId: string;
      teamLeadId?: string;
      referenceDateKey?: string;
    }) {
    await assertAuthenticatedUserId(input.currentUserId);
    const user = await getAuthenticatedUserDoc();
    const effectiveTeamLeadId = user.role === "team_lead"
              ? user.$id
              : isAttendanceAdminLikeReadRole(user.role)
                ? (input.teamLeadId ?? "")
                : "";
    if (!effectiveTeamLeadId) {
    throw new Error("Unauthorized");
    }

    const referenceDateKey = input.referenceDateKey
            ? assertDateKey(input.referenceDateKey)
            : getEtDateKey(new Date());
    const weekStart = getIsoWeekStartDateKey(referenceDateKey);
    const weekEnd = utcDateToDateKey(addDaysUtc(dateKeyToUtcDate(weekStart), 6));
    const monthStart = getMonthStartDateKey(referenceDateKey);
    const monthEnd = getMonthEndDateKey(referenceDateKey);
    const weekKeys = buildInclusiveDateKeys(weekStart, weekEnd);
    const monthKeys = buildInclusiveDateKeys(monthStart, monthEnd);
    const { databases } = await createAdminClient();
    const listForKeys = async (keys: string[]) => {
            if (keys.length === 0) return [] as AttendanceRecord[];
            const response = await databases.listDocuments(DATABASE_ID, COLLECTIONS.ATTENDANCE, [
              Query.equal("teamLeadId", effectiveTeamLeadId),
              Query.equal("dateKey", keys),
              Query.limit(2000),
            ]);
            return response.documents as unknown as AttendanceRecord[];
          };
    const [weekDocs, monthDocs] = await Promise.all([
            listForKeys(weekKeys),
            listForKeys(monthKeys),
          ]);
    const isFlagged = (doc: AttendanceRecord) =>
            doc.userId !== effectiveTeamLeadId &&
            doc.present === true &&
            doc.presentWithDelegateFlag === true;
    return {
    referenceDateKey,
    week: {
      startDateKey: weekStart,
      endDateKey: weekEnd,
      flaggedCount: weekDocs.filter(isFlagged).length,
    },
    month: {
      startDateKey: monthStart,
      endDateKey: monthEnd,
      flaggedCount: monthDocs.filter(isFlagged).length,
    },
    };
}

export async function getAttendanceReportAction(input: {
      currentUserId: string;
      startDateKey?: string;
      endDateKey?: string;
      teamLeadId?: string; // for admin/monitor to filter by specific team
      departmentScope?: Department | "all";
    }) {
    await assertAuthenticatedUserId(input.currentUserId);
    const user = await getAuthenticatedUserDoc();
    const isAdminLike = isAttendanceAdminLikeReadRole(user.role);
    if (!isAdminLike && user.role !== "team_lead") {
    throw new Error("Unauthorized");
    }

    const now = new Date();
    const startDateKey = input.startDateKey ? assertDateKey(input.startDateKey) : getEtDateKey(now);
    const endDateKey = input.endDateKey ? assertDateKey(input.endDateKey) : startDateKey;
    const { databases } = await createAdminClient();
    let allTeamLeadOptions: Array<{ userId: string; userName: string }> = [];
    let teamLeads: User[] = [];
    if (isAdminLike) {
    const teamLeadsResponse = await databases.listDocuments(DATABASE_ID, COLLECTIONS.USERS, [
      Query.equal("role", "team_lead"),
      Query.limit(2000),
    ]);
    const allTLs = (teamLeadsResponse.documents as unknown as User[])
      .filter((tl) => (tl as unknown as { isActive?: unknown }).isActive !== false)
      .filter((tl) => matchesDepartmentScope(tl, input.departmentScope ?? "sales"))
      .sort((a, b) => (a.name || "").localeCompare(b.name || ""));

    allTeamLeadOptions = allTLs.map((tl) => ({ userId: tl.$id, userName: tl.name }));

    if (input.teamLeadId) {
      // Filter to a specific team lead
      teamLeads = allTLs.filter((tl) => tl.$id === input.teamLeadId);
    } else {
      teamLeads = allTLs;
    }
    } else {
    // Team lead: only their own team
    const tlDoc = (await databases.getDocument(
      DATABASE_ID,
      COLLECTIONS.USERS,
      user.$id,
    )) as unknown as User;
    teamLeads = [tlDoc];
    allTeamLeadOptions = []; // TL doesn't need a filter dropdown
    }

    const teamLeadIds = teamLeads.map((tl) => tl.$id);
    const allTlAttendanceResponse = teamLeadIds.length > 0 ? await databases.listDocuments(DATABASE_ID, COLLECTIONS.ATTENDANCE, [
            Query.equal("userId", teamLeadIds),
            Query.greaterThanEqual("dateKey", startDateKey),
            Query.lessThanEqual("dateKey", endDateKey),
            Query.limit(2000),
          ]) : { documents: [] as unknown[] };
    const allTlAttRecords = allTlAttendanceResponse.documents as unknown as AttendanceRecord[];
    const allAgentsResponse = teamLeadIds.length > 0 ? await databases.listDocuments(DATABASE_ID, COLLECTIONS.USERS, [
            Query.equal("role", ["agent", "lead_generation"]),
            Query.equal("teamLeadId", teamLeadIds),
            Query.limit(5000),
          ]) : { documents: [] as unknown[] };
    const allAgents = (allAgentsResponse.documents as unknown as User[])
            .filter((a) => (a as unknown as { isActive?: unknown }).isActive !== false)
            .filter((a) => matchesDepartmentScope(a, input.departmentScope ?? "sales"))
            .sort((a, b) => (a.name || "").localeCompare(b.name || ""));
    const allAgentAttendanceResponse = teamLeadIds.length > 0 ? await databases.listDocuments(DATABASE_ID, COLLECTIONS.ATTENDANCE, [
            Query.equal("teamLeadId", teamLeadIds),
            Query.greaterThanEqual("dateKey", startDateKey),
            Query.lessThanEqual("dateKey", endDateKey),
            Query.limit(5000),
          ]) : { documents: [] as unknown[] };
    const allAgentAttRecords = allAgentAttendanceResponse.documents as unknown as AttendanceRecord[];
    const allAttendanceDocs = [...allTlAttRecords, ...allAgentAttRecords];
    const allDelegateIds = new Set<string>();
    allAttendanceDocs.forEach((doc) => {
    if (typeof doc.delegateUserId === "string" && doc.delegateUserId) {
      allDelegateIds.add(doc.delegateUserId);
    }
    if (typeof doc.assignedById === "string" && doc.assignedById) {
      allDelegateIds.add(doc.assignedById);
    }
    });
    const delegateById = new Map<string, User>();
    if (allDelegateIds.size > 0) {
    const ids = Array.from(allDelegateIds);
    const chunkSize = 100;
    for (let i = 0; i < ids.length; i += chunkSize) {
      const chunk = ids.slice(i, i + chunkSize);
      const response = await databases.listDocuments(DATABASE_ID, COLLECTIONS.USERS, [
        Query.equal("$id", chunk),
        Query.limit(2000),
      ]);
      (response.documents as unknown as User[]).forEach((u) => delegateById.set(u.$id, u));
    }
    }

    const accountsByUserId = await getActiveLinkedinAccountsForUsers(
            databases,
            allAgents.map((a) => a.$id),
          );
    const agentAttendanceByUserId = new Map<string, AttendanceRecord[]>();
    allAgentAttRecords.forEach((doc) => {
    const existing = agentAttendanceByUserId.get(doc.userId) || [];
    existing.push(doc);
    agentAttendanceByUserId.set(doc.userId, existing);
    });
    const tlAttendanceByUserId = new Map<string, AttendanceRecord[]>();
    allTlAttRecords.forEach((doc) => {
    const existing = tlAttendanceByUserId.get(doc.userId) || [];
    existing.push(doc);
    tlAttendanceByUserId.set(doc.userId, existing);
    });
    const agentsByTlId = new Map<string, User[]>();
    allAgents.forEach((agent) => {
    if (!agent.teamLeadId) return;
    const existing = agentsByTlId.get(agent.teamLeadId) || [];
    existing.push(agent);
    agentsByTlId.set(agent.teamLeadId, existing);
    });
    const teams = teamLeads.map((tl) => {
            const tlAttRecords = tlAttendanceByUserId.get(tl.$id) || [];
            const latestTlAtt = tlAttRecords.length > 0 ? tlAttRecords.sort((a,b) => b.dateKey.localeCompare(a.dateKey))[0] : null;
            const tlDelegateUserId = latestTlAtt?.delegateUserId ?? null;
            const tlDelegateName = tlDelegateUserId ? delegateById.get(tlDelegateUserId)?.name ?? null : null;

            const agents = agentsByTlId.get(tl.$id) || [];

            const agentRows = agents.map((agent) => {
              const attRecords = agentAttendanceByUserId.get(agent.$id) ?? [];
              const latestAtt = attRecords.length > 0 ? attRecords.sort((a,b) => b.dateKey.localeCompare(a.dateKey))[0] : null;
              const presentDays = attRecords.filter(r => r.present).length;
              const isRange = startDateKey !== endDateKey;

              const delegateCounts = new Map<string, number>();
              for (const r of attRecords) {
                const id = r.delegateUserId;
                if (typeof id === "string" && id.trim().length > 0) {
                  delegateCounts.set(id, (delegateCounts.get(id) || 0) + 1);
                }
              }
              const delegateNameStr = delegateCounts.size > 0 
                ? Array.from(delegateCounts.entries())
                  .map(([id, count]) => {
                    const name = delegateById.get(id)?.name;
                    if (!name) return null;
                    return isRange ? `${name} (${count})` : name;
                  })
                  .filter(Boolean)
                  .join(", ")
                : null;

              const assignedByCounts = new Map<string, number>();
              for (const r of attRecords) {
                const id = r.assignedById;
                if (typeof id === "string" && id.trim().length > 0) {
                  assignedByCounts.set(id, (assignedByCounts.get(id) || 0) + 1);
                }
              }
              const assignedByNameStr = assignedByCounts.size > 0 
                ? Array.from(assignedByCounts.entries())
                  .map(([id, count]) => {
                    const name = delegateById.get(id)?.name;
                    if (!name) return null;
                    return isRange ? `${name} (${count})` : name;
                  })
                  .filter(Boolean)
                  .join(", ")
                : null;

              const accounts = accountsByUserId.get(agent.$id) ?? [];
              return {
                userId: agent.$id,
                userName: agent.name,
                role: agent.role,
                present: latestAtt?.present === true,
                presentAt: latestAtt?.presentAt ?? null,
                presentWithDelegateFlag: latestAtt?.presentWithDelegateFlag === true,
                presentDays,
                totalRecords: attRecords.length,
                delegateUserId: latestAtt?.delegateUserId ?? null,
                delegateUserName: delegateNameStr,
                assignedById: latestAtt?.assignedById ?? null,
                assignedByName: assignedByNameStr,
                linkedinAccounts: accounts.map((a) => ({
                  id: a.$id,
                  company: a.company,
                  idName: a.idName,
                  accountType: a.accountType,
                })),
              };
            });

            return {
              teamLeadId: tl.$id,
              teamLeadName: tl.name,
              teamLeadPresent: latestTlAtt?.present === true,
              teamLeadPresentAt: latestTlAtt?.presentAt ?? null,
              teamLeadPresentDays: tlAttRecords.filter(r => r.present).length,
              teamLeadTotalRecords: tlAttRecords.length,
              teamLeadDelegateUserId: tlDelegateUserId,
              teamLeadDelegateName: tlDelegateName,
              agents: agentRows,
            };
          });
    return { startDateKey, endDateKey, teams, allTeamLeadOptions };
}
