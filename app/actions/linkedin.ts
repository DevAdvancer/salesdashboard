"use server";

import { ID, Permission, Query, Role } from "node-appwrite";
import { createAdminClient } from "@/lib/server/appwrite";
import {
  assertAuthenticatedUserId,
  getAuthenticatedUserDoc,
} from "@/lib/server/current-user";
import { COLLECTIONS, DATABASE_ID } from "@/lib/constants/appwrite";
import type {
  Lead,
  LinkedinAccount,
  LinkedinAccountType,
  LinkedinRequest,
  LinkedinRequestStatus,
  User,
} from "@/lib/types";
import {
  LINKEDIN_ACCEPTED_LEAD_GRACE_DAYS,
  LINKEDIN_SENT_MANUAL_WITHDRAW_DAYS,
} from "@/lib/utils/linkedin-withdrawal-reminders";

function normalizeCompany(value: string) {
  return value.trim();
}

function normalizeUrl(value: string) {
  return value.trim();
}

function parseDateOnly(value: string) {
  const [year, month, day] = value.split("-").map((part) => Number(part));
  if (!year || !month || !day) return null;
  return { year, month, day };
}

function toUtcDayStartIso(dateValue: string) {
  const parsed = parseDateOnly(dateValue);
  if (!parsed) throw new Error("Invalid date");
  return new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day, 0, 0, 0, 0)).toISOString();
}

function toUtcDayEndIso(dateValue: string) {
  const parsed = parseDateOnly(dateValue);
  if (!parsed) throw new Error("Invalid date");
  return new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day, 23, 59, 59, 999)).toISOString();
}

function daysBetweenUtc(startIso: string, endIso: string) {
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

function assertDateIso(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error("Invalid date");
  }
  return date.toISOString();
}

function normalizeLeadOutcomeStatus(value: unknown) {
  return typeof value === "string"
    ? value.trim().toLowerCase().replace(/\s+/g, "")
    : "";
}

function getLeadOutcomeLabel(status: unknown) {
  const normalized = normalizeLeadOutcomeStatus(status);
  if (normalized === "backout" || normalized === "backedout") {
    return "Backed Out";
  }
  if (normalized === "notinterested") {
    return "Not Interested";
  }
  return null;
}

