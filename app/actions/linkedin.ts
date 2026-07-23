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
  shouldAutoWithdrawLinkedinRequest,
  LINKEDIN_ACCEPTED_AUTO_WITHDRAW_DAYS,
  LINKEDIN_SENT_AUTO_WITHDRAW_DAYS,
} from "@/lib/utils/linkedin-withdrawal-reminders";
import { workingDaysInRange } from "@/lib/utils/dashboard-kpi";
import { listAllDocuments } from "@/lib/server/appwrite-pagination";
import { expandIsoDateToEnd, expandIsoDateToStart } from "@/lib/utils/iso-date-range";
import { listHolidayDateKeys } from "@/lib/server/holiday-calendar";
import {
  getAgentsByTeamLead,
  getAssignableUsers,
  getUserByIdOrNull,
} from "@/lib/services/user-service";

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
  return user.role === "admin" || user.role === "developer" || user.role === "team_lead";
}

function canSeeLinkedinReports(user: User) {
  return user.role === "admin" || user.role === "developer" || user.role === "monitor" || user.role === "operations" || user.role === "team_lead";
}

function canReadLinkedinAccountsLikeAdmin(user: User) {
  return user.role === "admin" || user.role === "developer" || user.role === "monitor" || user.role === "operations";
}

function resolveLinkedinReportTeamLeadId(user: User, teamLeadId?: string | null) {
  if (user.role === "team_lead") {
    return user.$id;
  }

  return teamLeadId ?? null;
}

