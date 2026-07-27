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
import { normalizeCompany, normalizeUrl, parseDateOnly, toUtcDayStartIso, toUtcDayEndIso, daysBetweenUtc, assertDateIso, normalizeLeadOutcomeStatus, getLeadOutcomeLabel, getLinkedinRequestLeadSnapshot, getLinkedinRequestLeadOutcomeLabel, isBlockingLinkedinRequest, createGeneralChatMessage, logAuditAction, canManageLinkedinAccounts, canSeeLinkedinReports, canReadLinkedinAccountsLikeAdmin, resolveLinkedinReportTeamLeadId, assertLinkedinReportTeamScope, assertAgentIsInTeam, getEtDateKey, getLinkedinAccountDoc, getTeamLeadAssignedUserIds, listDelegatedSourceUserIdsForToday, assertAccessibleLinkedinAccount, getSalesUserIds, parseIsoDateLocal, daysInMonthLocal, resolveScopeUsersForLinkedin, LinkedinConnectionKpiRow, AutoWithdrawResult } from "./shared";

"use server";

export async function checkLinkedinDuplicateAction(input: {
      currentUserId: string;
      company: string;
      targetUrl: string;
    }) {
    await assertAuthenticatedUserId(input.currentUserId);
    const company = normalizeCompany(input.company);
    const targetUrl = normalizeUrl(input.targetUrl);
    if (!company) {
    throw new Error("Company is required");
    }

    if (!targetUrl) {
    throw new Error("URL is required");
    }

    const { databases } = await createAdminClient();
    const response = await databases.listDocuments(
            DATABASE_ID,
            COLLECTIONS.LINKEDIN_REQUESTS,
            [
              Query.equal("company", company),
              Query.equal("targetUrl", targetUrl),
              Query.orderDesc("$createdAt"),
              Query.limit(25),
            ],
          );
    const docs = response.documents as unknown as LinkedinRequest[];
    let active: LinkedinRequest | null = null;
    for (const doc of docs) {
    if (await isBlockingLinkedinRequest(databases, doc)) {
      active = doc;
      break;
    }
    }

    return {
    isDuplicate: Boolean(active),
    activeRequestId: active?.$id ?? null,
    activeStatus: active?.status ?? null,
    activeAgentId: active?.agentId ?? null,
    activeDateSent: active?.dateSent ?? null,
    };
}

