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

export function normalizeCompany(value: string) {
    return value.trim();
}

export function normalizeUrl(value: string) {
    return value.trim();
}

export function parseDateOnly(value: string) {
    const [year, month, day] = value.split("-").map((part) => Number(part));
    if (!year || !month || !day) return null;
    return { year, month, day };
}

export function toUtcDayStartIso(dateValue: string) {
    const parsed = parseDateOnly(dateValue);
    if (!parsed) throw new Error("Invalid date");
    return new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day, 0, 0, 0, 0)).toISOString();
}

export function toUtcDayEndIso(dateValue: string) {
    const parsed = parseDateOnly(dateValue);
    if (!parsed) throw new Error("Invalid date");
    return new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day, 23, 59, 59, 999)).toISOString();
}

export function daysBetweenUtc(startIso: string, endIso: string) {
    const start = new Date(startIso);
    const end = new Date(endIso);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return 0;
    const startUtcMidnight = Date.UTC(
            start.getUTCFullYear(),
            start.getUTCMonth(),
            start.getUTCDate(),
          );
    const endUtcMidnight = Date.UTC(
            end.getUTCFullYear(),
            end.getUTCMonth(),
            end.getUTCDate(),
          );
    const diffDays = Math.floor(
            (endUtcMidnight - startUtcMidnight) / (24 * 60 * 60 * 1000),
          );
    return Math.max(diffDays, 0);
}

export function assertDateIso(value: string) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
    throw new Error("Invalid date");
    }

    return date.toISOString();
}

export function normalizeLeadOutcomeStatus(value: unknown) {
    return typeof value === "string"
    ? value.trim().toLowerCase().replace(/\s+/g, "")
    : "";
}

export function getLeadOutcomeLabel(status: unknown) {
    const normalized = normalizeLeadOutcomeStatus(status);
    if (normalized === "backout" || normalized === "backedout") {
    return "Backed Out";
    }

    if (normalized === "notinterested") {
    return "Not Interested";
    }

    return null;
}

export async function getLinkedinRequestLeadSnapshot(databases: Awaited<ReturnType<typeof createAdminClient>>["databases"], leadId?: string | null) {
    if (!leadId) return null;
    try {
    const lead = await databases.getDocument(
      DATABASE_ID,
      COLLECTIONS.LEADS,
      leadId,
    ) as unknown as { status?: unknown; isClosed?: unknown };
    return {
      leadId,
      status: typeof lead.status === "string" ? lead.status : "",
      isClosed: Boolean(lead.isClosed),
    };
    } catch {
    return null;
    }
}

export async function getLinkedinRequestLeadOutcomeLabel(databases: Awaited<ReturnType<typeof createAdminClient>>["databases"], request: Pick<LinkedinRequest, "leadId">) {
    const lead = await getLinkedinRequestLeadSnapshot(databases, request.leadId);
    return getLeadOutcomeLabel(lead?.status);
}

export async function isBlockingLinkedinRequest(databases: Awaited<ReturnType<typeof createAdminClient>>["databases"], request: LinkedinRequest) {
    if ((request.isActive ?? true) === false) return false;
    if (request.status === "withdrawn") return false;
    if (request.status !== "accepted") return true;
    const outcomeLabel = await getLinkedinRequestLeadOutcomeLabel(databases, request);
    return !outcomeLabel;
}

export async function createGeneralChatMessage(databases: Awaited<ReturnType<typeof createAdminClient>>["databases"], input: {
    createdById: string;
    createdByName: string;
    body: string;
    }) {
    const body = input.body.trim();
    if (!body) return;
    await databases.createDocument(DATABASE_ID, COLLECTIONS.CHAT_MESSAGES, ID.unique(), {
    channel: "general",
    body,
    createdById: input.createdById,
    createdByName: input.createdByName,
    createdAt: new Date().toISOString(),
    });
}

export async function logAuditAction(databases: Awaited<ReturnType<typeof createAdminClient>>["databases"], input: {
    action: string;
    actorId: string;
    actorName: string;
    targetType: string;
    targetId?: string | null;
    metadata?: Record<string, unknown>;
    }) {
    // Audit logs were removed. We now synthesize logs from timestamps.
    return;
}

export function canManageLinkedinAccounts(user: User) {
    return user.role === "admin" || user.role === "developer" || user.role === "team_lead";
}

export function canSeeLinkedinReports(user: User) {
    return user.role === "admin" || user.role === "developer" || user.role === "monitor" || user.role === "operations" || user.role === "team_lead";
}

export function canReadLinkedinAccountsLikeAdmin(user: User) {
    return user.role === "admin" || user.role === "developer" || user.role === "monitor" || user.role === "operations";
}

export function resolveLinkedinReportTeamLeadId(user: User, teamLeadId?: string | null) {
    if (user.role === "team_lead") {
    return user.$id;
    }

    return teamLeadId ?? null;
}

export function assertLinkedinReportTeamScope(user: User, teamLeadId?: string | null) {
    if (canReadLinkedinAccountsLikeAdmin(user)) return;
    if (user.role === "team_lead" && user.$id === resolveLinkedinReportTeamLeadId(user, teamLeadId)) return;
    throw new Error("Unauthorized");
}

export async function assertAgentIsInTeam(teamLeadId: string, agentId: string) {
    const { databases } = await createAdminClient();
    const agent = (await databases.getDocument(
            DATABASE_ID,
            COLLECTIONS.USERS,
            agentId,
          )) as unknown as User;
    if (agent.role !== "agent" && agent.role !== "lead_generation") {
    throw new Error("Only agents and lead generation users can be assigned Linkedin IDs");
    }

    if (agent.teamLeadId !== teamLeadId) {
    throw new Error("You can only manage Linkedin IDs for your own team");
    }

    return agent;
}

