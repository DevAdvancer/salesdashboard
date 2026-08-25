"use server";
import { ID, Permission, Query, Role } from "node-appwrite";
import { createAdminClient } from "@/lib/server/appwrite";
import { assertAuthenticatedUserId, getAuthenticatedUserDoc } from "@/lib/server/current-user";
import { COLLECTIONS, DATABASE_ID } from "@/lib/constants/appwrite";
import type { AttendanceRecord, Department, LinkedinAccount, User } from "@/lib/types";
import { createNotificationRecord, createNotificationsForRecipients } from "@/lib/server/notifications";
import { getEtDateKey, isAttendanceAdminLikeReadRole, isAttendanceAdminWriteRole, normalizeDepartment, matchesDepartmentScope, getEtHour, assertDateKey, dateKeyToUtcDate, utcDateToDateKey, addDaysUtc, buildInclusiveDateKeys, getIsoWeekStartDateKey, getMonthStartDateKey, getMonthEndDateKey, logAuditAction, getAttendanceDoc, upsertAttendanceDoc, getActiveLinkedinAccountsForUser, getActiveLinkedinAccountsForUsers, formatLinkedinAccountsForNotification } from "./shared";


export async function checkAndNotifyMyTeamAbsencesAction(input: {
      currentUserId: string;
    }) {
    await assertAuthenticatedUserId(input.currentUserId);
    const user = await getAuthenticatedUserDoc();
    if (user.role !== "team_lead") {
    return { dateKey: getEtDateKey(new Date()), notified: 0 };
    }

    const now = new Date();
    const dateKey = getEtDateKey(now);
    const hour = getEtHour(now);
    if (hour < 10) {
    return { dateKey, notified: 0 };
    }

    const { databases } = await createAdminClient();
    const teamLeadAttendance = await getAttendanceDoc(databases, {
            dateKey,
            userId: user.$id,
          });
    const recipientTeamLeadId = teamLeadAttendance?.delegateUserId ?? user.$id;
    const agentsResponse = await databases.listDocuments(DATABASE_ID, COLLECTIONS.USERS, [
            Query.equal("role", ["agent", "lead_generation"]),
            Query.equal("teamLeadId", user.$id),
            Query.select(["$id", "name", "isActive"]),
            Query.limit(2000),
          ]);
    const agents = (agentsResponse.documents as unknown as User[]).filter(
            (agent) => (agent as unknown as { isActive?: unknown }).isActive !== false,
          );
    if (agents.length === 0) {
    return { dateKey, notified: 0 };
    }

    const attendanceResponse = await databases.listDocuments(DATABASE_ID, COLLECTIONS.ATTENDANCE, [
            Query.equal("dateKey", dateKey),
            Query.equal("teamLeadId", user.$id),
            Query.select(["userId", "present", "absentNotifiedAt"]),
            Query.limit(2000),
          ]);
    const attendanceDocs = attendanceResponse.documents as unknown as AttendanceRecord[];
    const attendanceByUserId = new Map<string, AttendanceRecord>();
    attendanceDocs.forEach((doc) => attendanceByUserId.set(doc.userId, doc));
    const notifyAgentIds: string[] = [];
    const notifyAgentNameById = new Map<string, string>();
    for (const agent of agents) {
    const existing = attendanceByUserId.get(agent.$id) ?? null;
    const isPresent = existing?.present === true;
    if (isPresent) continue;

    const shouldNotify = !existing || !existing.absentNotifiedAt;
    const updated = await upsertAttendanceDoc(databases, {
      dateKey,
      userId: agent.$id,
      teamLeadId: user.$id,
      patch: {
        absentNotifiedAt: shouldNotify ? now.toISOString() : (existing?.absentNotifiedAt ?? null),
      },
    });
    attendanceByUserId.set(agent.$id, updated);

    if (!shouldNotify) continue;
    notifyAgentIds.push(agent.$id);
    notifyAgentNameById.set(agent.$id, agent.name);
    }

    const accountsByUserId = await getActiveLinkedinAccountsForUsers(databases, notifyAgentIds);
    if (notifyAgentIds.length > 0) {
      const details = notifyAgentIds.map(agentId => {
        const name = notifyAgentNameById.get(agentId) ?? "Agent";
        const accounts = accountsByUserId.get(agentId) ?? [];
        return `${name} (${formatLinkedinAccountsForNotification(accounts)})`;
      });
      await createNotificationRecord(databases, {
        recipientId: recipientTeamLeadId,
        type: "ATTENDANCE_ABSENT",
        title: `${notifyAgentIds.length} Agents Absent`,
        body: `No in-app presence detected in 9-10 ET for: ${details.join(", ")}`,
        targetType: "attendance",
        targetId: null,
      });
    }
    return { dateKey, notified: notifyAgentIds.length };
}

