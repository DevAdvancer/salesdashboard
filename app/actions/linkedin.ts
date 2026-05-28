"use server";

import { ID, Permission, Query, Role } from "node-appwrite";
import { createAdminClient } from "@/lib/server/appwrite";
import {
  assertAuthenticatedUserId,
  getAuthenticatedUserDoc,
} from "@/lib/server/current-user";
import { COLLECTIONS, DATABASE_ID } from "@/lib/constants/appwrite";
import type {
  LinkedinAccount,
  LinkedinAccountType,
  LinkedinRequest,
  LinkedinRequestStatus,
  User,
} from "@/lib/types";

const LINKEDIN_ACCEPT_WINDOW_DAYS = 15;

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
  return user.role === "admin" || user.role === "team_lead";
}

function canSeeLinkedinReports(user: User) {
  return user.role === "admin" || user.role === "team_lead";
}

function assertLinkedinReportTeamScope(user: User, teamLeadId: string) {
  if (user.role === "admin") return;
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

  if (agent.role !== "agent") {
    throw new Error("Only agents can be assigned Linkedin IDs");
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
      Query.limit(25),
    ],
  );

  const docs = response.documents as Array<{
    isActive?: unknown;
    status?: unknown;
  }>;
  const isDuplicate = docs.some((doc) => {
    const isActive = doc.isActive !== false;
    const status = typeof doc.status === "string" ? doc.status : "";
    return isActive && status !== "withdrawn";
  });

  return { isDuplicate };
}

export async function createLinkedinRequestAction(input: {
  currentUserId: string;
  accountId: string;
  dateSent: string;
  targetUrl: string;
}) {
  await assertAuthenticatedUserId(input.currentUserId);
  const user = await getAuthenticatedUserDoc();

  const targetUrl = normalizeUrl(input.targetUrl);
  if (!targetUrl) {
    throw new Error("URL is required");
  }

  const dateSent = assertDateIso(input.dateSent);
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

  const alreadySentResponse = await databases.listDocuments(
    DATABASE_ID,
    COLLECTIONS.LINKEDIN_REQUESTS,
    [
      Query.equal("accountId", account.$id),
      Query.equal("dateSent", dateSent),
      Query.limit(2000),
    ],
  );
  const alreadySent = (alreadySentResponse.documents as Array<{
    status?: unknown;
    isActive?: unknown;
  }>).filter((doc) => {
    const status = typeof doc.status === "string" ? doc.status : "";
    const isActive = doc.isActive !== false;
    return isActive && status !== "withdrawn";
  }).length;

  if (alreadySent >= connectionLimit) {
    throw new Error(
      `Daily limit reached for this Linkedin ID (${connectionLimit}). Try another ID.`,
    );
  }

  try {
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
        status: "sent" satisfies LinkedinRequestStatus,
        acceptedAt: null,
        withdrawnAt: null,
        isActive: true,
      },
      [
        Permission.read(Role.user(user.$id)),
        Permission.update(Role.user(user.$id)),
        Permission.delete(Role.user(user.$id)),
        Permission.read(Role.label("admin")),
      ],
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
        agentId: user.$id,
        teamLeadId: user.teamLeadId || null,
      },
    });

    return doc as unknown as LinkedinRequest;
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

  if (existing.status !== "sent" || existing.isActive === false) {
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

  if (existing.status !== "sent" || existing.isActive === false) {
    throw new Error("Only active 'sent' requests can be withdrawn.");
  }

  const nowIso = new Date().toISOString();
  const daysPassed = daysBetweenUtc(existing.dateSent, nowIso);
  if (daysPassed < LINKEDIN_ACCEPT_WINDOW_DAYS) {
    const remaining = LINKEDIN_ACCEPT_WINDOW_DAYS - daysPassed;
    throw new Error(`You can withdraw after ${LINKEDIN_ACCEPT_WINDOW_DAYS} days. ${remaining} days left.`);
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
      withdrawnAt: nowIso,
    },
  });

  return updated as unknown as LinkedinRequest;
}

export async function listTeamLeadsForLinkedinAction(input: {
  currentUserId: string;
}) {
  await assertAuthenticatedUserId(input.currentUserId);
  const user = await getAuthenticatedUserDoc();
  if (user.role !== "admin") {
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

  if (user.role !== "admin" && user.role !== "team_lead") {
    throw new Error("Unauthorized");
  }

  if (user.role === "team_lead" && teamLeadId !== user.$id) {
    throw new Error("Unauthorized");
  }

  const { databases } = await createAdminClient();
  const response = await databases.listDocuments(DATABASE_ID, COLLECTIONS.USERS, [
    Query.equal("role", "agent"),
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
    if (agent.role !== "agent") {
      throw new Error("Only agents can be assigned Linkedin IDs");
    }
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
    teamLeadId: agent.teamLeadId || null,
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
  if (!canManageLinkedinAccounts(user)) {
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

  return response.documents as unknown as LinkedinAccount[];
}

export async function getLinkedinWeeklyReportAction(input: {
  currentUserId: string;
  teamLeadId: string;
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
      Query.equal("teamLeadId", input.teamLeadId),
      Query.greaterThanEqual("dateSent", startDate),
      Query.lessThanEqual("dateSent", endDate),
      Query.limit(pageSize),
      Query.orderAsc("$id"),
    ];
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

  const accountIds = Array.from(
    new Set(all.map((r) => r.accountId).filter(Boolean)),
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
    accepted: number;
    notAccepted: number;
    withdrawn: number;
  };

  const map = new Map<string, Row>();
  for (const req of all) {
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
      accepted: 0,
      notAccepted: 0,
      withdrawn: 0,
    };
    existing.sent += 1;
    const status = req.status;
    const isActive = req.isActive !== false;
    if (status === "accepted") {
      existing.accepted += 1;
    } else if (status === "withdrawn" || !isActive) {
      existing.withdrawn += 1;
    } else {
      existing.notAccepted += 1;
    }
    map.set(key, existing);
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
  teamLeadId: string;
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
    Query.equal("teamLeadId", input.teamLeadId),
    Query.greaterThanEqual("dateSent", start),
    Query.lessThanEqual("dateSent", end),
    Query.orderDesc("dateSent"),
    Query.orderDesc("$createdAt"),
    Query.limit(Math.min(Math.max(input.limit ?? 500, 1), 2000)),
  ];

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

  return response.documents as unknown as LinkedinRequest[];
}
