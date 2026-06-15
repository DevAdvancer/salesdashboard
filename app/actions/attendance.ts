"use server";

import { ID, Permission, Query, Role } from "node-appwrite";
import { createAdminClient } from "@/lib/server/appwrite";
import {
  assertAuthenticatedUserId,
  getAuthenticatedUserDoc,
} from "@/lib/server/current-user";
import { COLLECTIONS, DATABASE_ID } from "@/lib/constants/appwrite";
import type { AttendanceRecord, LinkedinAccount, User } from "@/lib/types";
import {
  createNotificationRecord,
  createNotificationsForRecipients,
} from "@/lib/server/notifications";

function getEtDateKey(now: Date) {
  const dateKey = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  return dateKey;
}

function isAttendanceAdminLikeReadRole(role: User["role"]) {
  return role === "admin" || role === "developer" || role === "monitor" || role === "operations";
}

function isAttendanceAdminWriteRole(role: User["role"]) {
  return role === "admin" || role === "operations";
}

function getEtHour(now: Date) {
  const hourText = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit",
    hour12: false,
  }).format(now);
  const hour = Number.parseInt(hourText, 10);
  return Number.isFinite(hour) ? hour : now.getUTCHours();
}

function assertDateKey(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error("Invalid date");
  }
  return value;
}

function dateKeyToUtcDate(dateKey: string) {
  const [yearText, monthText, dayText] = dateKey.split("-");
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  if (!year || !month || !day) {
    throw new Error("Invalid date");
  }
  return new Date(Date.UTC(year, month - 1, day, 12, 0, 0, 0));
}

function utcDateToDateKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