export async function createLinkedinRequestAction(input: {
      currentUserId: string;
      accountId: string;
      dateSent: string;
      targetUrl: string;
      coldCall?: boolean;
      coldCallPhone?: string;
    }) {
    await assertAuthenticatedUserId(input.currentUserId);
    const user = await getAuthenticatedUserDoc();
    const targetUrl = normalizeUrl(input.targetUrl);
    if (!targetUrl) {
    throw new Error("URL is required");
    }

    const dateSent = assertDateIso(input.dateSent);
    const coldCall = Boolean(input.coldCall);
    const coldCallPhone = coldCall && typeof input.coldCallPhone === "string" && input.coldCallPhone.trim()
              ? input.coldCallPhone.trim()
              : null;
    if (coldCall && !coldCallPhone) {
    throw new Error("Cold call phone number is required.");
    }

    const { databases } = await createAdminClient();
    const account = await assertAccessibleLinkedinAccount(databases, user.$id, input.accountId);
    if (account.isActive === false) {
    throw new Error(
      "This Linkedin ID is currently inactive. Please ask Team Lead/Admin to activate it.",
    );
    }

    const company = normalizeCompany(account.company);
    const connectionLimitRaw = (account as unknown as { connectionLimit?: unknown })
            .connectionLimit;
    const connectionLimit = typeof connectionLimitRaw === "number" && Number.isFinite(connectionLimitRaw)
              ? Math.floor(connectionLimitRaw)
              : null;
    if (connectionLimit === null) {
    throw new Error(
      "This Linkedin account is missing a connection limit. Please ask Team Lead/Admin to set it.",
    );
    }

    if (connectionLimit <= 0) {
    throw new Error(
      "This Linkedin account has 0 connection limit. Please ask Team Lead/Admin to update it.",
    );
    }

    const existingByCompanyResponse = await databases.listDocuments(
            DATABASE_ID,
            COLLECTIONS.LINKEDIN_REQUESTS,
            [
              Query.equal("company", company),
              Query.equal("targetUrl", targetUrl),
              Query.orderDesc("$createdAt"),
              Query.limit(25),
            ],
          );
    const existingByCompany = existingByCompanyResponse.documents as unknown as LinkedinRequest[];
    let activeByCompany: LinkedinRequest | null = null;
    for (const doc of existingByCompany) {
    if (await isBlockingLinkedinRequest(databases, doc)) {
      activeByCompany = doc;
      break;
    }
    }

    const alreadySentResponse = await databases.listDocuments(
            DATABASE_ID,
            COLLECTIONS.LINKEDIN_REQUESTS,
            [
              Query.equal("accountId", account.$id),
              Query.equal("dateSent", dateSent),
              Query.limit(2000),
            ],
          );
    const alreadySent = (alreadySentResponse.documents as unknown as LinkedinRequest[]).filter((doc) => {
            if (activeByCompany && doc.$id === activeByCompany.$id) return false;
            const isActive = doc.isActive ?? true;
            return isActive && doc.status !== "withdrawn";
          }).length;
    if (alreadySent >= connectionLimit) {
    throw new Error(
      `Daily limit reached for this Linkedin ID (${connectionLimit}). Try another ID.`,
    );
    }

    try {
    const permissions = [
      Permission.read(Role.user(user.$id)),
      Permission.update(Role.user(user.$id)),
      Permission.delete(Role.user(user.$id)),
      Permission.read(Role.label("admin")),
    ];

    if (activeByCompany && activeByCompany.status === "accepted") {
      throw new Error("This URL is already accepted for this company.");
    }

    const docToUpdate = activeByCompany || (existingByCompany.length > 0 ? existingByCompany[0] : null);

    if (docToUpdate) {
      const prev = {
        accountId: docToUpdate.accountId,
        agentId: docToUpdate.agentId,
        teamLeadId: docToUpdate.teamLeadId,
        dateSent: docToUpdate.dateSent,
        status: docToUpdate.status,
        coldCall: Boolean(docToUpdate.coldCall),
        coldCallPhone:
          typeof docToUpdate.coldCallPhone === "string"
            ? docToUpdate.coldCallPhone
            : null,
      };

      const updated = await databases.updateDocument(
        DATABASE_ID,
        COLLECTIONS.LINKEDIN_REQUESTS,
        docToUpdate.$id,
        {
          accountId: account.$id,
          agentId: user.$id,
          teamLeadId: user.teamLeadId || null,
          dateSent,
          ...(coldCall ? { coldCall: true, coldCallPhone } : {}),
          status: "sent" satisfies LinkedinRequestStatus,
          acceptedAt: null,
          withdrawnAt: null,
          isActive: true,
        },
        permissions,
      );

      await logAuditAction(databases, {
        action: "LINKEDIN_REQUEST_RESEND",
        actorId: user.$id,
        actorName: user.name,
        targetType: "linkedin_request",
        targetId: docToUpdate.$id,
        metadata: {
          company,
          targetUrl,
          previous: prev,
          next: {
            accountId: account.$id,
            agentId: user.$id,
            teamLeadId: user.teamLeadId || null,
            dateSent,
            coldCall,
            coldCallPhone,
            status: "sent",
          },
        },
      });

      return { request: updated as unknown as LinkedinRequest, mode: "resent" as const };
    }

    const doc = await databases.createDocument(
      DATABASE_ID,
      COLLECTIONS.LINKEDIN_REQUESTS,
      ID.unique(),
      {
        accountId: account.$id,
        agentId: user.$id,
        teamLeadId: user.teamLeadId || null,
        company,
        targetUrl,
        dateSent,
        ...(coldCall ? { coldCall: true, coldCallPhone } : {}),
        status: "sent" satisfies LinkedinRequestStatus,
        acceptedAt: null,
        leadId: null,
        withdrawnAt: null,
        isActive: true,
      },
      permissions,
    );

    await logAuditAction(databases, {
      action: "LINKEDIN_REQUEST_CREATE",
      actorId: user.$id,
      actorName: user.name,
      targetType: "linkedin_request",
      targetId: doc.$id,
      metadata: {
        accountId: account.$id,
        company,
        targetUrl,
        dateSent,
        coldCall,
        coldCallPhone,
        agentId: user.$id,
        teamLeadId: user.teamLeadId || null,
      },
    });

    return { request: doc as unknown as LinkedinRequest, mode: "created" as const };
    } catch (error: unknown) {
    const details =
      typeof error === "object" && error !== null
        ? (error as { code?: unknown; message?: unknown })
        : null;
    const code = typeof details?.code === "number" ? details.code : null;
    const message = typeof details?.message === "string" ? details.message : "";
    if (code === 409 || message.toLowerCase().includes("unique")) {
      throw new Error("Duplicate: same Company + URL already exists.");
    }
    throw error;
    }
}

export async function getLinkedinRequestCompanyAction(input: {
      currentUserId: string;
      requestId: string;
    }) {
    await assertAuthenticatedUserId(input.currentUserId);
    const user = await getAuthenticatedUserDoc();
    const { databases } = await createAdminClient();
    const request = (await databases.getDocument(
            DATABASE_ID,
            COLLECTIONS.LINKEDIN_REQUESTS,
            input.requestId,
          )) as unknown as LinkedinRequest;
    if (user.role !== "admin" && request.agentId !== user.$id) {
    throw new Error("Unauthorized");
    }

    return { company: request.company ?? "" };
}

