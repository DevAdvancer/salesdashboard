"use server";

import { Query } from "node-appwrite";
import { createAdminClient } from "@/lib/server/appwrite";
import { assertAuthenticatedUserId } from "@/lib/server/current-user";
import { COLLECTIONS, DATABASE_ID } from "@/lib/constants/appwrite";
import { isRoleEligibleForComponent } from "@/lib/constants/component-access";
import { listAllDocuments } from "@/lib/server/appwrite-pagination";
import type { ClientPaymentRecord, PaymentStatus, User, UserRole } from "@/lib/types";

type WeeklyReportRange = { from: string; to: string };

export type WeeklyReportMetrics = {
  calls: number;
  leads: number;
  followups: number;
  closures: number;
  upfront: number;
  coldCalls: number;
};

export type WeeklyReportMember = {
  user: User;
  metrics: WeeklyReportMetrics;
};

export type WeeklyReportTeam = {
  teamLead: User | null;
  members: WeeklyReportMember[];
  totals: WeeklyReportMetrics;
};

export type WeeklyReportResult = {
  range: WeeklyReportRange;
  teams: WeeklyReportTeam[];
};

type AuditLogDocument = {
  $id: string;
  action: string;
  actorId: string;
  actorName: string;
  targetId?: string | null;
  targetType: string;
  metadata?: string | null;
  performedAt: string;
};

type LeadDocument = {
  $id: string;
  data: string;
  ownerId: string;
  assignedToId?: string | null;
  isClosed: boolean;
  closedAt?: string | null;
  $createdAt: string;
};

type UserDocument = {
  $id: string;
  name: string;
  email: string;
  role: UserRole;
  teamLeadId?: string | null;
  branchIds?: string[];
  branchId?: string | null;
  department?: string;
  $createdAt: string;
  $updatedAt: string;
};

function ensureComponentAccess(role: UserRole, componentKey: Parameters<typeof isRoleEligibleForComponent>[0]) {
  if (!isRoleEligibleForComponent(componentKey, role)) {
    throw new Error("Not authorized");
  }
}

function mapUser(doc: UserDocument): User {
  const department: User["department"] =
    doc.department === "resume" || doc.department === "sales"
      ? doc.department
      : "sales";
  return {
    $id: doc.$id,
    name: doc.name,
    email: doc.email,
    role: doc.role,
    teamLeadId: doc.teamLeadId || null,
    branchIds: doc.branchIds || [],
    branchId: doc.branchId || null,
    department,
    $createdAt: doc.$createdAt,
    $updatedAt: doc.$updatedAt,
  };
}

function emptyMetrics(): WeeklyReportMetrics {
  return { calls: 0, leads: 0, followups: 0, closures: 0, upfront: 0, coldCalls: 0 };
}

function addMetrics(target: WeeklyReportMetrics, delta: Partial<WeeklyReportMetrics>) {
  target.calls += delta.calls ?? 0;
  target.leads += delta.leads ?? 0;
  target.followups += delta.followups ?? 0;
  target.closures += delta.closures ?? 0;
  target.upfront += delta.upfront ?? 0;
  target.coldCalls += delta.coldCalls ?? 0;
}

function getAttributedUserId(lead: Pick<LeadDocument, "assignedToId" | "ownerId">): string {
  return lead.assignedToId || lead.ownerId;
}

