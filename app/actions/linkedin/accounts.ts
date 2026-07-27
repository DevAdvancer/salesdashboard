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

export async function listMyLinkedinAccountsAction(input: {
      currentUserId: string;
    }) {
    await assertAuthenticatedUserId(input.currentUserId);
    const user = await getAuthenticatedUserDoc();
    const { databases } = await createAdminClient();
    const delegatedUserIds = await listDelegatedSourceUserIdsForToday(databases, user.$id);
    const assignedUserIds = delegatedUserIds.length > 0 ? [user.$id, ...delegatedUserIds] : [user.$id];
    const response = await databases.listDocuments(
            DATABASE_ID,
            COLLECTIONS.LINKEDIN_ACCOUNTS,
            [
              Query.equal("assignedUserId", assignedUserIds),
              Query.equal("isActive", true),
              Query.orderAsc("accountType"),
              Query.orderAsc("idName"),
              Query.limit(200),
            ],
          );
    return response.documents as unknown as LinkedinAccount[];
}

export async function upsertLinkedinAccountAction(input: {
      currentUserId: string;
      accountId?: string;
      assignedUserId: string;
      company: string;
      idName: string;
      accountType: LinkedinAccountType;
      licenseType?: string;
      connectionLimit: number;
      mainAccountId?: string | null;
      isActive?: boolean;
    }) {
    await assertAuthenticatedUserId(input.currentUserId);
    const user = await getAuthenticatedUserDoc();
    if (!canManageLinkedinAccounts(user)) {
    throw new Error("Unauthorized");
    }

    const company = normalizeCompany(input.company);
    const idName = input.idName.trim();
    if (!company) throw new Error("Company is required");
    if (!idName) throw new Error("ID Name is required");
    const licenseType = (input.licenseType ?? "").trim();
    if (!licenseType) throw new Error("License type is required");
    const connectionLimit = Math.floor(input.connectionLimit);
    if (!Number.isFinite(connectionLimit) || connectionLimit < 0) {
    throw new Error("Connection limit must be 0 or more.");
    }

    let agent: User | null = null;
    if (user.role === "team_lead") {
    agent = await assertAgentIsInTeam(user.$id, input.assignedUserId);
    } else {
    const { databases } = await createAdminClient();
    agent = (await databases.getDocument(
      DATABASE_ID,
      COLLECTIONS.USERS,
      input.assignedUserId,
    )) as unknown as User;
    // Admins can assign to anyone
    }

    const { databases } = await createAdminClient();
    const isCreating = !input.accountId;
    if (input.accountType === "main") {
    const existingMain = await databases.listDocuments(
      DATABASE_ID,
      COLLECTIONS.LINKEDIN_ACCOUNTS,
      [
        Query.equal("assignedUserId", input.assignedUserId),
        Query.equal("accountType", "main"),
        Query.limit(2),
      ],
    );

    const conflict = existingMain.documents.find(
      (doc) => !input.accountId || doc.$id !== input.accountId,
    );
    if (conflict) {
      throw new Error("This agent already has a Main Linkedin ID.");
    }
    } else {
    const mainAccountId = input.mainAccountId ?? "";
    if (!mainAccountId) {
      throw new Error("Main Account is required for Sudo IDs");
    }
    const main = await getLinkedinAccountDoc(databases, mainAccountId);
    if (main.assignedUserId !== input.assignedUserId || main.accountType !== "main") {
      throw new Error("Invalid Main Account");
    }

    if (isCreating) {
      const existingSudo = await databases.listDocuments(
        DATABASE_ID,
        COLLECTIONS.LINKEDIN_ACCOUNTS,
        [
          Query.equal("assignedUserId", input.assignedUserId),
          Query.equal("accountType", "sudo"),
          Query.limit(200),
        ],
      );
      if (existingSudo.documents.length >= 5) {
        throw new Error("Max 5 Sudo IDs allowed per agent.");
      }
    }
    }

    type LinkedinAccountUpsertPayload = {
            assignedUserId: string;
            teamLeadId: string | null;
            company: string;
            idName: string;
            accountType: LinkedinAccountType;
            mainAccountId: string | null;
            isActive: boolean;
            licenseType: string;
            connectionLimit: number;
            updatedBy: string;
            createdBy?: string;
          };
    const basePayload: LinkedinAccountUpsertPayload = {
            assignedUserId: input.assignedUserId,
            teamLeadId: agent.role === "team_lead" ? agent.$id : agent.teamLeadId || null,
            company,
            idName,
            accountType: input.accountType,
            mainAccountId:
              input.accountType === "sudo" ? input.mainAccountId ?? null : null,
            isActive: input.isActive ?? true,
            licenseType,
            connectionLimit,
            updatedBy: user.$id,
          };
    const payload: LinkedinAccountUpsertPayload = isCreating
            ? { ...basePayload, createdBy: user.$id }
            : basePayload;
    if (isCreating) {
    const doc = await databases.createDocument(
      DATABASE_ID,
      COLLECTIONS.LINKEDIN_ACCOUNTS,
      ID.unique(),
      payload,
      [Permission.read(Role.label("admin")), Permission.update(Role.label("admin"))],
    );
    await logAuditAction(databases, {
      action: "LINKEDIN_ACCOUNT_CREATE",
      actorId: user.$id,
      actorName: user.name,
      targetType: "linkedin_account",
      targetId: doc.$id,
      metadata: payload,
    });
    return doc as unknown as LinkedinAccount;
    }

    const doc = await databases.updateDocument(
            DATABASE_ID,
            COLLECTIONS.LINKEDIN_ACCOUNTS,
            input.accountId!,
            payload,
          );
    await logAuditAction(databases, {
    action: "LINKEDIN_ACCOUNT_UPDATE",
    actorId: user.$id,
    actorName: user.name,
    targetType: "linkedin_account",
    targetId: input.accountId!,
    metadata: payload,
    });
    return doc as unknown as LinkedinAccount;
}