export async function linkLeadToLinkedinRequestAction(input: {
      currentUserId: string;
      requestId: string;
      leadId: string;
    }) {
    await assertAuthenticatedUserId(input.currentUserId);
    const user = await getAuthenticatedUserDoc();
    const { databases } = await createAdminClient();
    const request = (await databases.getDocument(
            DATABASE_ID,
            COLLECTIONS.LINKEDIN_REQUESTS,
            input.requestId,
          )) as unknown as LinkedinRequest;
    if (user.role !== "admin" && request.agentId !== user.$id) {
    throw new Error("Unauthorized");
    }

    const updated = await databases.updateDocument(
            DATABASE_ID,
            COLLECTIONS.LINKEDIN_REQUESTS,
            input.requestId,
            { leadId: input.leadId },
          );
    try {
    const lead = (await databases.getDocument(
      DATABASE_ID,
      COLLECTIONS.LEADS,
      input.leadId,
    )) as unknown as Lead;
    const currentData = (() => {
      try {
        return JSON.parse(lead.data ?? "{}");
      } catch {
        return {};
      }
    })();
    if (
      !currentData.linkedinRequestId ||
      String(currentData.linkedinRequestId).trim() !== input.requestId
    ) {
      await databases.updateDocument(DATABASE_ID, COLLECTIONS.LEADS, input.leadId, {
        data: JSON.stringify({ ...currentData, linkedinRequestId: input.requestId }),
      });
    }
    } catch {}

    await logAuditAction(databases, {
    action: "LINKEDIN_REQUEST_LINK_LEAD",
    actorId: user.$id,
    actorName: user.name,
    targetType: "linkedin_request",
    targetId: input.requestId,
    metadata: {
      leadId: input.leadId,
      targetUrl: request.targetUrl,
      company: request.company,
    },
    });
    return updated as unknown as LinkedinRequest;
}

export async function findBackedOutLeadForLinkedinTargetUrlAction(input: {
      currentUserId: string;
      targetUrl: string;
      company?: string;
    }) {
    await assertAuthenticatedUserId(input.currentUserId);
    const targetUrl = normalizeUrl(input.targetUrl);
    if (!targetUrl) throw new Error("URL is required");
    const company = input.company ? normalizeCompany(input.company) : "";
    const { databases } = await createAdminClient();
    const requestsResponse = await databases.listDocuments(
            DATABASE_ID,
            COLLECTIONS.LINKEDIN_REQUESTS,
            [
              Query.equal("targetUrl", targetUrl),
              ...(company ? [Query.equal("company", company)] : []),
              Query.orderDesc("$createdAt"),
              Query.limit(2000),
            ],
          );
    const requests = requestsResponse.documents as unknown as LinkedinRequest[];
    const leadIds = Array.from(
            new Set(
              requests
                .map((r) => (typeof r.leadId === "string" && r.leadId ? r.leadId : null))
                .filter((v): v is string => Boolean(v)),
            ),
          );
    for (const leadId of leadIds) {
    try {
      const lead = await databases.getDocument(DATABASE_ID, COLLECTIONS.LEADS, leadId);
      const status = typeof (lead as any)?.status === "string" ? String((lead as any).status) : "";
      const isClosed = Boolean((lead as any)?.isClosed);
      const normalizedStatus = status.trim().toLowerCase().replace(/\s+/g, "");
      if (isClosed && (normalizedStatus === "backout" || normalizedStatus === "backedout")) {
        return { leadId };
      }
    } catch {}
    }

    return { leadId: null };
}