function assertLinkedinReportTeamScope(user: User, teamLeadId?: string | null) {
  if (canReadLinkedinAccountsLikeAdmin(user)) return;
  if (user.role === "team_lead" && user.$id === resolveLinkedinReportTeamLeadId(user, teamLeadId)) return;
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

async function getTeamLeadAssignedUserIds(
  databases: Awaited<ReturnType<typeof createAdminClient>>["databases"],
  assignedUserIds: string[],
) {
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

  if (account.isActive === false) {
    throw new Error(
      "This Linkedin ID is currently inactive. Please ask Team Lead/Admin to activate it.",
    );
  }

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

  // Some requests may have had their leadId cleared (e.g., after a "Not Interested"
  // sync reopens the request). To still surface the lead-related events in the
  // history, fall back to looking up the leadId from the LINKEDIN_REQUEST_LINK_LEAD
  // audit log associated with each request.
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
    (u) => (u.department ?? "sales") === "sales" && u.isActive !== false,
  );
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

  return (response.documents as unknown as User[]).filter(
    (u) => (u.department ?? "sales") === "sales" && u.isActive !== false,
  );
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

  // Team leads can only toggle accounts for their own team
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

async function getSalesUserIds(
  databases: Awaited<ReturnType<typeof createAdminClient>>["databases"],
  userIds: string[],
) {
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
  const effectiveTeamLeadId = resolveLinkedinReportTeamLeadId(user, input.teamLeadId);
  assertLinkedinReportTeamScope(user, effectiveTeamLeadId);

  const startDate = expandIsoDateToStart(input.startDate);
  const endDate = expandIsoDateToEnd(input.endDate);

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
    if (effectiveTeamLeadId && effectiveTeamLeadId !== "all") {
      queries.unshift(Query.equal("teamLeadId", effectiveTeamLeadId));
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
  const agentIds = Array.from(
    new Set(uniqueRequests.map((r) => r.agentId).filter(Boolean)),
  );
  const salesAgentIds = await getSalesUserIds(databases, agentIds);
  const salesRequests = uniqueRequests.filter((r) => salesAgentIds.has(r.agentId));

  const visibleRequests =
    user.role === "team_lead"
      ? salesRequests.filter((request) => request.agentId !== user.$id)
      : salesRequests;

  const accountIds = Array.from(
    new Set(visibleRequests.map((r) => r.accountId).filter(Boolean)),
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
  for (const req of visibleRequests) {
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

  // Do not filter out the team lead's own requests
  const finalDocs = salesDocs;

  // Fetch Accounts
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

  // Fetch missing main accounts to ensure we can name sheets properly
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

  // Fetch Leads
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

  // Map to flat export format
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

function parseIsoDateLocal(iso: string): Date {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function daysInMonthLocal(isoDate: string): number {
  const date = parseIsoDateLocal(isoDate);
  return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
}

async function resolveScopeUsersForLinkedin(input: {
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

  // admin / developer / monitor / operations
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

export async function loadLinkedinConnectionKpiAction(input: {
  userId: string;
  role: string;
  teamLeadId?: string;
  branchIds?: string[];
  dateRange: { from?: string; to?: string };
}): Promise<LinkedinConnectionKpiRow[]> {
  await assertAuthenticatedUserId(input.userId);
  const { databases } = await createAdminClient();

  const scopeUsers = await resolveScopeUsersForLinkedin({
    userId: input.userId,
    role: input.role,
    teamLeadId: input.teamLeadId,
    branchIds: input.branchIds,
  });

  if (scopeUsers.length === 0) {
    return [];
  }

  // Fetch active LinkedIn accounts
  const accountsRes = await databases.listDocuments(
    DATABASE_ID,
    COLLECTIONS.LINKEDIN_ACCOUNTS,
    [
      Query.equal("isActive", true),
      Query.limit(2000),
    ]
  );
  const allAccounts = (accountsRes.documents as unknown as LinkedinAccount[]).filter(
    (acc) => scopeUsers.some((u) => u.$id === acc.assignedUserId)
  );

  if (allAccounts.length === 0) {
    return [];
  }

  // Fetch connection requests within the date range
  const queries: string[] = [];
  if (input.dateRange.from) {
    queries.push(Query.greaterThanEqual("dateSent", expandIsoDateToStart(input.dateRange.from)));
  }
  if (input.dateRange.to) {
    queries.push(Query.lessThanEqual("dateSent", expandIsoDateToEnd(input.dateRange.to)));
  }
  queries.push(Query.orderDesc("dateSent"));
  queries.push(Query.select(['$id', 'accountId', 'isActive', 'status', 'dateSent']));

  const allRequests = await listAllDocuments<LinkedinRequest>({
    databases,
    databaseId: DATABASE_ID,
    collectionId: COLLECTIONS.LINKEDIN_REQUESTS,
    queries,
    pageLimit: 100,
    maxPages: 500,
  });

  const activeRequests = allRequests.filter((doc) => {
    const isActive = doc.isActive ?? true;
    return isActive && doc.status !== "withdrawn";
  });

  const fromIso = input.dateRange.from;
  const toIso = input.dateRange.to ?? input.dateRange.from;
  const holidayDateKeys =
    fromIso && toIso
      ? await listHolidayDateKeys({ databases, from: fromIso, to: toIso })
      : [];
  const singleDay = Boolean(fromIso && toIso && fromIso === toIso);
  let daysCount: number;
  let mode: "daily" | "monthly";

  if (singleDay) {
    daysCount = workingDaysInRange(fromIso!, toIso!, holidayDateKeys);
    mode = "daily";
  } else if (fromIso && toIso) {
    daysCount = workingDaysInRange(fromIso, toIso, holidayDateKeys);
    mode = "monthly";
  } else {
    const effectiveDate = toIso ?? new Date().toISOString().slice(0, 10);
    daysCount = daysInMonthLocal(effectiveDate);
    mode = "monthly";
  }

  // Group by userId (User)
  const userRowsMap = new Map<string, {
    userId: string;
    userName: string;
    sentCount: number;
    target: number;
    companies: string[];
    idNames: string[];
  }>();

  for (const account of allAccounts) {
    const user = scopeUsers.find((u) => u.$id === account.assignedUserId);
    const userId = account.assignedUserId;
    const userName = user?.name ?? "Unknown";
    const sentCount = activeRequests.filter((req) => req.accountId === account.$id).length;
    const target = (account.connectionLimit ?? 0) * daysCount;

    const existing = userRowsMap.get(userId) ?? {
      userId,
      userName,
      sentCount: 0,
      target: 0,
      companies: [],
      idNames: [],
    };

    existing.sentCount += sentCount;
    existing.target += target;
    if (account.company) existing.companies.push(account.company);
    if (account.idName) existing.idNames.push(account.idName);

    userRowsMap.set(userId, existing);
  }

  const kpiRows = Array.from(userRowsMap.values()).map((u) => {
    const uniqCompanies = Array.from(new Set(u.companies));
    const uniqIdNames = Array.from(new Set(u.idNames));
    return {
      accountId: u.userId, // use userId as the unique key
      idName: u.userName,
      company: uniqCompanies.length > 0 ? uniqCompanies.join(", ") : "LinkedIn",
      userName: u.userName,
      userId: u.userId,
      sentCount: u.sentCount,
      target: u.target,
      mode,
      idNames: uniqIdNames,
    };
  });

  // Sort: underperformers first, then by name
  kpiRows.sort((a, b) => {
    const aMet = a.target > 0 && a.sentCount >= a.target;
    const bMet = b.target > 0 && b.sentCount >= b.target;
    if (aMet !== bMet) return aMet ? 1 : -1;
    const aGap = a.target - a.sentCount;
    const bGap = b.target - b.sentCount;
    if (aGap !== bGap) return bGap - aGap;
    return a.idName.localeCompare(b.idName);
  });

  return kpiRows;
}

// ---------------------------------------------------------------------------
// Auto-withdraw server action (admin / operations only)
// ---------------------------------------------------------------------------

export type AutoWithdrawResult = {
  evaluated: number;
  autoWithdrawn: number;
  errors: number;
  processedAt: string;
};

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

  const isAllowed =
    actor.role === "admin" ||
    actor.role === "developer" ||
    actor.role === "operations" ||
    actor.role === "monitor";

  if (!isAllowed) {
    throw new Error("Only admins can run auto-withdraw.");
  }

  const { databases } = await createAdminClient();
  const now = new Date();
  const nowIso = now.toISOString();

  // Fetch all active sent/accepted requests
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

