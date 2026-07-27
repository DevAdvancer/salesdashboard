"use server";
import { ID, Permission, Query, Role } from "node-appwrite";
import { createAdminClient } from "@/lib/server/appwrite";
import { assertAuthenticatedUserId, getAuthenticatedUserDoc } from "@/lib/server/current-user";
import { COLLECTIONS, DATABASE_ID } from "@/lib/constants/appwrite";
import type { AttendanceRecord, Department, LinkedinAccount, User } from "@/lib/types";
import { createNotificationRecord, createNotificationsForRecipients } from "@/lib/server/notifications";
import { getEtDateKey, isAttendanceAdminLikeReadRole, isAttendanceAdminWriteRole, normalizeDepartment, matchesDepartmentScope, getEtHour, assertDateKey, dateKeyToUtcDate, utcDateToDateKey, addDaysUtc, buildInclusiveDateKeys, getIsoWeekStartDateKey, getMonthStartDateKey, getMonthEndDateKey, logAuditAction, getAttendanceDoc, upsertAttendanceDoc, getActiveLinkedinAccountsForUser, getActiveLinkedinAccountsForUsers, formatLinkedinAccountsForNotification } from "./shared";


export async function assignAttendanceDelegateAction(input: {
      currentUserId: string;
      absentUserId: string;
      delegateUserId: string | null;
      dateKey?: string;
      remark: string;
    }) {
    await assertAuthenticatedUserId(input.currentUserId);
    const user = await getAuthenticatedUserDoc();
    if (user.role !== "team_lead" && !isAttendanceAdminWriteRole(user.role)) {
    throw new Error("Unauthorized");
    }

    const remark = input.remark.trim();
    if (!remark) {
    throw new Error("Remark is required");
    }

    const now = new Date();
    const todayKey = getEtDateKey(now);
    const dateKey = input.dateKey ? assertDateKey(input.dateKey) : todayKey;
    const isPastDate = dateKey < todayKey;
    if (isPastDate && !isAttendanceAdminWriteRole(user.role)) {
    throw new Error("Only admin or operations can update past attendance");
    }

    const { databases } = await createAdminClient();
    const [absentUserDoc, delegateUserDoc] = await Promise.all([
            databases.getDocument(DATABASE_ID, COLLECTIONS.USERS, input.absentUserId) as Promise<unknown>,
            input.delegateUserId
              ? (databases.getDocument(DATABASE_ID, COLLECTIONS.USERS, input.delegateUserId) as Promise<unknown>)
              : Promise.resolve(null),
          ]);
    const absentUser = absentUserDoc as User;
    const delegateUser = (delegateUserDoc as User | null) ?? null;
    if (absentUser.role === "agent" || absentUser.role === "lead_generation") {
    const teamLeadId = typeof absentUser.teamLeadId === "string" ? absentUser.teamLeadId : "";
    if (!teamLeadId) {
      throw new Error("User is missing Team Lead");
    }

    if (user.role === "team_lead") {
      if (teamLeadId !== user.$id) {
        const teamLeadAttendance = await getAttendanceDoc(databases, {
          dateKey,
          userId: teamLeadId,
        });
        if (teamLeadAttendance?.delegateUserId !== user.$id) {
          throw new Error("You can only assign for agents in your team");
        }
      }
    }

    if (
      delegateUser &&
      (delegateUser.role !== "agent" && delegateUser.role !== "lead_generation" || delegateUser.teamLeadId !== teamLeadId)
    ) {
      throw new Error("Delegate must be an agent or lead generation in the same team");
    }

    const updated = await upsertAttendanceDoc(databases, {
      dateKey,
      userId: absentUser.$id,
      teamLeadId,
      patch: {
        delegateUserId: delegateUser?.$id ?? null,
        assignedById: delegateUser ? user.$id : null,
        assignedAt: delegateUser ? now.toISOString() : null,
        adminEscalatedAt: null,
      },
    });

    if (delegateUser) {
      const accounts = await getActiveLinkedinAccountsForUser(databases, absentUser.$id);
      await createNotificationRecord(databases, {
        recipientId: delegateUser.$id,
        type: "ATTENDANCE_ASSIGNED",
        title: `Assigned: cover ${absentUser.name}`,
        body: `You are assigned to use ${absentUser.name}'s Linkedin IDs today. Linkedin IDs: ${formatLinkedinAccountsForNotification(accounts)}`,
        targetType: "attendance",
        targetId: absentUser.$id,
      });
    }

    await logAuditAction(databases, {
      action: "ATTENDANCE_ASSIGN_DELEGATE",
      actorId: user.$id,
      actorName: user.name,
      targetType: "attendance",
      targetId: absentUser.$id,
      metadata: {
        dateKey,
        absentUserId: absentUser.$id,
        absentUserName: absentUser.name,
        absentUserRole: absentUser.role,
        teamLeadId,
        delegateUserId: delegateUser?.$id ?? null,
        delegateUserName: delegateUser?.name ?? null,
        remark,
      },
    });

    return updated;
    }

    if (absentUser.role === "team_lead") {
    if (!isAttendanceAdminWriteRole(user.role)) {
      throw new Error("Unauthorized");
    }

    if (delegateUser && delegateUser.role !== "team_lead") {
      throw new Error("Delegate must be a Team Lead");
    }

    const updated = await upsertAttendanceDoc(databases, {
      dateKey,
      userId: absentUser.$id,
      teamLeadId: absentUser.$id,
      patch: {
        delegateUserId: delegateUser?.$id ?? null,
        assignedById: delegateUser ? user.$id : null,
        assignedAt: delegateUser ? now.toISOString() : null,
        adminEscalatedAt: null,
      },
    });

    if (delegateUser) {
      await createNotificationRecord(databases, {
        recipientId: delegateUser.$id,
        type: "ATTENDANCE_TL_ASSIGNED",
        title: `Assigned: cover TL ${absentUser.name}`,
        body: `You are assigned to cover Team Lead duties for ${absentUser.name} today.`,
        targetType: "attendance",
        targetId: absentUser.$id,
      });
    }

    await logAuditAction(databases, {
      action: "ATTENDANCE_ASSIGN_TL_DELEGATE",
      actorId: user.$id,
      actorName: user.name,
      targetType: "attendance",
      targetId: absentUser.$id,
      metadata: {
        dateKey,
        absentUserId: absentUser.$id,
        absentUserName: absentUser.name,
        absentUserRole: absentUser.role,
        delegateUserId: delegateUser?.$id ?? null,
        delegateUserName: delegateUser?.name ?? null,
        remark,
      },
    });

    return updated;
    }

    throw new Error("Unsupported user role");
}