export async function getLinkedinConnectionHistoryAction(input: {
      currentUserId: string;
      targetUrl: string;
    }) {
    await assertAuthenticatedUserId(input.currentUserId);
    const targetUrl = normalizeUrl(input.targetUrl);
    if (!targetUrl) throw new Error("URL is required");
    const { databases } = await createAdminClient();
    const requestsResponse = await databases.listDocuments(
            DATABASE_ID,
            COLLECTIONS.LINKEDIN_REQUESTS,
            [Query.equal("targetUrl", targetUrl), Query.orderDesc("$createdAt"), Query.limit(2000)],
          );
    const requests = requestsResponse.documents as unknown as LinkedinRequest[];
    const requestToLeadId = new Map<string, string>();
    for (const r of requests) {
    if (typeof r.leadId === "string" && r.leadId) {
      requestToLeadId.set(r.$id, r.leadId);
    }
    }

    const requestsMissingLead = requests.filter(
            (r) => !requestToLeadId.has(r.$id),
          );
    if (requestsMissingLead.length > 0) {
    await Promise.all(
      requestsMissingLead.map(async (r) => {
        try {
          const response = await databases.listDocuments(
            DATABASE_ID,
            COLLECTIONS.AUDIT_LOGS,
            [
              Query.equal("targetType", "linkedin_request"),
              Query.equal("targetId", r.$id),
              Query.equal("action", "LINKEDIN_REQUEST_LINK_LEAD"),
              Query.orderDesc("performedAt"),
              Query.limit(1),
            ],
          );
          for (const doc of response.documents) {
            const meta = (doc as any).metadata;
            let parsed: any = meta;
            if (typeof meta === "string") {
              try { parsed = JSON.parse(meta); } catch { parsed = null; }
            }
            const leadId =
              parsed && typeof parsed === "object" && typeof parsed.leadId === "string"
                ? parsed.leadId
                : null;
            if (leadId) requestToLeadId.set(r.$id, leadId);
            break;
          }
        } catch {
          // Ignore — history can still render without a linked lead.
        }
      }),
    );
    }

    const leadIds = Array.from(new Set(requestToLeadId.values()));
    const leadById = new Map<string, { leadId: string; status: string; isClosed: boolean }>();
    if (leadIds.length > 0) {
    const chunkSize = 100;
    for (let i = 0; i < leadIds.length; i += chunkSize) {
      const chunk = leadIds.slice(i, i + chunkSize);
      const response = await databases.listDocuments(DATABASE_ID, COLLECTIONS.LEADS, [
        Query.equal("$id", chunk),
        Query.limit(2000),
      ]);
      for (const doc of response.documents as unknown as Array<{ $id: string; status?: unknown; isClosed?: unknown }>) {
        leadById.set(doc.$id, {
          leadId: doc.$id,
          status: typeof doc.status === "string" ? doc.status : "",
          isClosed: Boolean(doc.isClosed),
        });
      }
    }
    }

    const leadAuditByLeadId = new Map<
            string,
            Array<{ $id: string; action: string; actorName: string; performedAt: string; metadata: unknown }>
          >();
    await Promise.all(
    leadIds.map(async (leadId) => {
      try {
        const response = await databases.listDocuments(DATABASE_ID, COLLECTIONS.AUDIT_LOGS, [
          Query.equal("targetType", "LEAD"),
          Query.equal("targetId", leadId),
          Query.orderDesc("performedAt"),
          Query.limit(50),
        ]);
        const logs = response.documents.map((doc) => ({
          $id: String((doc as any).$id),
          action: String((doc as any).action ?? ""),
          actorName: String((doc as any).actorName ?? ""),
          performedAt: String((doc as any).performedAt ?? ""),
          metadata: (doc as any).metadata ?? null,
        }));
        leadAuditByLeadId.set(leadId, logs);
      } catch {
        leadAuditByLeadId.set(leadId, []);
      }
    }),
    );
    const histories = await Promise.all(
            requests.map(async (req) => {
              const logsResponse = await databases.listDocuments(DATABASE_ID, COLLECTIONS.AUDIT_LOGS, [
                Query.equal("targetType", "linkedin_request"),
                Query.equal("targetId", req.$id),
                Query.orderDesc("performedAt"),
                Query.limit(100),
              ]);

              const logs = logsResponse.documents.map((doc) => ({
                $id: String((doc as any).$id),
                action: String((doc as any).action ?? ""),
                actorName: String((doc as any).actorName ?? ""),
                performedAt: String((doc as any).performedAt ?? ""),
                metadata: (doc as any).metadata ?? null,
              }));

              const leadId = requestToLeadId.get(req.$id) ?? null;
              return {
                request: req,
                logs,
                lead: leadId ? leadById.get(leadId) ?? null : null,
                leadLogs: leadId ? leadAuditByLeadId.get(leadId) ?? [] : [],
              };
            }),
          );
    return { targetUrl, histories };
}

export async function getBackoutStatusForLeadIdsAction(input: {
      currentUserId: string;
      leadIds: string[];
    }) {
    await assertAuthenticatedUserId(input.currentUserId);
    const leadIds = Array.from(
            new Set(input.leadIds.filter((id) => typeof id === "string" && id.trim())),
          );
    if (leadIds.length === 0) {
    return {
      byLeadId: {} as Record<
        string,
        { isBackout: boolean; statusLabel: string | null; isTerminal: boolean }
      >,
    };
    }

    const { databases } = await createAdminClient();
    const byLeadId: Record<
        string,
        { isBackout: boolean; statusLabel: string | null; isTerminal: boolean }
        > = {};
    const chunkSize = 100;
    for (let i = 0; i < leadIds.length; i += chunkSize) {
    const chunk = leadIds.slice(i, i + chunkSize);
    const response = await databases.listDocuments(DATABASE_ID, COLLECTIONS.LEADS, [
      Query.equal("$id", chunk),
      Query.limit(2000),
    ]);
    for (const doc of response.documents as unknown as Array<{ $id: string; status?: unknown; isClosed?: unknown }>) {
      const statusLabel = getLeadOutcomeLabel(doc.status);
      byLeadId[doc.$id] = {
        isBackout: statusLabel === "Backed Out",
        statusLabel,
        isTerminal: Boolean(statusLabel),
      };
    }
    }

    return { byLeadId };
}