function addDaysUtc(date: Date, days: number) {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

function buildInclusiveDateKeys(startKey: string, endKey: string) {
  const start = dateKeyToUtcDate(startKey);
  const end = dateKeyToUtcDate(endKey);
  const keys: string[] = [];
  let cursor = start;
  while (cursor.getTime() <= end.getTime()) {
    keys.push(utcDateToDateKey(cursor));
    cursor = addDaysUtc(cursor, 1);
  }
  return keys;
}

function getIsoWeekStartDateKey(referenceKey: string) {
  const ref = dateKeyToUtcDate(referenceKey);
  const day = ref.getUTCDay();
  const offset = day === 0 ? 6 : day - 1;
  return utcDateToDateKey(addDaysUtc(ref, -offset));
}

function getMonthStartDateKey(referenceKey: string) {
  const ref = dateKeyToUtcDate(referenceKey);
  const year = ref.getUTCFullYear();
  const month = ref.getUTCMonth();
  return utcDateToDateKey(new Date(Date.UTC(year, month, 1, 12, 0, 0, 0)));
}

function getMonthEndDateKey(referenceKey: string) {
  const ref = dateKeyToUtcDate(referenceKey);
  const year = ref.getUTCFullYear();
  const month = ref.getUTCMonth();
  return utcDateToDateKey(new Date(Date.UTC(year, month + 1, 0, 12, 0, 0, 0)));
}

async function logAuditAction(
  databases: Awaited<ReturnType<typeof createAdminClient>>["databases"],
  input: {
    action: string;
    actorId: string;
    actorName: string;
    targetType: string;
    targetId?: string | null;
    metadata?: Record<string, unknown>;
  },
) {
  try {
    await databases.createDocument(DATABASE_ID, COLLECTIONS.AUDIT_LOGS, ID.unique(), {
      action: input.action,
      actorId: input.actorId,
      actorName: input.actorName,
      targetId: input.targetId ?? null,
      targetType: input.targetType,
      metadata: input.metadata ? JSON.stringify(input.metadata) : null,
      performedAt: new Date().toISOString(),
    });
  } catch {
    return;
  }
}

async function getAttendanceDoc(databases: Awaited<ReturnType<typeof createAdminClient>>["databases"], input: {
  dateKey: string;
  userId: string;
}) {
  const existing = await databases.listDocuments(DATABASE_ID, COLLECTIONS.ATTENDANCE, [
    Query.equal("dateKey", input.dateKey),
    Query.equal("userId", input.userId),
    Query.limit(1),
  ]);

  const doc = existing.documents[0];
  return (doc ?? null) as unknown as AttendanceRecord | null;
}

async function upsertAttendanceDoc(databases: Awaited<ReturnType<typeof createAdminClient>>["databases"], input: {
  dateKey: string;
  userId: string;
  teamLeadId: string | null;
  patch: Partial<Omit<AttendanceRecord, "$id">>;
}) {
  const existing = await getAttendanceDoc(databases, {
    dateKey: input.dateKey,
    userId: input.userId,
  });

  const permissions = [
    Permission.read(Role.user(input.userId)),
    Permission.update(Role.user(input.userId)),
    Permission.read(Role.label("admin")),
    Permission.update(Role.label("admin")),
  ];

  if (input.teamLeadId) {
    permissions.push(Permission.read(Role.user(input.teamLeadId)));
    permissions.push(Permission.update(Role.user(input.teamLeadId)));
  }

  if (existing) {
    const updated = await databases.updateDocument(
      DATABASE_ID,
      COLLECTIONS.ATTENDANCE,
      existing.$id,
      input.patch,
    );
    return updated as unknown as AttendanceRecord;
  }

  const created = await databases.createDocument(
    DATABASE_ID,
    COLLECTIONS.ATTENDANCE,
    ID.unique(),
    {
      dateKey: input.dateKey,
      userId: input.userId,
      teamLeadId: input.teamLeadId,
      present: false,
      presentAt: null,
      outlookConnected: false,
      lastSeenAt: null,
      lastSeenPath: null,
      absentNotifiedAt: null,
      adminEscalatedAt: null,
      delegateUserId: null,
      assignedById: null,
      assignedAt: null,
      presentWithDelegateFlag: false,
      ...input.patch,
    },
    permissions,
  );

  return created as unknown as AttendanceRecord;
}

async function getActiveLinkedinAccountsForUser(databases: Awaited<ReturnType<typeof createAdminClient>>["databases"], userId: string) {
  const accounts = await databases.listDocuments(DATABASE_ID, COLLECTIONS.LINKEDIN_ACCOUNTS, [
    Query.equal("assignedUserId", userId),
    Query.equal("isActive", true),
    Query.limit(200),
  ]);
  const docs = accounts.documents as unknown as LinkedinAccount[];
  return docs.sort((a, b) => {
    const cmpType = (a.accountType || "").localeCompare(b.accountType || "");
    if (cmpType !== 0) return cmpType;
    return (a.idName || "").localeCompare(b.idName || "");
  });
}

async function getActiveLinkedinAccountsForUsers(
  databases: Awaited<ReturnType<typeof createAdminClient>>["databases"],
  userIds: string[],
) {
  const map = new Map<string, LinkedinAccount[]>();
  if (userIds.length === 0) return map;

  const chunkSize = 100;
  const limit = 200;
  for (let i = 0; i < userIds.length; i += chunkSize) {
    const chunk = userIds.slice(i, i + chunkSize);
    let offset = 0;
    while (true) {
      const response = await databases.listDocuments(DATABASE_ID, COLLECTIONS.LINKEDIN_ACCOUNTS, [
        Query.equal("assignedUserId", chunk),
        Query.equal("isActive", true),
        Query.limit(limit),
        Query.offset(offset),
      ]);

      const docs = response.documents as unknown as LinkedinAccount[];
      for (const doc of docs) {
        const assignedUserId = String((doc as unknown as { assignedUserId?: unknown }).assignedUserId ?? "");
        if (!assignedUserId) continue;
        const existing = map.get(assignedUserId) ?? [];
        existing.push(doc);
        map.set(assignedUserId, existing);
      }

      if (docs.length < limit) break;
      offset += limit;
      if (offset >= 5000) break;
    }
  }

  for (const list of map.values()) {
    list.sort((a, b) => {
      const cmpType = (a.accountType || "").localeCompare(b.accountType || "");
      if (cmpType !== 0) return cmpType;
      return (a.idName || "").localeCompare(b.idName || "");
    });
  }

  return map;
}

function formatLinkedinAccountsForNotification(accounts: LinkedinAccount[]) {
  if (accounts.length === 0) {
    return "No Linkedin IDs found.";
  }

  return accounts
    .map((a) => `${a.company}: ${a.idName} (${a.accountType})`)
    .join(", ");
}

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

  const teamLeadIdForRecord =
    userDoc.role === "team_lead" ? userDoc.$id : (userDoc.teamLeadId ?? null);

  const existingAttendance = await getAttendanceDoc(databases, {
    dateKey,
    userId: userDoc.$id,
  });
  const existingDelegateUserId =
    existingAttendance && typeof existingAttendance.delegateUserId === "string"
      ? existingAttendance.delegateUserId
      : null;
  const shouldFlagPresentWithDelegate =
    actor.role === "team_lead" &&
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
        present: false,
        absentNotifiedAt: shouldNotify ? now.toISOString() : (existing?.absentNotifiedAt ?? null),
      },
    });
    attendanceByUserId.set(agent.$id, updated);

    if (!shouldNotify) continue;
    notifyAgentIds.push(agent.$id);
    notifyAgentNameById.set(agent.$id, agent.name);
  }

  const accountsByUserId = await getActiveLinkedinAccountsForUsers(databases, notifyAgentIds);
  await Promise.all(
    notifyAgentIds.map(async (agentId) => {
      const name = notifyAgentNameById.get(agentId) ?? "Agent";
      const accounts = accountsByUserId.get(agentId) ?? [];
      await createNotificationRecord(databases, {
        recipientId: recipientTeamLeadId,
        type: "ATTENDANCE_ABSENT",
        title: `Absent: ${name}`,
        body: `No in-app presence detected in 9-10 ET. Linkedin IDs: ${formatLinkedinAccountsForNotification(accounts)}`,
        targetType: "attendance",
        targetId: agentId,
      });
    }),
  );

  return { dateKey, notified: notifyAgentIds.length };
}