function normalizeSource(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

function isColdCallLead(dataJson: string): boolean {
  try {
    const data = JSON.parse(dataJson) as { source?: unknown; sourceName?: unknown };
    const normalized = normalizeSource(data.sourceName ?? data.source);
    return normalized.includes("coldcall");
  } catch {
    return false;
  }
}

function parseAuditMetadata(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "string") return null;
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function parseJsonValue<T>(value: unknown, fallback: T): T {
  if (typeof value !== "string") return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function isPaidStatus(status: PaymentStatus): boolean {
  return status === "partially_paid" || status === "fully_paid";
}

async function getActor(userId: string): Promise<User> {
  await assertAuthenticatedUserId(userId);
  const { databases } = await createAdminClient();
  const doc = (await databases.getDocument(DATABASE_ID, COLLECTIONS.USERS, userId)) as unknown as UserDocument;
  return mapUser(doc);
}

async function listTeamLeadAgents(databases: any, teamLeadId: string): Promise<User[]> {
  const docs = await listAllDocuments<UserDocument>({
    databases,
    databaseId: DATABASE_ID,
    collectionId: COLLECTIONS.USERS,
    queries: [
      Query.equal("teamLeadId", teamLeadId),
      Query.equal("role", "agent"),
      Query.orderAsc("$id"),
    ],
    pageLimit: 100,
    maxPages: 100,
  });

  return docs.map(mapUser).sort((a, b) => String(a.name).localeCompare(String(b.name)));
}

async function listScopedUsers(databases: any, actor: User): Promise<User[]> {
  if (actor.role === "agent") return [actor];

  if (actor.role === "team_lead") {
    const agents = await listTeamLeadAgents(databases, actor.$id);
    return [actor, ...agents];
  }

  const docs = await listAllDocuments<UserDocument>({
    databases,
    databaseId: DATABASE_ID,
    collectionId: COLLECTIONS.USERS,
    queries: [
      Query.or([Query.equal("role", "team_lead"), Query.equal("role", "agent")]),
      Query.orderAsc("$id"),
    ],
    pageLimit: 100,
    maxPages: 500,
  });

  return docs.map(mapUser).sort((a, b) => String(a.name).localeCompare(String(b.name)));
}

async function listLeadsCreatedInRange(databases: any, range: WeeklyReportRange): Promise<LeadDocument[]> {
  return listAllDocuments<LeadDocument>({
    databases,
    databaseId: DATABASE_ID,
    collectionId: COLLECTIONS.LEADS,
    queries: [
      Query.greaterThanEqual("$createdAt", range.from),
      Query.lessThanEqual("$createdAt", range.to),
      Query.orderAsc("$id"),
    ],
    pageLimit: 100,
    maxPages: 500,
  });
}

async function listClosedLeadsInRange(databases: any, range: WeeklyReportRange): Promise<LeadDocument[]> {
  return listAllDocuments<LeadDocument>({
    databases,
    databaseId: DATABASE_ID,
    collectionId: COLLECTIONS.LEADS,
    queries: [
      Query.equal("isClosed", true),
      Query.greaterThanEqual("closedAt", range.from),
      Query.lessThanEqual("closedAt", range.to),
      Query.orderAsc("$id"),
    ],
    pageLimit: 100,
    maxPages: 500,
  });
}

async function listAuditLogsInRange(databases: any, range: WeeklyReportRange): Promise<AuditLogDocument[]> {
  return listAllDocuments<AuditLogDocument>({
    databases,
    databaseId: DATABASE_ID,
    collectionId: COLLECTIONS.AUDIT_LOGS,
    queries: [
      Query.equal("action", "LEAD_UPDATE"),
      Query.equal("targetType", "LEAD"),
      Query.greaterThanEqual("performedAt", range.from),
      Query.lessThanEqual("performedAt", range.to),
      Query.orderAsc("$id"),
    ],
    pageLimit: 100,
    maxPages: 500,
  });
}

async function listClientPaymentsUpdatedInRange(databases: any, range: WeeklyReportRange): Promise<ClientPaymentRecord[]> {
  const docs = await listAllDocuments<any>({
    databases,
    databaseId: DATABASE_ID,
    collectionId: COLLECTIONS.CLIENT_PAYMENTS,
    queries: [
      Query.greaterThanEqual("updatedAt", range.from),
      Query.lessThanEqual("updatedAt", range.to),
      Query.orderAsc("$id"),
    ],
    pageLimit: 100,
    maxPages: 500,
  });

  return docs.map((doc) => {
    const updates = typeof doc.updates === "string" ? doc.updates : doc.updatesJson;
    const paymentPlan = typeof doc.paymentPlan === "string" ? doc.paymentPlan : doc.paymentPlanJson;
    const personalDetails =
      typeof doc.personalDetails === "string" ? doc.personalDetails : doc.personalDetailsJson;

    return {
      $id: doc.$id,
      leadId: doc.leadId,
      personalDetails: parseJsonValue(personalDetails, {}),
      paymentPlan: parseJsonValue(paymentPlan, { percent: 0, months: 0, upfrontAmount: 0 }),
      status: (doc.status as PaymentStatus) ?? "not_paid",
      updates: parseJsonValue(updates, []),
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt ?? null,
      lastReminderAt: doc.lastReminderAt ?? null,
      updatedById: doc.updatedById ?? null,
      updatedByName: doc.updatedByName ?? null,
    } satisfies ClientPaymentRecord;
  });
}

async function listLeadsByIds(databases: any, leadIds: string[]): Promise<Map<string, LeadDocument>> {
  const map = new Map<string, LeadDocument>();
  if (!leadIds || leadIds.length === 0) return map;
  const chunkSize = 25;
  const chunks: string[][] = [];
  for (let index = 0; index < leadIds.length; index += chunkSize) {
    chunks.push(leadIds.slice(index, index + chunkSize));
  }
  // Parallelize the chunks so wall-clock = slowest single chunk, not sum.
  const results = await Promise.all(
    chunks.map((chunk) =>
      listAllDocuments<LeadDocument>({
        databases,
        databaseId: DATABASE_ID,
        collectionId: COLLECTIONS.LEADS,
        queries: [Query.equal("$id", chunk), Query.orderAsc("$id")],
        pageLimit: 100,
        maxPages: 10,
      })
    )
  );
  for (const docs of results) {
    docs.forEach((doc) => map.set(doc.$id, doc));
  }
  return map;
}

export async function getWeeklyReportAction(input: {
  actorId: string;
  from: string;
  to: string;
}): Promise<WeeklyReportResult> {
  const actor = await getActor(input.actorId);
  ensureComponentAccess(actor.role, "reports");

  const range: WeeklyReportRange = { from: input.from, to: input.to };

  const { databases } = await createAdminClient();
  const scopedUsers = await listScopedUsers(databases, actor);
  const scopedUserIds = new Set(scopedUsers.map((user) => user.$id));

  const [createdLeads, closedLeads, auditLogs, paymentRecords] = await Promise.all([
    listLeadsCreatedInRange(databases, range),
    listClosedLeadsInRange(databases, range),
    listAuditLogsInRange(databases, range),
    listClientPaymentsUpdatedInRange(databases, range),
  ]);

  const metricsByUserId = new Map<string, WeeklyReportMetrics>();
  const ensureMetrics = (userId: string) => {
    const existing = metricsByUserId.get(userId);
    if (existing) return existing;
    const created = emptyMetrics();
    metricsByUserId.set(userId, created);
    return created;
  };

  createdLeads.forEach((lead) => {
    const attributed = getAttributedUserId(lead);
    if (!scopedUserIds.has(attributed)) return;
    addMetrics(ensureMetrics(attributed), { leads: 1 });
    if (isColdCallLead(lead.data)) {
      addMetrics(ensureMetrics(attributed), { coldCalls: 1 });
    }
  });

  closedLeads.forEach((lead) => {
    const attributed = getAttributedUserId(lead);
    if (!scopedUserIds.has(attributed)) return;
    addMetrics(ensureMetrics(attributed), { closures: 1 });
  });

  auditLogs.forEach((log) => {
    if (!scopedUserIds.has(log.actorId)) return;
    const metadata = parseAuditMetadata(log.metadata);
    if (!metadata || metadata.kind !== "FOLLOW_UP") return;
    const snapshot = (metadata.snapshot ?? null) as any;
    if (snapshot && snapshot.followUpStatus === "completed") {
      addMetrics(ensureMetrics(log.actorId), { calls: 1 });
    } else if (snapshot && snapshot.nextFollowUpAt) {
      addMetrics(ensureMetrics(log.actorId), { followups: 1 });
    }
  });

  const paymentLeadIds = Array.from(new Set(paymentRecords.map((record) => record.leadId).filter(Boolean)));
  const paymentLeadMap = paymentLeadIds.length > 0 ? await listLeadsByIds(databases, paymentLeadIds) : new Map();

  paymentRecords.forEach((record) => {
    const lead = paymentLeadMap.get(record.leadId);
    if (!lead) return;
    const attributed = getAttributedUserId(lead);
    if (!scopedUserIds.has(attributed)) return;

    const updates = Array.isArray(record.updates) ? record.updates : [];
    const sorted = updates.slice().sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
    const firstPaid = sorted.find((update) => update && isPaidStatus(update.status as PaymentStatus));
    if (!firstPaid) return;
    if (firstPaid.createdAt < range.from || firstPaid.createdAt > range.to) return;
    const upfrontAmount = Number(record.paymentPlan?.upfrontAmount ?? 0) || 0;
    if (upfrontAmount <= 0) return;
    addMetrics(ensureMetrics(attributed), { upfront: upfrontAmount });
  });

  scopedUsers.forEach((user) => ensureMetrics(user.$id));

  const userMap = new Map(scopedUsers.map((user) => [user.$id, user] as const));

  const buildMember = (userId: string): WeeklyReportMember => ({
    user: userMap.get(userId)!,
    metrics: metricsByUserId.get(userId) ?? emptyMetrics(),
  });

  const teams: WeeklyReportTeam[] = [];

  if (actor.role === "agent") {
    const totals = emptyMetrics();
    const member = buildMember(actor.$id);
    addMetrics(totals, member.metrics);
    teams.push({ teamLead: null, members: [member], totals });
    return { range, teams };
  }

  const teamLeads = scopedUsers
    .filter((user) => user.role === "team_lead")
    .sort((a, b) => String(a.name).localeCompare(String(b.name)));

  const seenMembers = new Set<string>();

  for (const teamLead of teamLeads) {
    const members = scopedUsers
      .filter((user) => user.$id === teamLead.$id || user.teamLeadId === teamLead.$id)
      .filter((user) => user.role === "team_lead" || user.role === "agent")
      .sort((a, b) => String(a.name).localeCompare(String(b.name)))
      .map((user) => {
        seenMembers.add(user.$id);
        return buildMember(user.$id);
      });

    const totals = emptyMetrics();
    members.forEach((member) => addMetrics(totals, member.metrics));
    teams.push({ teamLead, members, totals });
  }

  if (actor.role === "team_lead") {
    const only = teams.filter((team) => team.teamLead?.$id === actor.$id);
    return { range, teams: only.length > 0 ? only : teams.slice(0, 1) };
  }

  return { range, teams };
}