export async function listMyLinkedinRequestsForAccountAction(input: {
      currentUserId: string;
      accountId: string;
      limit?: number;
    }) {
    await assertAuthenticatedUserId(input.currentUserId);
    const user = await getAuthenticatedUserDoc();
    const { databases } = await createAdminClient();
    await assertAccessibleLinkedinAccount(databases, user.$id, input.accountId);
    const response = await databases.listDocuments(
            DATABASE_ID,
            COLLECTIONS.LINKEDIN_REQUESTS,
            [
              Query.equal("agentId", user.$id),
              Query.equal("accountId", input.accountId),
              Query.orderDesc("dateSent"),
              Query.orderDesc("$createdAt"),
              Query.limit(Math.min(Math.max(input.limit ?? 50, 1), 200)),
            ],
          );
    return response.documents as unknown as LinkedinRequest[];
}

export async function listMyLinkedinRequestsAction(input: {
      currentUserId: string;
      limit?: number;
    }) {
    await assertAuthenticatedUserId(input.currentUserId);
    const user = await getAuthenticatedUserDoc();
    const { databases } = await createAdminClient();
    const delegatedUserIds = await listDelegatedSourceUserIdsForToday(databases, user.$id);
    const agentIds = delegatedUserIds.length > 0 ? [user.$id, ...delegatedUserIds] : [user.$id];
    const response = await databases.listDocuments(
            DATABASE_ID,
            COLLECTIONS.LINKEDIN_REQUESTS,
            [
              Query.equal("agentId", agentIds),
              Query.orderDesc("dateSent"),
              Query.orderDesc("$createdAt"),
              Query.limit(Math.min(Math.max(input.limit ?? 200, 1), 500)),
            ],
          );
    return response.documents as unknown as LinkedinRequest[];
}

export async function markLinkedinRequestAcceptedAction(input: {
      currentUserId: string;
      requestId: string;
    }) {
    await assertAuthenticatedUserId(input.currentUserId);
    const user = await getAuthenticatedUserDoc();
    const { databases } = await createAdminClient();
    const existing = (await databases.getDocument(
            DATABASE_ID,
            COLLECTIONS.LINKEDIN_REQUESTS,
            input.requestId,
          )) as unknown as LinkedinRequest;
    if (existing.agentId !== user.$id) {
    throw new Error("Unauthorized");
    }

    if (existing.status === "accepted") {
    if (!existing.acceptedAt || existing.isActive === false) {
      const updated = await databases.updateDocument(
        DATABASE_ID,
        COLLECTIONS.LINKEDIN_REQUESTS,
        input.requestId,
        {
          acceptedAt: existing.acceptedAt ?? new Date().toISOString(),
          isActive: true,
        },
      );
      return updated as unknown as LinkedinRequest;
    }
    return existing;
    }

    if (existing.status === "withdrawn" || existing.isActive === false) {
    throw new Error("This request is withdrawn and cannot be accepted.");
    }

    if (existing.status !== "sent") {
    throw new Error("Only active 'sent' requests can be accepted.");
    }

    const updated = await databases.updateDocument(
            DATABASE_ID,
            COLLECTIONS.LINKEDIN_REQUESTS,
            input.requestId,
            {
              status: "accepted" satisfies LinkedinRequestStatus,
              acceptedAt: new Date().toISOString(),
              isActive: true,
            },
          );
    await logAuditAction(databases, {
    action: "LINKEDIN_REQUEST_ACCEPT",
    actorId: user.$id,
    actorName: user.name,
    targetType: "linkedin_request",
    targetId: input.requestId,
    metadata: {
      accountId: existing.accountId,
      agentId: existing.agentId,
      company: existing.company,
      targetUrl: existing.targetUrl,
      dateSent: existing.dateSent,
    },
    });
    return updated as unknown as LinkedinRequest;
}

