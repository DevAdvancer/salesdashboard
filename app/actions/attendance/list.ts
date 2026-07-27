"use server";
import { ID, Permission, Query, Role } from "node-appwrite";
import { createAdminClient } from "@/lib/server/appwrite";
import { assertAuthenticatedUserId, getAuthenticatedUserDoc } from "@/lib/server/current-user";
import { COLLECTIONS, DATABASE_ID } from "@/lib/constants/appwrite";
import type { AttendanceRecord, Department, LinkedinAccount, User } from "@/lib/types";
import { createNotificationRecord, createNotificationsForRecipients } from "@/lib/server/notifications";
import { getEtDateKey, isAttendanceAdminLikeReadRole, isAttendanceAdminWriteRole, normalizeDepartment, matchesDepartmentScope, getEtHour, assertDateKey, dateKeyToUtcDate, utcDateToDateKey, addDaysUtc, buildInclusiveDateKeys, getIsoWeekStartDateKey, getMonthStartDateKey, getMonthEndDateKey, logAuditAction, getAttendanceDoc, upsertAttendanceDoc, getActiveLinkedinAccountsForUser, getActiveLinkedinAccountsForUsers, formatLinkedinAccountsForNotification } from "./shared";


export async function listMyTeamAttendanceAction(input: {
      currentUserId: string;
      teamLeadId?: string;
      dateKey?: string;
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

    const now = new Date();
    const dateKey = input.dateKey ? assertDateKey(input.dateKey) : getEtDateKey(now);
    const { databases } = await createAdminClient();
    const teamLeadDoc = (await databases.getDocument(
            DATABASE_ID,
            COLLECTIONS.USERS,
            effectiveTeamLeadId,
          )) as unknown as User;
    if (teamLeadDoc.role !== "team_lead") {
    throw new Error("Invalid Team Lead");
    }

    const agentsResponse = await databases.listDocuments(DATABASE_ID, COLLECTIONS.USERS, [
            Query.equal("role", ["agent", "lead_generation"]),
            Query.equal("teamLeadId", effectiveTeamLeadId),
            Query.limit(2000),
          ]);
    const agents = (agentsResponse.documents as unknown as User[])
            .filter((agent) => (agent as unknown as { isActive?: unknown }).isActive !== false)
            .sort((a, b) => (a.name || "").localeCompare(b.name || ""));
    const attendanceResponse = await databases.listDocuments(DATABASE_ID, COLLECTIONS.ATTENDANCE, [
            Query.equal("dateKey", dateKey),
            Query.equal("teamLeadId", effectiveTeamLeadId),
            Query.limit(2000),
          ]);
    const attendanceDocs = attendanceResponse.documents as unknown as AttendanceRecord[];
    const attendanceByUserId = new Map<string, AttendanceRecord>();
    attendanceDocs.forEach((doc) => attendanceByUserId.set(doc.userId, doc));
    const agentsById = new Map<string, User>();
    agents.forEach((a) => agentsById.set(a.$id, a));
    const teamLeadAttendance = attendanceByUserId.get(effectiveTeamLeadId) ?? null;
    const teamLeadDelegateUserId = teamLeadAttendance?.delegateUserId ?? null;
    const teamLeadDelegateUser = teamLeadDelegateUserId ? ((await databases.getDocument(
              DATABASE_ID,
              COLLECTIONS.USERS,
              teamLeadDelegateUserId,
            )) as unknown as User) : null;
    const accountsByUserId = await getActiveLinkedinAccountsForUsers(
            databases,
            agents.map((a) => a.$id),
          );
    const rows = await Promise.all(
            agents.map(async (agent) => {
              const attendance = attendanceByUserId.get(agent.$id) ?? null;
              const delegateUserId = attendance?.delegateUserId ?? null;
              const delegate = delegateUserId ? agentsById.get(delegateUserId) ?? null : null;
              const accounts = accountsByUserId.get(agent.$id) ?? [];
              return {
                userId: agent.$id,
                userName: agent.name,
                present: attendance?.present === true,
                presentAt: attendance?.presentAt ?? null,
                absentNotifiedAt: attendance?.absentNotifiedAt ?? null,
                presentWithDelegateFlag: attendance?.presentWithDelegateFlag === true,
                delegateUserId,
                delegateUserName: delegate?.name ?? null,
                linkedinAccounts: accounts.map((a) => ({
                  id: a.$id,
                  company: a.company,
                  idName: a.idName,
                  accountType: a.accountType,
                  licenseType: a.licenseType ?? null,
                  connectionLimit: a.connectionLimit ?? null,
                })),
              };
            }),
          );
    const delegateOptions = agents.map((a) => ({ userId: a.$id, userName: a.name }));
    return {
    dateKey,
    teamLead: {
      userId: teamLeadDoc.$id,
      userName: teamLeadDoc.name,
      present: teamLeadAttendance?.present === true,
      presentAt: teamLeadAttendance?.presentAt ?? null,
      absentNotifiedAt: teamLeadAttendance?.absentNotifiedAt ?? null,
      delegateUserId: teamLeadDelegateUserId,
      delegateUserName: teamLeadDelegateUser?.name ?? null,
    },
    rows,
    delegateOptions,
    };
}

export async function listTeamLeadsAttendanceForAdminAction(input: {
      currentUserId: string;
      dateKey?: string;
      departmentScope?: Department | "all";
    }) {
    await assertAuthenticatedUserId(input.currentUserId);
    const user = await getAuthenticatedUserDoc();
    if (!isAttendanceAdminLikeReadRole(user.role)) {
    throw new Error("Unauthorized");
    }

    const now = new Date();
    const dateKey = input.dateKey ? assertDateKey(input.dateKey) : getEtDateKey(now);
    const { databases } = await createAdminClient();
    const teamLeadsResponse = await databases.listDocuments(DATABASE_ID, COLLECTIONS.USERS, [
            Query.equal("role", "team_lead"),
            Query.limit(2000),
          ]);
    const teamLeads = (teamLeadsResponse.documents as unknown as User[])
            .filter((teamLead) => (teamLead as unknown as { isActive?: unknown }).isActive !== false)
            .filter((teamLead) => matchesDepartmentScope(teamLead, input.departmentScope ?? "sales"))
            .sort((a, b) => (a.name || "").localeCompare(b.name || ""));
    const teamLeadIds = teamLeads.map((t) => t.$id);
    const attendanceResponse = teamLeadIds.length > 0
              ? await databases.listDocuments(DATABASE_ID, COLLECTIONS.ATTENDANCE, [
                  Query.equal("dateKey", dateKey),
                  Query.equal("userId", teamLeadIds),
                  Query.limit(2000),
                ])
              : { documents: [] as unknown[] };
    const attendanceDocs = attendanceResponse.documents as unknown as AttendanceRecord[];
    const attendanceByUserId = new Map<string, AttendanceRecord>();
    attendanceDocs.forEach((doc) => attendanceByUserId.set(doc.userId, doc));
    const delegateIds = Array.from(
            new Set(
              attendanceDocs
                .map((d) => (typeof d.delegateUserId === "string" && d.delegateUserId ? d.delegateUserId : null))
                .filter((v): v is string => Boolean(v)),
            ),
          );
    const delegateById = new Map<string, User>();
    if (delegateIds.length > 0) {
    const chunkSize = 100;
    for (let i = 0; i < delegateIds.length; i += chunkSize) {
      const chunk = delegateIds.slice(i, i + chunkSize);
      const response = await databases.listDocuments(DATABASE_ID, COLLECTIONS.USERS, [
        Query.equal("$id", chunk),
        Query.limit(2000),
      ]);
      (response.documents as unknown as User[]).forEach((u) => delegateById.set(u.$id, u));
    }
    }

    const rows = await Promise.all(
            teamLeads.map(async (tl) => {
              const attendance = attendanceByUserId.get(tl.$id) ?? null;
              const delegateUserId = attendance?.delegateUserId ?? null;
              const delegateUser = delegateUserId ? delegateById.get(delegateUserId) ?? null : null;
              return {
                userId: tl.$id,
                userName: tl.name,
                present: attendance?.present === true,
                presentAt: attendance?.presentAt ?? null,
                absentNotifiedAt: attendance?.absentNotifiedAt ?? null,
                delegateUserId,
                delegateUserName: delegateUser?.name ?? null,
              };
            }),
          );
    const delegateOptions = teamLeads.map((tl) => ({ userId: tl.$id, userName: tl.name }));
    return { dateKey, rows, delegateOptions };
}