async function getLinkedinRequestLeadSnapshot(
  databases: Awaited<ReturnType<typeof createAdminClient>>["databases"],
  leadId?: string | null,
) {
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

async function getLinkedinRequestLeadOutcomeLabel(
  databases: Awaited<ReturnType<typeof createAdminClient>>["databases"],
  request: Pick<LinkedinRequest, "leadId">,
) {
  const lead = await getLinkedinRequestLeadSnapshot(databases, request.leadId);
  return getLeadOutcomeLabel(lead?.status);
}

async function isBlockingLinkedinRequest(
  databases: Awaited<ReturnType<typeof createAdminClient>>["databases"],
  request: LinkedinRequest,
) {
  if ((request.isActive ?? true) === false) return false;
  if (request.status === "withdrawn") return false;
  if (request.status !== "accepted") return true;

  const outcomeLabel = await getLinkedinRequestLeadOutcomeLabel(databases, request);
  return !outcomeLabel;
}

async function createGeneralChatMessage(
  databases: Awaited<ReturnType<typeof createAdminClient>>["databases"],
  input: {
    createdById: string;
    createdByName: string;
    body: string;
  },
) {
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

function canManageLinkedinAccounts(user: User) {
  return user.role === "admin" || user.role === "developer";
}

function canSeeLinkedinReports(user: User) {
  return user.role === "admin" || user.role === "developer" || user.role === "monitor" || user.role === "operations" || user.role === "team_lead";
}

function canReadLinkedinAccountsLikeAdmin(user: User) {
  return user.role === "admin" || user.role === "developer" || user.role === "monitor" || user.role === "operations";
}

function assertLinkedinReportTeamScope(user: User, teamLeadId?: string | null) {
  if (canReadLinkedinAccountsLikeAdmin(user)) return;
  if (user.role === "team_lead" && user.$id === teamLeadId) return;
  throw new Error("Unauthorized");
}

async function assertAgentIsInTeam(teamLeadId: string, agentId: string) {
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

function getEtDateKey(now: Date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

async function getLinkedinAccountDoc(
  databases: Awaited<ReturnType<typeof createAdminClient>>["databases"],
  accountId: string,
) {
  return (await databases.getDocument(
    DATABASE_ID,
    COLLECTIONS.LINKEDIN_ACCOUNTS,
    accountId,
  )) as unknown as LinkedinAccount;
}

async function listDelegatedSourceUserIdsForToday(
  databases: Awaited<ReturnType<typeof createAdminClient>>["databases"],
  delegateUserId: string,
) {
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

async function assertAccessibleLinkedinAccount(
  databases: Awaited<ReturnType<typeof createAdminClient>>["databases"],
  userId: string,
  accountId: string,
) {
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

export async function listMyLinkedinAccountsAction(input: {
  currentUserId: string;
}) {
  await assertAuthenticatedUserId(input.currentUserId);
  const user = await getAuthenticatedUserDoc();
  const { databases } = await createAdminClient();

  const delegatedUserIds = await listDelegatedSourceUserIdsForToday(databases, user.$id);
  const assignedUserIds =
    delegatedUserIds.length > 0 ? [user.$id, ...delegatedUserIds] : [user.$id];

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
  const coldCallPhone =
    coldCall && typeof input.coldCallPhone === "string" && input.coldCallPhone.trim()
      ? input.coldCallPhone.trim()
      : null;
  if (coldCall && !coldCallPhone) {
    throw new Error("Cold call phone number is required.");
  }
  const { databases } = await createAdminClient();
  const account = await assertAccessibleLinkedinAccount(databases, user.$id, input.accountId);
  const company = normalizeCompany(account.company);
  const connectionLimitRaw = (account as unknown as { connectionLimit?: unknown })
    .connectionLimit;
  const connectionLimit =
    typeof connectionLimitRaw === "number" && Number.isFinite(connectionLimitRaw)
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

    if (activeByCompany) {
      if (activeByCompany.status === "accepted") {
        throw new Error("This URL is already accepted for this company.");
      }

      const prev = {
        accountId: activeByCompany.accountId,
        agentId: activeByCompany.agentId,
        teamLeadId: activeByCompany.teamLeadId,
        dateSent: activeByCompany.dateSent,
        status: activeByCompany.status,
        coldCall: Boolean(activeByCompany.coldCall),
        coldCallPhone:
          typeof activeByCompany.coldCallPhone === "string"
            ? activeByCompany.coldCallPhone
            : null,
      };

      const updated = await databases.updateDocument(
        DATABASE_ID,
        COLLECTIONS.LINKEDIN_REQUESTS,
        activeByCompany.$id,
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
        targetId: activeByCompany.$id,
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
  const leadIds = Array.from(
    new Set(
      requests
        .map((r) => (typeof r.leadId === "string" && r.leadId ? r.leadId : null))
        .filter((v): v is string => Boolean(v)),
    ),
  );

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

      const leadId = typeof req.leadId === "string" && req.leadId ? req.leadId : null;
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
  const agentIds =
    delegatedUserIds.length > 0 ? [user.$id, ...delegatedUserIds] : [user.$id];

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

  return response.documents as unknown as User[];
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

  return response.documents as unknown as User[];
}

export async function listAgentsForTeamLeadLinkedinAction(input: {
  currentUserId: string;
  teamLeadId?: string;
}) {
  await assertAuthenticatedUserId(input.currentUserId);
  const user = await getAuthenticatedUserDoc();

  const teamLeadId =
    user.role === "team_lead" ? user.$id : (input.teamLeadId ?? "");

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

  return response.documents as unknown as User[];
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
    return accounts;
  }

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

  return accounts.filter(
    (account) => !teamLeadAssignedUserIds.has(account.assignedUserId),
  );
}

export async function getLinkedinWeeklyReportAction(input: {
  currentUserId: string;
  teamLeadId?: string | null;
  startDate: string;
  endDate: string;
}) {
  await assertAuthenticatedUserId(input.currentUserId);
  const user = await getAuthenticatedUserDoc();
  if (!canSeeLinkedinReports(user)) {
    throw new Error("Unauthorized");
  }
  assertLinkedinReportTeamScope(user, input.teamLeadId);

  const startDate = assertDateIso(input.startDate);
  const endDate = assertDateIso(input.endDate);

  const { databases } = await createAdminClient();
  const pageSize = 100;
  let cursor: string | null = null;
  const all: LinkedinRequest[] = [];

  while (true) {
    const queries = [
      Query.greaterThanEqual("dateSent", startDate),
      Query.lessThanEqual("dateSent", endDate),
      Query.limit(pageSize),
      Query.orderAsc("$id"),
    ];
    if (input.teamLeadId && input.teamLeadId !== "all") {
      queries.unshift(Query.equal("teamLeadId", input.teamLeadId));
    }
    if (cursor) queries.push(Query.cursorAfter(cursor));

    const page = await databases.listDocuments(
      DATABASE_ID,
      COLLECTIONS.LINKEDIN_REQUESTS,
      queries,
    );

    const docs = page.documents as unknown as LinkedinRequest[];
    all.push(...docs);
    if (docs.length < pageSize) break;
    cursor = docs.at(-1)?.$id ?? null;
    if (!cursor) break;
  }

  const uniqueRequests = Array.from(
    new Map(all.map((r) => [r.$id, r] as const)).values(),
  );

  const accountIds = Array.from(
    new Set(uniqueRequests.map((r) => r.accountId).filter(Boolean)),
  );

  const accountsMap = new Map<string, LinkedinAccount>();
  if (accountIds.length > 0) {
    const accounts = await databases.listDocuments(
      DATABASE_ID,
      COLLECTIONS.LINKEDIN_ACCOUNTS,
      [Query.equal("$id", accountIds), Query.limit(Math.min(accountIds.length, 2000))],
    );
    (accounts.documents as unknown as LinkedinAccount[]).forEach((a) => {
      accountsMap.set(a.$id, a);
    });
  }

  type Row = {
    agentId: string;
    accountId: string;
    company: string;
    idName: string;
    accountType: LinkedinAccountType;
    sent: number;
    coldCalls: number;
    accepted: number;
    leadsGenerated: number;
    closures: number;
    notAccepted: number;
    withdrawn: number;
  };

  const map = new Map<string, Row>();
  const leadIdsByKey = new Map<string, Set<string>>();
  for (const req of uniqueRequests) {
    const account = accountsMap.get(req.accountId);
    const accountType = (account?.accountType ?? "main") as LinkedinAccountType;
    const idName = account?.idName ?? req.accountId;
    const key = `${req.agentId}-${req.accountId}`;
    const existing = map.get(key) ?? {
      agentId: req.agentId,
      accountId: req.accountId,
      company: req.company,
      idName,
      accountType,
      sent: 0,
      coldCalls: 0,
      accepted: 0,
      leadsGenerated: 0,
      closures: 0,
      notAccepted: 0,
      withdrawn: 0,
    };
    existing.sent += 1;
    if (req.coldCall) {
      existing.coldCalls += 1;
    }
    const status = req.status;
    const isActive = req.isActive !== false;
    if (status === "accepted") {
      existing.accepted += 1;
    } else if (status === "withdrawn" || !isActive) {
      existing.withdrawn += 1;
    } else {
      existing.notAccepted += 1;
    }

    const leadId = typeof req.leadId === "string" && req.leadId ? req.leadId : null;
    if (leadId) {
      const set = leadIdsByKey.get(key) ?? new Set<string>();
      set.add(leadId);
      leadIdsByKey.set(key, set);
    }
    map.set(key, existing);
  }

  const leadIds = Array.from(
    new Set(Array.from(leadIdsByKey.values()).flatMap((set) => Array.from(set))),
  );
  const leadById = new Map<string, { isClosed: boolean; status: string }>();
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
          isClosed: Boolean(doc.isClosed),
          status: typeof doc.status === "string" ? doc.status : "",
        });
      }
    }
  }

  for (const [key, row] of map.entries()) {
    const leadIdsForKey = leadIdsByKey.get(key);
    if (!leadIdsForKey) continue;
    row.leadsGenerated = leadIdsForKey.size;
    let closures = 0;
    for (const leadId of leadIdsForKey) {
      const lead = leadById.get(leadId);
      if (!lead) continue;
      const normalizedStatus = lead.status.trim().toLowerCase().replace(/\s+/g, "");
      if (lead.isClosed && normalizedStatus === "won") {
        closures += 1;
      }
    }
    row.closures = closures;
  }

  return {
    startDate,
    endDate,
    rows: Array.from(map.values()).sort((a, b) =>
      a.company.localeCompare(b.company) || a.idName.localeCompare(b.idName),
    ),
  };
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
  assertLinkedinReportTeamScope(user, input.teamLeadId);

  const start = toUtcDayStartIso(input.startDate);
  const end = toUtcDayEndIso(input.endDate);

  const queries = [
    Query.greaterThanEqual("dateSent", start),
    Query.lessThanEqual("dateSent", end),
    Query.orderDesc("dateSent"),
    Query.orderDesc("$createdAt"),
    Query.limit(Math.min(Math.max(input.limit ?? 500, 1), 2000)),
  ];

  if (input.teamLeadId && input.teamLeadId !== "all") {
    queries.unshift(Query.equal("teamLeadId", input.teamLeadId));
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
  return Array.from(new Map(docs.map((r) => [r.$id, r] as const)).values());
}