export async function withdrawLinkedinRequestAction(input: {
      currentUserId: string;
      requestId: string;
      reason: string;
    }) {
    await assertAuthenticatedUserId(input.currentUserId);
    const user = await getAuthenticatedUserDoc();
    const { databases } = await createAdminClient();
    const reason = input.reason.trim();
    if (!reason) {
    throw new Error("Withdraw reason is required.");
    }

    const existing = (await databases.getDocument(
            DATABASE_ID,
            COLLECTIONS.LINKEDIN_REQUESTS,
            input.requestId,
          )) as unknown as LinkedinRequest;
    if (existing.agentId !== user.$id) {
    throw new Error("Unauthorized");
    }

    const nowIso = new Date().toISOString();
    let eligibilityAnchor = "";
    let manualWithdrawDays = 0;
    if (existing.status === "sent" && existing.isActive !== false) {
    eligibilityAnchor = existing.dateSent;
    manualWithdrawDays = LINKEDIN_SENT_MANUAL_WITHDRAW_DAYS;
    } else if (
    existing.status === "accepted" &&
    existing.isActive !== false &&
    !existing.leadId
    ) {
    eligibilityAnchor = existing.acceptedAt || existing.dateSent;
    manualWithdrawDays = LINKEDIN_ACCEPTED_LEAD_GRACE_DAYS;
    } else {
    throw new Error("This Linkedin request cannot be withdrawn.");
    }

    const daysPassed = daysBetweenUtc(eligibilityAnchor, nowIso);
    if (daysPassed < manualWithdrawDays) {
    const remaining = manualWithdrawDays - daysPassed;
    throw new Error(
      `You can withdraw after ${manualWithdrawDays} days. ${remaining} days left.`,
    );
    }

    const updated = await databases.updateDocument(
            DATABASE_ID,
            COLLECTIONS.LINKEDIN_REQUESTS,
            input.requestId,
            {
              status: "withdrawn" satisfies LinkedinRequestStatus,
              isActive: false,
              withdrawnAt: nowIso,
            },
          );
    await logAuditAction(databases, {
    action: "LINKEDIN_REQUEST_WITHDRAW",
    actorId: user.$id,
    actorName: user.name,
    targetType: "linkedin_request",
    targetId: input.requestId,
    metadata: {
      accountId: existing.accountId,
      agentId: existing.agentId,
      company: existing.company,
      targetUrl: existing.targetUrl,
      dateSent: existing.dateSent,
      acceptedAt: existing.acceptedAt ?? null,
      withdrawnAt: nowIso,
      reason,
    },
    });
    try {
    await createGeneralChatMessage(databases, {
      createdById: user.$id,
      createdByName: user.name,
      body: `Linkedin URL available again: ${existing.targetUrl} (${existing.company}) was withdrawn by ${user.name}. Reason: ${reason}`,
    });
    } catch {}

    return updated as unknown as LinkedinRequest;
}

export async function listLinkedinRequestsForAdminAction(input: {
      currentUserId: string;
      teamLeadId?: string | null;
      startDate: string;
      endDate: string;
      status?: "all" | "sent" | "accepted" | "withdrawn";
      agentId?: string;
      limit?: number;
    }) {
    await assertAuthenticatedUserId(input.currentUserId);
    const user = await getAuthenticatedUserDoc();
    if (!canSeeLinkedinReports(user)) {
    throw new Error("Unauthorized");
    }

    const effectiveTeamLeadId = resolveLinkedinReportTeamLeadId(user, input.teamLeadId);
    assertLinkedinReportTeamScope(user, effectiveTeamLeadId);
    const start = toUtcDayStartIso(input.startDate);
    const end = toUtcDayEndIso(input.endDate);
    const queries = [
            Query.greaterThanEqual("dateSent", start),
            Query.lessThanEqual("dateSent", end),
            Query.orderDesc("dateSent"),
            Query.orderDesc("$createdAt"),
            Query.limit(Math.min(Math.max(input.limit ?? 500, 1), 2000)),
          ];
    if (effectiveTeamLeadId && effectiveTeamLeadId !== "all") {
    queries.unshift(Query.equal("teamLeadId", effectiveTeamLeadId));
    }

    if (input.agentId) {
    queries.unshift(Query.equal("agentId", input.agentId));
    }

    if (input.status && input.status !== "all") {
    queries.unshift(Query.equal("status", input.status));
    }

    const { databases } = await createAdminClient();
    const response = await databases.listDocuments(
            DATABASE_ID,
            COLLECTIONS.LINKEDIN_REQUESTS,
            queries,
          );
    const docs = response.documents as unknown as LinkedinRequest[];
    const uniqueDocs = Array.from(new Map(docs.map((r) => [r.$id, r] as const)).values());
    const agentIds = Array.from(
            new Set(uniqueDocs.map((r) => r.agentId).filter(Boolean)),
          );
    const salesAgentIds = await getSalesUserIds(databases, agentIds);
    const salesDocs = uniqueDocs.filter((r) => salesAgentIds.has(r.agentId));
    return user.role === "team_lead"
    ? salesDocs.filter((request) => request.agentId !== user.$id)
    : salesDocs;
}