export async function checkAndNotifyAdminAttendanceEscalationsAction(input: {
      currentUserId: string;
      departmentScope?: Department | "all";
    }) {
    await assertAuthenticatedUserId(input.currentUserId);
    const user = await getAuthenticatedUserDoc();
    if (!isAttendanceAdminWriteRole(user.role)) {
    return { dateKey: getEtDateKey(new Date()), teamLeadAbsentNotified: 0, agentAbsentNotified: 0, agentEscalated: 0 };
    }

    const now = new Date();
    const dateKey = getEtDateKey(now);
    const hour = getEtHour(now);
    if (hour !== 10) {
    return { dateKey, teamLeadAbsentNotified: 0, agentAbsentNotified: 0, agentEscalated: 0 };
    }

    const { databases } = await createAdminClient();
    const [adminUsersResponse, teamLeadsResponse] = await Promise.all([
            databases.listDocuments(DATABASE_ID, COLLECTIONS.USERS, [
              Query.equal("role", ["admin", "operations"]),
              Query.select(["$id", "isActive"]),
              Query.limit(2000),
            ]),
            databases.listDocuments(DATABASE_ID, COLLECTIONS.USERS, [
              Query.equal("role", "team_lead"),
              Query.select(["$id", "name", "isActive", "department"]),
              Query.limit(2000),
            ]),
          ]);
    const adminUsers = (adminUsersResponse.documents as unknown as User[]).filter(
            (adminUser) => (adminUser as unknown as { isActive?: unknown }).isActive !== false,
          );
    const adminRecipientIds = adminUsers.map((a) => a.$id);
    const teamLeads = (teamLeadsResponse.documents as unknown as User[]).filter(
            (teamLead) => (teamLead as unknown as { isActive?: unknown }).isActive !== false,
          ).filter((teamLead) => matchesDepartmentScope(teamLead, input.departmentScope ?? "sales"));
    let teamLeadAbsentNotified = 0;
    let agentAbsentNotified = 0;
    let agentEscalated = 0;
    const teamLeadAbsentNotifiedNames: string[] = [];
    const teamLeadIds = teamLeads.map((t) => t.$id);
    const [agentsResponse, attendanceResponse] = await Promise.all([
            teamLeadIds.length > 0
              ? databases.listDocuments(DATABASE_ID, COLLECTIONS.USERS, [
                  Query.equal("role", ["agent", "lead_generation"]),
                  Query.equal("teamLeadId", teamLeadIds),
                  Query.select(["$id", "name", "isActive", "department", "teamLeadId"]),
                  Query.limit(5000),
                ])
              : Promise.resolve({ documents: [] as unknown[] }),
            databases.listDocuments(DATABASE_ID, COLLECTIONS.ATTENDANCE, [
              Query.equal("dateKey", dateKey),
              Query.select(["userId", "present", "absentNotifiedAt", "adminEscalatedAt", "delegateUserId"]),
              Query.limit(5000),
            ]),
          ]);
    const agents = (agentsResponse.documents as unknown as User[]).filter(
            (agent) => (agent as unknown as { isActive?: unknown }).isActive !== false,
          ).filter((agent) => matchesDepartmentScope(agent, input.departmentScope ?? "sales"));
    const agentsByTeamLeadId = new Map<string, User[]>();
    for (const agent of agents) {
    if (!agent.teamLeadId) continue;
    const existingAgents = agentsByTeamLeadId.get(agent.teamLeadId) ?? [];
    existingAgents.push(agent);
    agentsByTeamLeadId.set(agent.teamLeadId, existingAgents);
    }

    const attendanceByUserId = new Map<string, AttendanceRecord>();
    (attendanceResponse.documents as unknown as AttendanceRecord[]).forEach((doc) => {
    attendanceByUserId.set(doc.userId, doc);
    });
    const notifyAgentJobs: Array<{
        agentId: string;
        agentName: string;
        recipientTeamLeadId: string;
        }> = [];
    const escalateAgentJobs: Array<{
        agentId: string;
        agentName: string;
        teamLeadId: string;
        teamLeadName: string;
        }> = [];
    for (const teamLead of teamLeads) {
    const teamLeadAttendance = attendanceByUserId.get(teamLead.$id) ?? null;
    const teamLeadIsPresent = teamLeadAttendance?.present === true;
    const isLeadGenTL = teamLead.$id === "6a7f6f240000aee049cf" || teamLead.name.toLowerCase().includes("lead generation");
    if (!teamLeadIsPresent && !teamLeadAttendance?.absentNotifiedAt && !isLeadGenTL) {
      const updatedTl = await upsertAttendanceDoc(databases, {
        dateKey,
        userId: teamLead.$id,
        teamLeadId: teamLead.$id,
        patch: {
          absentNotifiedAt: now.toISOString(),
        },
        existing: teamLeadAttendance,
      });
      attendanceByUserId.set(teamLead.$id, updatedTl);
      
      teamLeadAbsentNotifiedNames.push(teamLead.name);
      
      teamLeadAbsentNotified += 1;
    }

    const refreshedTeamLeadAttendance = attendanceByUserId.get(teamLead.$id) ?? teamLeadAttendance;
    const recipientTeamLeadId = refreshedTeamLeadAttendance?.delegateUserId ?? teamLead.$id;
    const teamLeadAgents = agentsByTeamLeadId.get(teamLead.$id) ?? [];
    if (teamLeadAgents.length === 0) {
      continue;
    }

    for (const agent of teamLeadAgents) {
      const existing = attendanceByUserId.get(agent.$id) ?? null;
      const isPresent = existing?.present === true;
      if (isPresent) {
        continue;
      }

      const shouldNotifyTeamLead = !existing || !existing.absentNotifiedAt;
      const needsAbsentWrite =
        !existing ||
        existing.present !== false ||
        (shouldNotifyTeamLead && !existing.absentNotifiedAt);
      const updated = needsAbsentWrite
        ? await upsertAttendanceDoc(databases, {
            dateKey,
            userId: agent.$id,
            teamLeadId: teamLead.$id,
            patch: {
              absentNotifiedAt: shouldNotifyTeamLead ? now.toISOString() : (existing?.absentNotifiedAt ?? null),
              adminEscalatedAt: existing?.adminEscalatedAt ?? null,
            },
            existing,
          })
        : existing;
      if (!updated) {
        continue;
      }
      attendanceByUserId.set(agent.$id, updated);

      if (shouldNotifyTeamLead) {
        notifyAgentJobs.push({
          agentId: agent.$id,
          agentName: agent.name,
          recipientTeamLeadId,
        });
        agentAbsentNotified += 1;
      }

      const absentNotifiedAt = updated.absentNotifiedAt ? new Date(updated.absentNotifiedAt) : null;
      const minutesSinceNotified =
        absentNotifiedAt ? Math.floor((now.getTime() - absentNotifiedAt.getTime()) / 60000) : 0;
      const needsEscalation =
        Boolean(updated.absentNotifiedAt) &&
        minutesSinceNotified >= 30 &&
        !updated.delegateUserId &&
        !updated.adminEscalatedAt;
      if (!needsEscalation) {
        continue;
      }
      escalateAgentJobs.push({
        agentId: agent.$id,
        agentName: agent.name,
        teamLeadId: teamLead.$id,
        teamLeadName: teamLead.name,
      });
    }
    }

    const accountLookupIds = Array.from(
            new Set([
              ...notifyAgentJobs.map((job) => job.agentId),
              ...escalateAgentJobs.map((job) => job.agentId),
            ]),
          );
    const accountsByUserId = await getActiveLinkedinAccountsForUsers(databases, accountLookupIds);
    
    // Batch ATTENDANCE_ABSENT for notifyAgentJobs by recipientTeamLeadId
    const jobsByTeamLead = new Map<string, typeof notifyAgentJobs>();
    notifyAgentJobs.forEach(job => {
      const list = jobsByTeamLead.get(job.recipientTeamLeadId) ?? [];
      list.push(job);
      jobsByTeamLead.set(job.recipientTeamLeadId, list);
    });

    await Promise.all(
      Array.from(jobsByTeamLead.entries()).map(async ([recipientTeamLeadId, jobs]) => {
        const details = jobs.map(job => {
          const accounts = accountsByUserId.get(job.agentId) ?? [];
          return `${job.agentName} (${formatLinkedinAccountsForNotification(accounts)})`;
        });
        await createNotificationRecord(databases, {
          recipientId: recipientTeamLeadId,
          type: "ATTENDANCE_ABSENT",
          title: `${jobs.length} Agents Absent`,
          body: `No in-app presence detected in 9-10 ET for: ${details.join(", ")}`,
          targetType: "attendance",
          targetId: null,
        });
      })
    );

    // Update DB for escalated agents
    for (const job of escalateAgentJobs) {
      const existing = attendanceByUserId.get(job.agentId) ?? null;
      const updated = await upsertAttendanceDoc(databases, {
        dateKey,
        userId: job.agentId,
        teamLeadId: job.teamLeadId,
        patch: {
          adminEscalatedAt: now.toISOString(),
        },
        existing,
      });
      attendanceByUserId.set(job.agentId, updated);
      agentEscalated += 1;
    }
    
    // Batch ATTENDANCE_UNASSIGNED for Admins
    if (escalateAgentJobs.length > 0) {
      const details = escalateAgentJobs.map(job => {
        const accounts = accountsByUserId.get(job.agentId) ?? [];
        return `${job.agentName} (TL: ${job.teamLeadName}) [${formatLinkedinAccountsForNotification(accounts)}]`;
      });
      await createNotificationsForRecipients(databases, adminRecipientIds, {
        type: "ATTENDANCE_UNASSIGNED",
        title: `${escalateAgentJobs.length} Unassigned Absences`,
        body: `The following agents are absent and no delegate was assigned within 30 minutes: ${details.join(", ")}`,
        targetType: "attendance",
        targetId: null,
      });
    }

    // Batch ATTENDANCE_TL_ABSENT for Admins
    if (teamLeadAbsentNotifiedNames.length > 0) {
      await createNotificationsForRecipients(databases, adminRecipientIds, {
        type: "ATTENDANCE_TL_ABSENT",
        title: `${teamLeadAbsentNotifiedNames.length} TL(s) Absent`,
        body: `No in-app presence detected in 9-10 ET for Team Leads: ${teamLeadAbsentNotifiedNames.join(", ")}`,
        targetType: "attendance",
        targetId: null,
      });
    }

    return { dateKey, teamLeadAbsentNotified, agentAbsentNotified, agentEscalated };
}
