"use server";
import { ID, Permission, Query, Role } from "node-appwrite";
import { createAdminClient } from "@/lib/server/appwrite";
import { assertAuthenticatedUserId, getAuthenticatedUserDoc } from "@/lib/server/current-user";
import { COLLECTIONS, DATABASE_ID } from "@/lib/constants/appwrite";
import type { AttendanceRecord, Department, LinkedinAccount, User } from "@/lib/types";
import { createNotificationRecord, createNotificationsForRecipients } from "@/lib/server/notifications";
import { getEtDateKey, isAttendanceAdminLikeReadRole, isAttendanceAdminWriteRole, normalizeDepartment, matchesDepartmentScope, getEtHour, assertDateKey, dateKeyToUtcDate, utcDateToDateKey, addDaysUtc, buildInclusiveDateKeys, getIsoWeekStartDateKey, getMonthStartDateKey, getMonthEndDateKey, logAuditAction, getAttendanceDoc, upsertAttendanceDoc, getActiveLinkedinAccountsForUser, getActiveLinkedinAccountsForUsers, formatLinkedinAccountsForNotification } from "./shared";


export async function markAttendancePresenceAction(input: {
      currentUserId: string;
      path?: string | null;
    }) {
    await assertAuthenticatedUserId(input.currentUserId);
    const user = await getAuthenticatedUserDoc();
    if (user.role !== "agent" && user.role !== "team_lead" && user.role !== "lead_generation") {
    return { dateKey: getEtDateKey(new Date()), marked: false };
    }

    const now = new Date();
    const dateKey = getEtDateKey(now);
    const hour = getEtHour(now);
    const shouldAutoMarkPresent = hour >= 9 && hour < 10;
    let marked = false;
    const appwriteEndpointRaw = process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT ?? "";
    const appwriteEndpoint = appwriteEndpointRaw.endsWith("/")
            ? appwriteEndpointRaw.slice(0, -1)
            : appwriteEndpointRaw;
    const projectId = process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID ?? "";
    const apiKey = process.env.APPWRITE_API_KEY ?? "";
    const { databases } = await createAdminClient();
    const existing = await getAttendanceDoc(databases, {
            dateKey,
            userId: user.$id,
          });
    const patch: Partial<Omit<AttendanceRecord, "$id">> = {
            outlookConnected: false,
            lastSeenAt: now.toISOString(),
            lastSeenPath: input.path ?? null,
          };
    let hasActivePresence = false;
    if (shouldAutoMarkPresent && appwriteEndpoint && projectId && apiKey) {
    const presenceResponse = await fetch(
      `${appwriteEndpoint}/presences/${encodeURIComponent(user.$id)}`,
      {
        method: "GET",
        headers: {
          "X-Appwrite-Project": projectId,
          "X-Appwrite-Key": apiKey,
        },
      },
    ).catch(() => null);

    if (presenceResponse?.ok) {
      const presence = (await presenceResponse.json().catch(() => null)) as null | {
        status?: unknown;
      };
      hasActivePresence = presence?.status === "online" || Boolean(presence);
    }
    }

    if (shouldAutoMarkPresent && hasActivePresence && existing?.present !== true) {
    marked = true;
    patch.present = true;
    patch.presentAt = now.toISOString();
    patch.absentNotifiedAt = null;
    patch.adminEscalatedAt = null;
    patch.presentWithDelegateFlag = false;
    }

    await upsertAttendanceDoc(databases, {
    dateKey,
    userId: user.$id,
    teamLeadId: user.role === "team_lead" ? user.$id : (user.teamLeadId ?? null),
    patch,
    });
    return { dateKey, marked };
}

export async function getMyAttendanceToggleStateAction(input: {
      currentUserId: string;
    }) {
    await assertAuthenticatedUserId(input.currentUserId);
    const user = await getAuthenticatedUserDoc();
    if (user.role !== "agent" && user.role !== "team_lead" && user.role !== "lead_generation") {
    return {
      dateKey: getEtDateKey(new Date()),
      present: false,
      canMarkPresent: false,
      windowStatus: "closed" as const,
    };
    }

    const now = new Date();
    const dateKey = getEtDateKey(now);
    const hour = getEtHour(now);
    const windowStatus = hour < 9 ? "before" : hour < 10 ? "open" : "closed";
    const { databases } = await createAdminClient();
    const existing = await getAttendanceDoc(databases, { dateKey, userId: user.$id });
    const present = existing?.present === true;
    return {
    dateKey,
    present,
    canMarkPresent: windowStatus === "open" && !present,
    windowStatus,
    };
}