export async function exportLinkedinRequestsForAdminAction(input: {
      currentUserId: string;
      teamLeadId?: string | null;
      startDate: string;
      endDate: string;
      status?: "all" | "sent" | "accepted" | "withdrawn";
      agentId?: string;
    }) {
    await assertAuthenticatedUserId(input.currentUserId);
    const user = await getAuthenticatedUserDoc();
    if (!canSeeLinkedinReports(user)) {
    throw new Error("Unauthorized");
    }

    const effectiveTeamLeadId = resolveLinkedinReportTeamLeadId(user, input.teamLeadId);
    assertLinkedinReportTeamScope(user, effectiveTeamLeadId);
    const start = toUtcDayStartIso(input.startDate);
    const end = toUtcDayEndIso(input.endDate);
    const queries = [
            Query.greaterThanEqual("dateSent", start),
            Query.lessThanEqual("dateSent", end),
            Query.orderDesc("dateSent"),
            Query.orderDesc("$createdAt"),
          ];
    if (effectiveTeamLeadId && effectiveTeamLeadId !== "all") {
    queries.unshift(Query.equal("teamLeadId", effectiveTeamLeadId));
    }

    if (input.agentId) {
    queries.unshift(Query.equal("agentId", input.agentId));
    }

    if (input.status && input.status !== "all") {
    queries.unshift(Query.equal("status", input.status));
    }

    const { databases } = await createAdminClient();
    const docs = await listAllDocuments<LinkedinRequest>({
            databases,
            databaseId: DATABASE_ID,
            collectionId: COLLECTIONS.LINKEDIN_REQUESTS,
            queries,
            maxPages: 100 // 100 pages * 100 limit = 10,000
          });
    const uniqueDocs = Array.from(new Map(docs.map((r) => [r.$id, r] as const)).values());
    const agentIds = Array.from(
            new Set(uniqueDocs.map((r) => r.agentId).filter(Boolean)),
          );
    const salesAgentIds = await getSalesUserIds(databases, agentIds);
    const salesDocs = uniqueDocs.filter((r) => salesAgentIds.has(r.agentId));
    const finalDocs = salesDocs;
    const accountIds = Array.from(new Set(finalDocs.map(r => r.accountId).filter(Boolean)));
    const accountsMap = new Map<string, LinkedinAccount>();
    if (accountIds.length > 0) {
    const chunkSize = 100;
    for (let i = 0; i < accountIds.length; i += chunkSize) {
      const chunk = accountIds.slice(i, i + chunkSize);
      const res = await databases.listDocuments(DATABASE_ID, COLLECTIONS.LINKEDIN_ACCOUNTS, [
        Query.equal("$id", chunk),
        Query.limit(chunkSize)
      ]);
      for (const acc of res.documents as unknown as LinkedinAccount[]) {
        accountsMap.set(acc.$id, acc);
      }
    }
    }

    const missingMainAccountIds = Array.from(
            new Set(
              Array.from(accountsMap.values())
                .map(a => a.mainAccountId)
                .filter(id => Boolean(id) && !accountsMap.has(id!))
            )
          ) as string[];
    if (missingMainAccountIds.length > 0) {
    const chunkSize = 100;
    for (let i = 0; i < missingMainAccountIds.length; i += chunkSize) {
      const chunk = missingMainAccountIds.slice(i, i + chunkSize);
      const res = await databases.listDocuments(DATABASE_ID, COLLECTIONS.LINKEDIN_ACCOUNTS, [
        Query.equal("$id", chunk),
        Query.limit(chunkSize)
      ]);
      for (const acc of res.documents as unknown as LinkedinAccount[]) {
        accountsMap.set(acc.$id, acc);
      }
    }
    }

    const leadIds = Array.from(new Set(finalDocs.map(r => r.leadId).filter(Boolean))) as string[];
    const leadsMap = new Map<string, Lead>();
    if (leadIds.length > 0) {
    const chunkSize = 100;
    for (let i = 0; i < leadIds.length; i += chunkSize) {
      const chunk = leadIds.slice(i, i + chunkSize);
      const res = await databases.listDocuments(DATABASE_ID, COLLECTIONS.LEADS, [
        Query.equal("$id", chunk),
        Query.limit(chunkSize)
      ]);
      for (const l of res.documents as unknown as Lead[]) {
        leadsMap.set(l.$id, l);
      }
    }
    }

    return finalDocs.map(req => {
    const account = accountsMap.get(req.accountId);
    const lead = (req.leadId && leadsMap.has(req.leadId)) ? leadsMap.get(req.leadId)! : null;
    let leadData: any = {};
    if (lead && lead.data) {
      try {
        leadData = JSON.parse(lead.data);
      } catch (e) {
        // ignore JSON parse error
      }
    }

    const profileName = account ? (account.idName || account.company || req.accountId) : req.accountId;

    // Format call booked
    let callBookedStr = 'N';
    if (leadData.callBookedDate) {
      callBookedStr = `Y - ${leadData.callBookedDate}`;
    } else if (leadData.callBooked) {
      callBookedStr = 'Y';
    }

    // Format closed
    let closedStr = lead?.isClosed ? 'Y' : 'N';
    if (lead?.isClosed && (leadData.closedAmount || leadData.amount)) {
      closedStr = `Y - ${leadData.closedAmount || leadData.amount}`;
    }

    // Resolve main account name for the sheet grouping
    const accountType = account?.accountType || "main";
    const mainAccountId = account?.mainAccountId || req.accountId;
    let mainAccountName = profileName;

    if (accountType === "sudo" && account?.mainAccountId) {
      // Find the main account in the map if it exists, otherwise use the ID
      const mainAcc = accountsMap.get(account.mainAccountId);
      if (mainAcc) {
        mainAccountName = mainAcc.idName || mainAcc.company || mainAcc.$id;
      } else {
        mainAccountName = account.mainAccountId; // fallback
      }
    }

    return {
      linkedinProfile: profileName,
      noOfRequestSent: 1, // Single request per row
      date: req.dateSent,
      linkedinUrl: req.targetUrl,
      connectionNote: leadData.connectionNote || leadData.note || "",
      status: req.status,
      interested: lead ? (lead.status === 'not_interested' ? 'N' : 'Y') : "",
      reasonOfReject: lead?.status === 'not_interested' ? (leadData.reason || leadData.lostReason || "") : "",
      callBooked: callBookedStr,
      callCompleted: leadData.callCompleted ? 'Y' : 'N',
      closed: closedStr,
      lostReason: leadData.lostReason || leadData.reason || "",
      // Added for Excel multi-sheet grouping
      accountType,
      mainAccountId,
      mainAccountName,
    };
    });
}

