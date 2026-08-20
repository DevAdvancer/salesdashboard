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

export async function listTeamLeadsForLinkedinAction(input: {
      currentUserId: string;
    }) {
    await assertAuthenticatedUserId(input.currentUserId);
    const user = await getAuthenticatedUserDoc();
    if (!canReadLinkedinAccountsLikeAdmin(user)) {
    throw new Error("Unauthorized");
    }

    const { databases } = await createAdminClient();
    const response = await databases.listDocuments(DATABASE_ID, COLLECTIONS.USERS, [
            Query.equal("role", "team_lead"),
            Query.limit(1000),
            Query.orderAsc("name"),
          ]);
    return (response.documents as unknown as User[]).filter(
    (u) => (u.department ?? "sales") === "sales",
    );
}

export async function listAllUsersForLinkedinAction(input: {
      currentUserId: string;
    }) {
    await assertAuthenticatedUserId(input.currentUserId);
    const user = await getAuthenticatedUserDoc();
    if (!canReadLinkedinAccountsLikeAdmin(user)) {
    throw new Error("Unauthorized");
    }

    const { databases } = await createAdminClient();
    const response = await databases.listDocuments(DATABASE_ID, COLLECTIONS.USERS, [
            Query.limit(1000),
            Query.orderAsc("name"),
          ]);
    return (response.documents as unknown as User[]).filter(
    (u) => (u.department ?? "sales") === "sales",
    );
}

export async function listAgentsForTeamLeadLinkedinAction(input: {
      currentUserId: string;
      teamLeadId?: string;
    }) {
    await assertAuthenticatedUserId(input.currentUserId);
    const user = await getAuthenticatedUserDoc();
    const teamLeadId = user.role === "team_lead" ? user.$id : (input.teamLeadId ?? "");
    if (!teamLeadId) {
    throw new Error("Team Lead is required");
    }

    if (!canReadLinkedinAccountsLikeAdmin(user) && user.role !== "team_lead") {
    throw new Error("Unauthorized");
    }

    if (user.role === "team_lead" && teamLeadId !== user.$id) {
    throw new Error("Unauthorized");
    }

    const { databases } = await createAdminClient();
    const response = await databases.listDocuments(DATABASE_ID, COLLECTIONS.USERS, [
            Query.equal("role", ["agent", "lead_generation"]),
            Query.equal("teamLeadId", teamLeadId),
            Query.limit(1000),
            Query.orderAsc("name"),
          ]);
    return (response.documents as unknown as User[]).filter(
    (u) => (u.department ?? "sales") === "sales",
    );
}