export function getEtDateKey(now: Date) {
    return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    }).format(now);
}

export async function getLinkedinAccountDoc(databases: Awaited<ReturnType<typeof createAdminClient>>["databases"], accountId: string) {
    return (await databases.getDocument(
    DATABASE_ID,
    COLLECTIONS.LINKEDIN_ACCOUNTS,
    accountId,
    )) as unknown as LinkedinAccount;
}

export async function getTeamLeadAssignedUserIds(databases: Awaited<ReturnType<typeof createAdminClient>>["databases"], assignedUserIds: string[]) {
    const teamLeadAssignedUserIds = new Set<string>();
    const chunkSize = 100;
    for (let i = 0; i < assignedUserIds.length; i += chunkSize) {
    const chunk = assignedUserIds.slice(i, i + chunkSize);
    const usersResponse = await databases.listDocuments(DATABASE_ID, COLLECTIONS.USERS, [
      Query.equal("$id", chunk),
      Query.limit(2000),
    ]);

    for (const userDoc of usersResponse.documents as unknown as Array<{
      $id: string;
      role?: unknown;
    }>) {
      if (userDoc.role === "team_lead") {
        teamLeadAssignedUserIds.add(userDoc.$id);
      }
    }
    }

    return teamLeadAssignedUserIds;
}

export async function listDelegatedSourceUserIdsForToday(databases: Awaited<ReturnType<typeof createAdminClient>>["databases"], delegateUserId: string) {
    try {
    const dateKey = getEtDateKey(new Date());
    const response = await databases.listDocuments(DATABASE_ID, COLLECTIONS.ATTENDANCE, [
      Query.equal("dateKey", dateKey),
      Query.equal("delegateUserId", delegateUserId),
      Query.limit(2000),
    ]);

    const userIds = (response.documents as Array<{ userId?: unknown }>).map((doc) =>
      typeof doc.userId === "string" ? doc.userId : "",
    );
    return Array.from(new Set(userIds.filter(Boolean)));
    } catch {
    return [];
    }
}

export async function assertAccessibleLinkedinAccount(databases: Awaited<ReturnType<typeof createAdminClient>>["databases"], userId: string, accountId: string) {
    const account = await getLinkedinAccountDoc(databases, accountId);
    if (account.assignedUserId === userId) {
    return account;
    }

    const delegatedUserIds = await listDelegatedSourceUserIdsForToday(databases, userId);
    if (delegatedUserIds.includes(account.assignedUserId)) {
    return account;
    }

    throw new Error("Unauthorized");
}

export async function getSalesUserIds(databases: Awaited<ReturnType<typeof createAdminClient>>["databases"], userIds: string[]) {
    const salesUserIds = new Set<string>();
    const chunkSize = 100;
    for (let i = 0; i < userIds.length; i += chunkSize) {
    const chunk = userIds.slice(i, i + chunkSize);
    const usersResponse = await databases.listDocuments(DATABASE_ID, COLLECTIONS.USERS, [
      Query.equal("$id", chunk),
      Query.limit(2000),
    ]);
    for (const userDoc of usersResponse.documents as unknown as User[]) {
      if ((userDoc.department ?? "sales") === "sales" && userDoc.isActive !== false) {
        salesUserIds.add(userDoc.$id);
      }
    }
    }

    return salesUserIds;
}

export function parseIsoDateLocal(iso: string): Date {
    const [year, month, day] = iso.split("-").map(Number);
    return new Date(year, month - 1, day);
}

export function daysInMonthLocal(isoDate: string): number {
    const date = parseIsoDateLocal(isoDate);
    return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
}

export async function resolveScopeUsersForLinkedin(input: {
      userId: string;
      role: string;
      teamLeadId?: string;
      branchIds?: string[];
    }): Promise<User[]> {
    const { userId, role, teamLeadId, branchIds } = input;
    const isKpiEligible = (user: User | null | undefined): user is User =>
            Boolean(
              user &&
              user.isActive !== false &&
              (user.department ?? "sales") === "sales" &&
              (user.role === "agent" || user.role === "team_lead" || user.role === "lead_generation"),
            );
    if (role === "agent" || role === "lead_generation") {
    const self = await getUserByIdOrNull(userId);
    return isKpiEligible(self) ? [self] : [];
    }

    if (role === "team_lead") {
    const self = await getUserByIdOrNull(userId);
    const agents = await getAgentsByTeamLead(userId);
    return [self, ...agents].filter(isKpiEligible);
    }

    if (teamLeadId && teamLeadId !== "all") {
    const selected = await getUserByIdOrNull(teamLeadId);
    const agents = await getAgentsByTeamLead(teamLeadId);
    return [selected, ...agents].filter(isKpiEligible);
    }

    const all = await getAssignableUsers(role as any, branchIds ?? [], userId, "all");
    return all.filter((candidate) => candidate.$id !== userId && isKpiEligible(candidate));
}

export interface LinkedinConnectionKpiRow {
    accountId: string;
    idName: string;
    company: string;
    userName: string;
    userId: string;
    sentCount: number;
    target: number;
    mode: "daily" | "monthly";
    idNames: string[];
}

export type AutoWithdrawResult = {
      evaluated: number;
      autoWithdrawn: number;
      errors: number;
      processedAt: string;
    };
