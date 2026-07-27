import { ID, Permission, Query, Role } from "node-appwrite";
import { createAdminClient } from "@/lib/server/appwrite";
import { assertAuthenticatedUserId, getAuthenticatedUserDoc } from "@/lib/server/current-user";
import { COLLECTIONS, DATABASE_ID } from "@/lib/constants/appwrite";
import type { AttendanceRecord, Department, LinkedinAccount, User } from "@/lib/types";
import { createNotificationRecord, createNotificationsForRecipients } from "@/lib/server/notifications";

export function getEtDateKey(now: Date) {
    const dateKey = new Intl.DateTimeFormat("en-CA", {
            timeZone: "America/New_York",
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
          }).format(now);
    return dateKey;
}

export function isAttendanceAdminLikeReadRole(role: User["role"]) {
    return role === "admin" || role === "developer" || role === "monitor" || role === "operations";
}

export function isAttendanceAdminWriteRole(role: User["role"]) {
    return role === "admin" || role === "operations";
}

export function normalizeDepartment(value: unknown): Department {
    return value === "resume" ? "resume" : "sales";
}

export function matchesDepartmentScope(user: User, departmentScope?: Department | "all") {
    if (!departmentScope || departmentScope === "all") {
    return true;
    }

    return normalizeDepartment(user.department) === departmentScope;
}

export function getEtHour(now: Date) {
    const hourText = new Intl.DateTimeFormat("en-US", {
            timeZone: "America/New_York",
            hour: "2-digit",
            hour12: false,
          }).format(now);
    const hour = Number.parseInt(hourText, 10);
    return Number.isFinite(hour) ? hour : now.getUTCHours();
}

export function assertDateKey(value: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error("Invalid date");
    }

    return value;
}

export function dateKeyToUtcDate(dateKey: string) {
    const [yearText, monthText, dayText] = dateKey.split("-");
    const year = Number(yearText);
    const month = Number(monthText);
    const day = Number(dayText);
    if (!year || !month || !day) {
    throw new Error("Invalid date");
    }

    return new Date(Date.UTC(year, month - 1, day, 12, 0, 0, 0));
}

export function utcDateToDateKey(date: Date) {
    return date.toISOString().slice(0, 10);
}

export function addDaysUtc(date: Date, days: number) {
    return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

export function buildInclusiveDateKeys(startKey: string, endKey: string) {
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

export function getIsoWeekStartDateKey(referenceKey: string) {
    const ref = dateKeyToUtcDate(referenceKey);
    const day = ref.getUTCDay();
    const offset = day === 0 ? 6 : day - 1;
    return utcDateToDateKey(addDaysUtc(ref, -offset));
}

export function getMonthStartDateKey(referenceKey: string) {
    const ref = dateKeyToUtcDate(referenceKey);
    const year = ref.getUTCFullYear();
    const month = ref.getUTCMonth();
    return utcDateToDateKey(new Date(Date.UTC(year, month, 1, 12, 0, 0, 0)));
}

export function getMonthEndDateKey(referenceKey: string) {
    const ref = dateKeyToUtcDate(referenceKey);
    const year = ref.getUTCFullYear();
    const month = ref.getUTCMonth();
    return utcDateToDateKey(new Date(Date.UTC(year, month + 1, 0, 12, 0, 0, 0)));
}

export async function logAuditAction(databases: Awaited<ReturnType<typeof createAdminClient>>["databases"], input: {
    action: string;
    actorId: string;
    actorName: string;
    targetType: string;
    targetId?: string | null;
    metadata?: Record<string, unknown>;
    }) {
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

export async function getAttendanceDoc(databases: Awaited<ReturnType<typeof createAdminClient>>["databases"], input: {
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

export async function upsertAttendanceDoc(databases: Awaited<ReturnType<typeof createAdminClient>>["databases"], input: {
      dateKey: string;
      userId: string;
      teamLeadId: string | null;
      patch: Partial<Omit<AttendanceRecord, "$id">>;
      existing?: AttendanceRecord | null;
    }) {
    const existing = input.existing === undefined
            ? await getAttendanceDoc(databases, {
                dateKey: input.dateKey,
                userId: input.userId,
              })
            : input.existing;
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

export async function getActiveLinkedinAccountsForUser(databases: Awaited<ReturnType<typeof createAdminClient>>["databases"], userId: string) {
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

export async function getActiveLinkedinAccountsForUsers(databases: Awaited<ReturnType<typeof createAdminClient>>["databases"], userIds: string[]) {
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

export function formatLinkedinAccountsForNotification(accounts: LinkedinAccount[]) {
    if (accounts.length === 0) {
    return "No Linkedin IDs found.";
    }

    return accounts
    .map((a) => `${a.company}: ${a.idName} (${a.accountType})`)
    .join(", ");
}