export async function markMyselfPresentAction(input: { currentUserId: string }) {
    await assertAuthenticatedUserId(input.currentUserId);
    const user = await getAuthenticatedUserDoc();
    if (user.role !== "agent" && user.role !== "team_lead" && user.role !== "lead_generation") {
    throw new Error("Unauthorized");
    }

    const now = new Date();
    const dateKey = getEtDateKey(now);
    const hour = getEtHour(now);
    if (hour < 9 || hour >= 10) {
    throw new Error("You can only mark present between 9-10 ET");
    }

    const { databases } = await createAdminClient();
    const existing = await getAttendanceDoc(databases, { dateKey, userId: user.$id });
    if (existing?.present === true) {
    return { dateKey, present: true };
    }

    const updated = await upsertAttendanceDoc(databases, {
            dateKey,
            userId: user.$id,
            teamLeadId: user.role === "team_lead" ? user.$id : (user.teamLeadId ?? null),
            patch: {
              present: true,
              presentAt: now.toISOString(),
              absentNotifiedAt: null,
              adminEscalatedAt: null,
              presentWithDelegateFlag: false,
            },
          });
    await logAuditAction(databases, {
    action: "ATTENDANCE_SELF_MARK_PRESENT",
    actorId: user.$id,
    actorName: user.name,
    targetType: "attendance",
    targetId: user.$id,
    metadata: { dateKey },
    });
    return { dateKey, present: updated.present === true };
}

export async function markAttendancePresentByTeamLeadAction(input: {
      currentUserId: string;
      userId: string;
      dateKey?: string;
      remark: string;
    }) {
    await assertAuthenticatedUserId(input.currentUserId);
    const actor = await getAuthenticatedUserDoc();
    if (actor.role !== "team_lead" && !isAttendanceAdminWriteRole(actor.role)) {
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
    if (isPastDate && !isAttendanceAdminWriteRole(actor.role)) {
    throw new Error("Only admin or operations can update past attendance");
    }

    const { databases } = await createAdminClient();
    const userDoc = (await databases.getDocument(
            DATABASE_ID,
            COLLECTIONS.USERS,
            input.userId,
          )) as unknown as User;
    if (userDoc.role !== "agent" && userDoc.role !== "team_lead" && userDoc.role !== "lead_generation") {
    throw new Error("Only agents, team leads, and lead generation can be marked present");
    }

    if (actor.role === "team_lead") {
    if (userDoc.role === "agent" || userDoc.role === "lead_generation") {
      const teamLeadId = typeof userDoc.teamLeadId === "string" ? userDoc.teamLeadId : "";
      if (!teamLeadId) {
        throw new Error("Agent is missing Team Lead");
      }
      if (teamLeadId !== actor.$id) {
        const teamLeadAttendance = await getAttendanceDoc(databases, {
          dateKey,
          userId: teamLeadId,
        });
        if (teamLeadAttendance?.delegateUserId !== actor.$id) {
          throw new Error("You can only mark present for your team");
        }
      }
    } else {
      throw new Error("Unauthorized");
    }
    }

    const teamLeadIdForRecord = userDoc.role === "team_lead" ? userDoc.$id : (userDoc.teamLeadId ?? null);
    const existingAttendance = await getAttendanceDoc(databases, {
            dateKey,
            userId: userDoc.$id,
          });
    const existingDelegateUserId = existingAttendance && typeof existingAttendance.delegateUserId === "string"
              ? existingAttendance.delegateUserId
              : null;
    const shouldFlagPresentWithDelegate = actor.role === "team_lead" &&
            userDoc.role === "agent" &&
            Boolean(existingDelegateUserId);
    const updated = await upsertAttendanceDoc(databases, {
            dateKey,
            userId: userDoc.$id,
            teamLeadId: teamLeadIdForRecord,
            patch: {
              present: true,
              presentAt: now.toISOString(),
              absentNotifiedAt: null,
              adminEscalatedAt: null,
              presentWithDelegateFlag: shouldFlagPresentWithDelegate,
              ...(isAttendanceAdminWriteRole(actor.role)
                ? { delegateUserId: null, assignedById: null, assignedAt: null }
                : {}),
            },
          });
    await logAuditAction(databases, {
    action: "ATTENDANCE_MARK_PRESENT",
    actorId: actor.$id,
    actorName: actor.name,
    targetType: "attendance",
    targetId: userDoc.$id,
    metadata: {
      dateKey,
      userId: userDoc.$id,
      userName: userDoc.name,
      userRole: userDoc.role,
      existingDelegateUserId,
      presentWithDelegateFlag: shouldFlagPresentWithDelegate,
      remark,
    },
    });
    return updated;
}