/**
 * Runs the LinkedIn auto-withdrawal logic on-demand.
 *
 * Evaluates all active `sent` requests older than
 * LINKEDIN_SENT_AUTO_WITHDRAW_DAYS (20 days) and marks them withdrawn,
 * and all `accepted` requests without a lead older than
 * LINKEDIN_ACCEPTED_AUTO_WITHDRAW_DAYS (11 days).
 *
 * Can be triggered:
 *  - from the LinkedIn Reports admin UI (manual run)
 *  - from an external cron/Appwrite Function via the API route
 *    `/api/cron/linkedin-withdrawal-reminders`
 */
export async function runLinkedinAutoWithdrawAction(input: {
      currentUserId: string;
    }): Promise<AutoWithdrawResult> {
    await assertAuthenticatedUserId(input.currentUserId);
    const actor = await getAuthenticatedUserDoc();
    const isAllowed = actor.role === "admin" ||
            actor.role === "developer" ||
            actor.role === "operations" ||
            actor.role === "monitor";
    if (!isAllowed) {
    throw new Error("Only admins can run auto-withdraw.");
    }

    const { databases } = await createAdminClient();
    const now = new Date();
    const nowIso = now.toISOString();
    const response = await databases.listDocuments(
            DATABASE_ID,
            COLLECTIONS.LINKEDIN_REQUESTS,
            [
              Query.equal("isActive", true),
              Query.equal("status", ["sent", "accepted"]),
              Query.limit(5000),
            ],
          );
    let evaluated = 0;
    let autoWithdrawn = 0;
    let errors = 0;
    for (const doc of response.documents as unknown as LinkedinRequest[]) {
    // Skip accepted requests that already have a linked lead
    if (doc.status === "accepted" && doc.leadId) continue;

    evaluated += 1;

    if (!shouldAutoWithdrawLinkedinRequest({ request: doc, now })) continue;

    try {
      const isAcceptedWithoutLead = doc.status === "accepted" && !doc.leadId;
      const reason = isAcceptedWithoutLead
        ? `No lead was created within ${LINKEDIN_ACCEPTED_AUTO_WITHDRAW_DAYS} days after connection acceptance.`
        : `Connection was not accepted/withdrawn within ${LINKEDIN_SENT_AUTO_WITHDRAW_DAYS} days after sending.`;

      // Mark withdrawn
      await databases.updateDocument(
        DATABASE_ID,
        COLLECTIONS.LINKEDIN_REQUESTS,
        doc.$id,
        {
          status: "withdrawn",
          isActive: false,
          withdrawnAt: nowIso,
        },
      );

      // Audit log
      await databases.createDocument(
        DATABASE_ID,
        COLLECTIONS.AUDIT_LOGS,
        ID.unique(),
        {
          action: "LINKEDIN_REQUEST_AUTO_WITHDRAW",
          actorId: actor.$id,
          actorName: actor.name,
          targetId: doc.$id,
          targetType: "linkedin_request",
          metadata: JSON.stringify({
            company: doc.company,
            targetUrl: doc.targetUrl,
            reason,
            withdrawnAt: nowIso,
            triggeredBy: "admin_action",
          }),
          performedAt: nowIso,
        },
      );

      // General chat notification
      try {
        await databases.createDocument(
          DATABASE_ID,
          COLLECTIONS.CHAT_MESSAGES,
          ID.unique(),
          {
            channel: "general",
            body: `Linkedin URL available again: ${doc.targetUrl} (${doc.company}) was auto-withdrawn. Reason: ${reason}`,
            createdById: "system",
            createdByName: "System",
            createdAt: nowIso,
          },
        );
      } catch {
        // Chat message failure is non-fatal
      }

      autoWithdrawn += 1;
    } catch {
      errors += 1;
    }
    }

    return { evaluated, autoWithdrawn, errors, processedAt: nowIso };
}