export async function toggleLinkedinAccountStatusAction(input: {
      currentUserId: string;
      accountId: string;
      isActive: boolean;
    }) {
    await assertAuthenticatedUserId(input.currentUserId);
    const user = await getAuthenticatedUserDoc();
    if (!canManageLinkedinAccounts(user)) {
    throw new Error("Unauthorized");
    }

    const { databases } = await createAdminClient();
    const account = await getLinkedinAccountDoc(databases, input.accountId);
    if (user.role === "team_lead") {
    await assertAgentIsInTeam(user.$id, account.assignedUserId);
    }

    const updated = await databases.updateDocument(
            DATABASE_ID,
            COLLECTIONS.LINKEDIN_ACCOUNTS,
            input.accountId,
            {
              isActive: input.isActive,
              updatedBy: user.$id,
            },
          );
    await logAuditAction(databases, {
    action: input.isActive ? "LINKEDIN_ACCOUNT_ACTIVATE" : "LINKEDIN_ACCOUNT_DEACTIVATE",
    actorId: user.$id,
    actorName: user.name,
    targetType: "linkedin_account",
    targetId: input.accountId,
    metadata: {
      assignedUserId: account.assignedUserId,
      idName: account.idName,
      company: account.company,
      isActive: input.isActive,
    },
    });
    return updated as unknown as LinkedinAccount;
}

export async function listLinkedinAccountsForManagementAction(input: {
      currentUserId: string;
      teamLeadId?: string | null;
    }) {
    await assertAuthenticatedUserId(input.currentUserId);
    const user = await getAuthenticatedUserDoc();
    if (!canManageLinkedinAccounts(user) && !canSeeLinkedinReports(user)) {
    throw new Error("Unauthorized");
    }

    const teamLeadId = user.role === "team_lead" ? user.$id : input.teamLeadId ?? null;
    const queries = [
            Query.orderAsc("teamLeadId"),
            Query.orderAsc("assignedUserId"),
            Query.orderAsc("accountType"),
            Query.orderAsc("idName"),
            Query.limit(2000),
          ];
    if (teamLeadId) {
    queries.unshift(Query.equal("teamLeadId", teamLeadId));
    }

    const { databases } = await createAdminClient();
    const response = await databases.listDocuments(
            DATABASE_ID,
            COLLECTIONS.LINKEDIN_ACCOUNTS,
            queries,
          );
    const accounts = response.documents as unknown as LinkedinAccount[];
    const assignedUserIds = Array.from(
            new Set(accounts.map((account) => account.assignedUserId).filter(Boolean)),
          );
    if (assignedUserIds.length === 0) {
    return [];
    }

    const salesUserIds = await getSalesUserIds(databases, assignedUserIds);
    let filtered = accounts.filter((account) => salesUserIds.has(account.assignedUserId));
    if (user.role === "team_lead") {
    const teamLeadAssignedUserIds = await getTeamLeadAssignedUserIds(databases, assignedUserIds);
    filtered = filtered.filter(
      (account) => !teamLeadAssignedUserIds.has(account.assignedUserId),
    );
    }

    return filtered;
}