export async function listMyTeamAttendanceAction(input: {
  currentUserId: string;
  teamLeadId?: string;
  dateKey?: string;
}) {
  await assertAuthenticatedUserId(input.currentUserId);
  const user = await getAuthenticatedUserDoc();
  const effectiveTeamLeadId =
    user.role === "team_lead"
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
  const teamLeadDelegateUser =
    teamLeadDelegateUserId ? ((await databases.getDocument(
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

export async function getAttendanceFlagSummaryAction(input: {
  currentUserId: string;
  teamLeadId?: string;
  referenceDateKey?: string;
}) {
  await assertAuthenticatedUserId(input.currentUserId);
  const user = await getAuthenticatedUserDoc();
  const effectiveTeamLeadId =
    user.role === "team_lead"
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

export async function listTeamLeadsAttendanceForAdminAction(input: {
  currentUserId: string;
  dateKey?: string;
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
    .sort((a, b) => (a.name || "").localeCompare(b.name || ""));

  const teamLeadIds = teamLeads.map((t) => t.$id);
  const attendanceResponse =
    teamLeadIds.length > 0
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

export async function checkAndNotifyAdminAttendanceEscalationsAction(input: {
  currentUserId: string;
}) {
  await assertAuthenticatedUserId(input.currentUserId);
  const user = await getAuthenticatedUserDoc();
  if (!isAttendanceAdminWriteRole(user.role)) {
    return { dateKey: getEtDateKey(new Date()), teamLeadAbsentNotified: 0, agentAbsentNotified: 0, agentEscalated: 0 };
  }

  const now = new Date();
  const dateKey = getEtDateKey(now);
  const hour = getEtHour(now);
  if (hour < 10) {
    return { dateKey, teamLeadAbsentNotified: 0, agentAbsentNotified: 0, agentEscalated: 0 };
  }

  const { databases } = await createAdminClient();

  const adminUsersResponse = await databases.listDocuments(DATABASE_ID, COLLECTIONS.USERS, [
    Query.equal("role", ["admin", "operations"]),
    Query.limit(2000),
  ]);
  const adminUsers = (adminUsersResponse.documents as unknown as User[]).filter(
    (adminUser) => (adminUser as unknown as { isActive?: unknown }).isActive !== false,
  );
  const adminRecipientIds = adminUsers.map((a) => a.$id);

  const teamLeadsResponse = await databases.listDocuments(DATABASE_ID, COLLECTIONS.USERS, [
    Query.equal("role", "team_lead"),
    Query.limit(2000),
  ]);
  const teamLeads = (teamLeadsResponse.documents as unknown as User[]).filter(
    (teamLead) => (teamLead as unknown as { isActive?: unknown }).isActive !== false,
  );

  let teamLeadAbsentNotified = 0;
  let agentAbsentNotified = 0;
  let agentEscalated = 0;

  const teamLeadIds = teamLeads.map((t) => t.$id);
  const teamLeadAttendanceResponse =
    teamLeadIds.length > 0
      ? await databases.listDocuments(DATABASE_ID, COLLECTIONS.ATTENDANCE, [
          Query.equal("dateKey", dateKey),
          Query.equal("userId", teamLeadIds),
          Query.limit(2000),
        ])
      : { documents: [] as unknown[] };
  const teamLeadAttendanceDocs =
    teamLeadAttendanceResponse.documents as unknown as AttendanceRecord[];
  const teamLeadAttendanceByUserId = new Map<string, AttendanceRecord>();
  teamLeadAttendanceDocs.forEach((doc) => teamLeadAttendanceByUserId.set(doc.userId, doc));

  for (const teamLead of teamLeads) {
    const teamLeadAttendance = teamLeadAttendanceByUserId.get(teamLead.$id) ?? null;
    const teamLeadIsPresent = teamLeadAttendance?.present === true;
    if (!teamLeadIsPresent && !teamLeadAttendance?.absentNotifiedAt) {
      const updatedTl = await upsertAttendanceDoc(databases, {
        dateKey,
        userId: teamLead.$id,
        teamLeadId: teamLead.$id,
        patch: {
          present: false,
          absentNotifiedAt: now.toISOString(),
        },
      });
      teamLeadAttendanceByUserId.set(teamLead.$id, updatedTl);
      await createNotificationsForRecipients(databases, adminRecipientIds, {
        type: "ATTENDANCE_TL_ABSENT",
        title: `TL Absent: ${teamLead.name}`,
        body: `No in-app presence detected in 9-10 ET for Team Lead ${teamLead.name}.`,
        targetType: "attendance",
        targetId: teamLead.$id,
      });
      teamLeadAbsentNotified += 1;
    }

    const recipientTeamLeadId = teamLeadAttendance?.delegateUserId ?? teamLead.$id;

    const agentsResponse = await databases.listDocuments(DATABASE_ID, COLLECTIONS.USERS, [
      Query.equal("role", ["agent", "lead_generation"]),
      Query.equal("teamLeadId", teamLead.$id),
      Query.limit(2000),
    ]);
    const agents = (agentsResponse.documents as unknown as User[]).filter(
      (agent) => (agent as unknown as { isActive?: unknown }).isActive !== false,
    );
    if (agents.length === 0) {
      continue;
    }

    const attendanceResponse = await databases.listDocuments(DATABASE_ID, COLLECTIONS.ATTENDANCE, [
      Query.equal("dateKey", dateKey),
      Query.equal("teamLeadId", teamLead.$id),
      Query.limit(2000),
    ]);
    const attendanceDocs = attendanceResponse.documents as unknown as AttendanceRecord[];
    const attendanceByUserId = new Map<string, AttendanceRecord>();
    attendanceDocs.forEach((doc) => attendanceByUserId.set(doc.userId, doc));

    const notifyAgentIds: string[] = [];
    const notifyAgentNameById = new Map<string, string>();
    const escalateAgentIds = new Set<string>();

    for (const agent of agents) {
      const existing = attendanceByUserId.get(agent.$id) ?? null;
      const isPresent = existing?.present === true;
      if (isPresent) {
        continue;
      }

      const shouldNotifyTeamLead = !existing || !existing.absentNotifiedAt;
      const updated = await upsertAttendanceDoc(databases, {
        dateKey,
        userId: agent.$id,
        teamLeadId: teamLead.$id,
        patch: {
          present: false,
          absentNotifiedAt: shouldNotifyTeamLead ? now.toISOString() : (existing?.absentNotifiedAt ?? null),
          adminEscalatedAt: existing?.adminEscalatedAt ?? null,
        },
      });
      attendanceByUserId.set(agent.$id, updated);

      if (shouldNotifyTeamLead) {
        notifyAgentIds.push(agent.$id);
        notifyAgentNameById.set(agent.$id, agent.name);
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
      escalateAgentIds.add(agent.$id);
    }

    const accountLookupIds = Array.from(new Set([...notifyAgentIds, ...Array.from(escalateAgentIds)]));
    const accountsByUserId = await getActiveLinkedinAccountsForUsers(databases, accountLookupIds);

    await Promise.all(
      notifyAgentIds.map(async (agentId) => {
        const name = notifyAgentNameById.get(agentId) ?? "Agent";
        const accounts = accountsByUserId.get(agentId) ?? [];
        await createNotificationRecord(databases, {
          recipientId: recipientTeamLeadId,
          type: "ATTENDANCE_ABSENT",
          title: `Absent: ${name}`,
          body: `No in-app presence detected in 9-10 ET. Linkedin IDs: ${formatLinkedinAccountsForNotification(accounts)}`,
          targetType: "attendance",
          targetId: agentId,
        });
      }),
    );

    for (const agentId of escalateAgentIds) {
      const agent = agents.find((a) => a.$id === agentId);
      const name = agent?.name ?? "Agent";
      const accounts = accountsByUserId.get(agentId) ?? [];
      await upsertAttendanceDoc(databases, {
        dateKey,
        userId: agentId,
        teamLeadId: teamLead.$id,
        patch: {
          adminEscalatedAt: now.toISOString(),
        },
      });
      await createNotificationsForRecipients(databases, adminRecipientIds, {
        type: "ATTENDANCE_UNASSIGNED",
        title: `Unassigned absence: ${name}`,
        body: `Agent ${name} is absent (Team Lead: ${teamLead.name}) and no delegate was assigned within 30 minutes. Linkedin IDs: ${formatLinkedinAccountsForNotification(accounts)}`,
        targetType: "attendance",
        targetId: agentId,
      });
      agentEscalated += 1;
    }
  }

  return { dateKey, teamLeadAbsentNotified, agentAbsentNotified, agentEscalated };
}

export async function getAttendanceReportAction(input: {
  currentUserId: string;
  startDateKey?: string;
  endDateKey?: string;
  teamLeadId?: string; // for admin/monitor to filter by specific team
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

  // Always fetch the full sorted list of active team leads (for the filter dropdown)
  let allTeamLeadOptions: Array<{ userId: string; userName: string }> = [];
  let teamLeads: User[] = [];

  if (isAdminLike) {
    const teamLeadsResponse = await databases.listDocuments(DATABASE_ID, COLLECTIONS.USERS, [
      Query.equal("role", "team_lead"),
      Query.limit(2000),
    ]);
    const allTLs = (teamLeadsResponse.documents as unknown as User[])
      .filter((tl) => (tl as unknown as { isActive?: unknown }).isActive !== false)
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

  // Build report per team lead
  const teams = await Promise.all(
    teamLeads.map(async (tl) => {
      // TL's own attendance records
      const tlAttendanceResponse = await databases.listDocuments(DATABASE_ID, COLLECTIONS.ATTENDANCE, [
        Query.equal("userId", tl.$id),
        Query.greaterThanEqual("dateKey", startDateKey),
        Query.lessThanEqual("dateKey", endDateKey),
        Query.limit(100),
      ]);
      const tlAttRecords = tlAttendanceResponse.documents as unknown as AttendanceRecord[];
      const latestTlAtt = tlAttRecords.length > 0 ? tlAttRecords.sort((a,b) => b.dateKey.localeCompare(a.dateKey))[0] : null;
      
      const tlDelegateUserId = latestTlAtt?.delegateUserId ?? null;
      let tlDelegateName: string | null = null;
      if (tlDelegateUserId) {
        try {
          const dlDoc = (await databases.getDocument(
            DATABASE_ID,
            COLLECTIONS.USERS,
            tlDelegateUserId,
          )) as unknown as User;
          tlDelegateName = dlDoc.name;
        } catch {
          // ignore
        }
      }

      // Agents in this team
      const agentsResponse = await databases.listDocuments(DATABASE_ID, COLLECTIONS.USERS, [
        Query.equal("role", ["agent", "lead_generation"]),
        Query.equal("teamLeadId", tl.$id),
        Query.limit(2000),
      ]);
      const agents = (agentsResponse.documents as unknown as User[])
        .filter((a) => (a as unknown as { isActive?: unknown }).isActive !== false)
        .sort((a, b) => (a.name || "").localeCompare(b.name || ""));

      // Attendance records for this team on the selected date range
      const attendanceResponse = await databases.listDocuments(DATABASE_ID, COLLECTIONS.ATTENDANCE, [
        Query.greaterThanEqual("dateKey", startDateKey),
        Query.lessThanEqual("dateKey", endDateKey),
        Query.equal("teamLeadId", tl.$id),
        Query.limit(2000),
      ]);
      const attendanceDocs = attendanceResponse.documents as unknown as AttendanceRecord[];
      const attendanceByUserId = new Map<string, AttendanceRecord[]>();
      attendanceDocs.forEach((doc) => {
        const existing = attendanceByUserId.get(doc.userId) || [];
        existing.push(doc);
        attendanceByUserId.set(doc.userId, existing);
      });

      // Collect all user IDs we need to resolve (delegates + assignedBy)
      const allDelegateIds = new Set<string>();
      attendanceDocs.forEach((doc) => {
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

      // LinkedIn accounts for all agents
      const accountsByUserId = await getActiveLinkedinAccountsForUsers(
        databases,
        agents.map((a) => a.$id),
      );

      const agentRows = agents.map((agent) => {
        const attRecords = attendanceByUserId.get(agent.$id) ?? [];
        const latestAtt = attRecords.length > 0 ? attRecords.sort((a,b) => b.dateKey.localeCompare(a.dateKey))[0] : null;
        const presentDays = attRecords.filter(r => r.present).length;
        
        const isRange = startDateKey !== endDateKey;

        // Aggregate delegates over the date range
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

        // Aggregate assignedBy over the date range
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
    }),
  );

  return { startDateKey, endDateKey, teams, allTeamLeadOptions };
}
