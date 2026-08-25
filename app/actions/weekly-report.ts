"use server";

import { Query } from "node-appwrite";
import { createAdminClient } from "@/lib/server/appwrite";
import { assertAuthenticatedUserId } from "@/lib/server/current-user";
import { COLLECTIONS, DATABASE_ID } from "@/lib/constants/appwrite";
import { isRoleEligibleForComponent } from "@/lib/constants/component-access";
import { listAllDocuments } from "@/lib/server/appwrite-pagination";
import { buildWorkingDayKpi, toDateKey } from "@/lib/utils/report-kpi";
import type { ClientPaymentRecord, Department, Lead, PaymentStatus, User, UserRole } from "@/lib/types";
import { getTechnicalPaymentTotalsByUserAction } from "./technical-payments";
import { getCurrentEasternIsoDate } from "@/lib/utils/eastern-date";
import { computeAgentStatsForDate } from "@/lib/server/stats-aggregator";

type WeeklyReportRange = { from: string; to: string };

export type WeeklyReportMetrics = {
  calls: number;
  leads: number;
  followups: number;
  closures: number;
  upfront: number;
  coldCalls: number;
  notInterested: number;
  technicalUpfront: number;
  /** Per-day KPI breakdown for the selected range. */
  kpi: {
    /** ISO dates in the range, one per day. */
    daily: { date: string; done: boolean }[];
    /** How many days in the range had at least 1 lead. */
    daysMet: number;
    /** How many days in the range had zero leads. */
    daysMissed: number;
    /** Total days in the range (equals daily.length). */
    totalDays: number;
  };
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
  $createdAt: string;
  action: string;
  actorId: string;
  actorName: string;
  targetId?: string | null;
  targetType: string;
  metadata?: string | null;
};

type LeadDocument = {
  $id: string;
  data: string;
  ownerId: string;
  assignedToId?: string | null;
  isClosed: boolean;
  closedAt?: string | null;
  $createdAt: string;
  $updatedAt?: string;
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

function ensureSalesCrmAccess(user: User) {
  if (
    user.department === "resume" &&
    user.role !== "admin" &&
    user.role !== "developer" &&
    user.role !== "monitor" &&
    user.role !== "operations"
  ) {
    throw new Error("Resume users cannot access Sales CRM reports.");
  }
}

function normalizeDepartment(value: unknown): Department {
  return value === "resume" ? "resume" : "sales";
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
  return {
    calls: 0,
    leads: 0,
    followups: 0,
    closures: 0,
    upfront: 0,
    coldCalls: 0,
    notInterested: 0,
    technicalUpfront: 0,
    kpi: emptyKpi(),
  };
}

function emptyKpi(): WeeklyReportMetrics["kpi"] {
  return { daily: [], daysMet: 0, daysMissed: 0, totalDays: 0 };
}

/**
 * Per-day KPI summary for a single user: counts the days in the range
 * on which the user created at least one lead. A day with 0 leads is a
 * "missed" day. Weekends are excluded from the KPI target so monthly
 * and custom-range progress only reflects Monday-Friday working days.
 */
function buildKpi(
  range: WeeklyReportRange,
  userLeadDays: Set<string>,
): WeeklyReportMetrics["kpi"] {
  return buildWorkingDayKpi(range, userLeadDays);
}

function addMetrics(target: WeeklyReportMetrics, delta: Partial<WeeklyReportMetrics>) {
  target.calls += delta.calls ?? 0;
  target.leads += delta.leads ?? 0;
  target.followups += delta.followups ?? 0;
  target.closures += delta.closures ?? 0;
  target.upfront += delta.upfront ?? 0;
  target.coldCalls += delta.coldCalls ?? 0;
  target.notInterested += delta.notInterested ?? 0;
  target.technicalUpfront += delta.technicalUpfront ?? 0;
}

/**
 * Aggregates per-member KPI breakdowns into a team-level summary.
 * A day is "met" for the team if at least one member hit their daily
 * target that day; otherwise it's "missed" for the team.
 */
function combineKpi(members: WeeklyReportMember[]): WeeklyReportMetrics["kpi"] {
  if (members.length === 0) return emptyKpi();
  const allDates = new Set<string>();
  for (const member of members) {
    for (const day of member.metrics.kpi.daily) {
      allDates.add(day.date);
    }
  }
  const dates = Array.from(allDates).sort();
  if (dates.length === 0) return emptyKpi();
  const daily: { date: string; done: boolean }[] = [];
  let daysMet = 0;
  for (const date of dates) {
    const met = members.some((m) => m.metrics.kpi.daily.some((d) => d.date === date && d.done));
    if (met) daysMet += 1;
    daily.push({ date, done: met });
  }
  return { daily, daysMet, daysMissed: daily.length - daysMet, totalDays: daily.length };
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

/**
 * True when the lead's `data.source` / `data.sourceName` resolves to
 * "referral" (case- and separator-insensitive). The KPI helper excludes
 * these so referrals don't inflate the agent's working-day hit rate.
 */
function isReferralLead(dataJson: string): boolean {
  try {
    const data = JSON.parse(dataJson) as { source?: unknown; sourceName?: unknown };
    const normalized = normalizeSource(data.sourceName ?? data.source);
    return normalized === "referral";
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
      Query.or([Query.equal("role", "agent"), Query.equal("role", "lead_generation")]),
      Query.orderAsc("$id"),
    ],
    pageLimit: 100,
    maxPages: 100,
  });

  return docs
    .map(mapUser)
    .filter((user) => user.isActive).filter((user) => normalizeDepartment(user.department) === "sales")
    .sort((a, b) => String(a.name).localeCompare(String(b.name)));
}

async function listScopedUsers(databases: any, actor: User): Promise<User[]> {
  if (actor.role === "agent") return [actor];

  if (actor.role === "team_lead") {
    const agents = await listTeamLeadAgents(databases, actor.$id);
    // Also fetch any lead_generation users directly assigned to this TL
    // (listTeamLeadAgents now fetches both agent + lead_generation)
    return [actor, ...agents];
  }

  const docs = await listAllDocuments<UserDocument>({
    databases,
    databaseId: DATABASE_ID,
    collectionId: COLLECTIONS.USERS,
    queries: [
      Query.or([Query.equal("role", "team_lead"), Query.equal("role", "agent"), Query.equal("role", "lead_generation")]),
      Query.orderAsc("$id"),
    ],
    pageLimit: 100,
    maxPages: 500,
  });

  return docs
    .map(mapUser)
    .filter((user) => user.isActive).filter((user) => normalizeDepartment(user.department) === "sales")
    .sort((a, b) => String(a.name).localeCompare(String(b.name)));
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
  // Use $updatedAt instead of closedAt so older closed leads (which
  // predate the closedAt column being set) still show up — closing a
  // lead bumps $updatedAt even if closedAt is null. We further filter
  // by the closedAt / $updatedAt range in memory so a lead closed
  // before the range isn't counted.
  const docs = await listAllDocuments<LeadDocument>({
    databases,
    databaseId: DATABASE_ID,
    collectionId: COLLECTIONS.LEADS,
    queries: [
      Query.equal("isClosed", true),
      Query.greaterThanEqual("$updatedAt", range.from),
      Query.lessThanEqual("$updatedAt", range.to),
      Query.orderAsc("$id"),
    ],
    pageLimit: 100,
    maxPages: 500,
  });
  return docs.filter((lead) => {
    // Prefer closedAt; fall back to $updatedAt for older records.
    const closedAt = lead.closedAt ?? lead.$updatedAt;
    if (!closedAt) return false;
    return closedAt >= range.from && closedAt <= range.to;
  });
}

type NotInterestedEventDocument = {
  $id: string;
  leadId: string;
  previousOwnerId: string;
  previousAssignedToId?: string | null;
  markedAt: string;
  // Optional because some Appwrite instances of not_interested_leads
  // predate the column. Treated as "active" when missing.
  status?: "active" | "reopened";
};

async function listNotInterestedEventsInRange(
  databases: any,
  range: WeeklyReportRange,
): Promise<NotInterestedEventDocument[]> {
  // The `status` column on not_interested_leads is optional in some
  // production instances (older Appwrite setups predate the field), so
  // we filter the active/reopened split in memory below rather than via
  // a Query.equal that would 400 against schemas without the attribute.
  const docs = await listAllDocuments<NotInterestedEventDocument>({
    databases,
    databaseId: DATABASE_ID,
    collectionId: COLLECTIONS.NOT_INTERESTED_LEADS,
    queries: [
      Query.greaterThanEqual("markedAt", range.from),
      Query.lessThanEqual("markedAt", range.to),
      Query.orderAsc("$id"),
    ],
    pageLimit: 100,
    maxPages: 500,
  });
  return docs.filter((doc) => {
    // Only count events that haven't been reopened. Missing `status` is
    // treated as active for compatibility with older collections.
    return !doc.status || doc.status === "active";
  });
}

async function listAuditLogsInRange(databases: any, range: WeeklyReportRange): Promise<AuditLogDocument[]> {
  // Audit logs are currently disabled and the collection ID is empty ("").
  // Attempting to query an empty collection ID will throw an Appwrite exception, crashing the report.
  return [];
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

async function listFollowupPaymentsInRange(databases: any, range: WeeklyReportRange): Promise<any[]> {
  const fromDate = range.from.substring(0, 10);
  const toDate = range.to.substring(0, 10);
  return listAllDocuments<any>({
    databases,
    databaseId: DATABASE_ID,
    collectionId: COLLECTIONS.PREVIOUS_FOLLOWUPS_PAYMENTS,
    queries: [
      Query.greaterThanEqual("date", fromDate),
      Query.lessThanEqual("date", toDate),
      Query.orderAsc("$id"),
    ],
    pageLimit: 100,
    maxPages: 500,
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
  ensureSalesCrmAccess(actor);
  ensureComponentAccess(actor.role, "reports");

  const range: WeeklyReportRange = { from: input.from, to: input.to };

  const { databases } = await createAdminClient();

  const branchesResponse = await databases.listDocuments(DATABASE_ID, COLLECTIONS.BRANCHES, [
    Query.select(["$id", "name"]),
    Query.limit(100),
  ]);
  const branchMap = new Map<string, string>();
  (branchesResponse.documents as any[]).forEach((b) => branchMap.set(b.$id, b.name));

  const scopedUsers = await listScopedUsers(databases, actor);
  const scopedUserIds = new Set(scopedUsers.map((user) => user.$id));

  const stats = await listAllDocuments<any>({
    databases,
    databaseId: DATABASE_ID,
    collectionId: COLLECTIONS.AGENT_DAILY_STATS,
    queries: [
      Query.greaterThanEqual("dateKey", range.from.slice(0, 10)),
      Query.lessThanEqual("dateKey", range.to.slice(0, 10)),
      Query.orderAsc("$id"),
    ],
    pageLimit: 100,
    maxPages: 500,
  });

  const todayIso = getCurrentEasternIsoDate();
  const fromIso = range.from.slice(0, 10);
  const toIso = range.to.slice(0, 10);
  if (fromIso <= todayIso && toIso >= todayIso) {
    const todayStats = await computeAgentStatsForDate(todayIso);
    stats.push(...todayStats);
  }

  const [auditLogs, followupRecords] = await Promise.all([
    listAuditLogsInRange(databases, range),
    listFollowupPaymentsInRange(databases, range),
  ]);

  const followupLeadIds = Array.from(new Set(
    followupRecords
      .map(d => typeof d.leadId === "string" ? d.leadId : "")
      .filter(id => id && !id.startsWith("manual_followup:"))
  ));
  
  const followupLeadById = new Map<string, LeadDocument>();
  if (followupLeadIds.length > 0) {
    const CHUNK = 100;
    for (let i = 0; i < followupLeadIds.length; i += CHUNK) {
      const chunk = followupLeadIds.slice(i, i + CHUNK);
      const ldocs = await listAllDocuments<LeadDocument>({
        databases,
        databaseId: DATABASE_ID,
        collectionId: COLLECTIONS.LEADS,
        queries: [Query.equal("$id", chunk), Query.limit(CHUNK)],
        pageLimit: CHUNK,
        maxPages: 1,
      });
      for (const d of ldocs) followupLeadById.set(d.$id, d);
    }
  }

  const metricsByUserId = new Map<string, WeeklyReportMetrics>();
  const leadDaysByUserId = new Map<string, Set<string>>();
  const ensureMetrics = (userId: string) => {
    const existing = metricsByUserId.get(userId);
    if (existing) return existing;
    const created = emptyMetrics();
    metricsByUserId.set(userId, created);
    return created;
  };
  const ensureLeadDays = (userId: string) => {
    const existing = leadDaysByUserId.get(userId);
    if (existing) return existing;
    const created = new Set<string>();
    leadDaysByUserId.set(userId, created);
    return created;
  };

  stats.forEach((stat) => {
    if (!scopedUserIds.has(stat.agentId)) return;
    addMetrics(ensureMetrics(stat.agentId), {
      leads: stat.leadsGenerated || 0,
      closures: stat.leadsClosed || 0,
      upfront: 0,
      technicalUpfront: 0,
      coldCalls: stat.coldCallsGenerated || 0,
      notInterested: stat.notInterestedMarked || 0,
    });
    
    const leadsGen = stat.leadsGenerated || 0;
    const refsGen = stat.referralsGenerated || 0;
    if (leadsGen - refsGen > 0) {
      ensureLeadDays(stat.agentId).add(stat.dateKey);
    }
  });

  auditLogs.forEach((log) => {
    if (!scopedUserIds.has(log.actorId)) return;
    const metadata = parseAuditMetadata(log.metadata);
    if (!metadata || metadata.kind !== "FOLLOW_UP") return;
    const snapshot = (metadata.snapshot ?? null) as any;
    if (snapshot && snapshot.nextAction === "Call") {
      addMetrics(ensureMetrics(log.actorId), { calls: 1 });
    } else if (snapshot && snapshot.nextFollowUpAt) {
      addMetrics(ensureMetrics(log.actorId), { followups: 1 });
    }
  });

  followupRecords.forEach((record) => {
    const leadId = typeof record.leadId === "string" ? record.leadId : "";
    const amount = Number(record.amount) || 0;
    if (!leadId || amount <= 0) return;

    let targetAgentId = "";

    const creditedAgentId = typeof record.creditedAgentId === "string" && record.creditedAgentId.trim() !== "" ? record.creditedAgentId : null;

    if (leadId.startsWith("manual_followup:")) {
      const createdById = typeof record.createdById === "string" ? record.createdById : "";
      targetAgentId = creditedAgentId || createdById;
    } else {
      const lead = followupLeadById.get(leadId);
      if (lead) {
        const ownerId = typeof lead.ownerId === "string" ? lead.ownerId : "";
        const assignedToId = typeof lead.assignedToId === "string" ? lead.assignedToId : "";
        targetAgentId = creditedAgentId || assignedToId || ownerId;
      }
    }

    if (!targetAgentId || !scopedUserIds.has(targetAgentId)) return;
    
    addMetrics(ensureMetrics(targetAgentId), { upfront: amount });
  });

  // Dynamically calculate Upfront Client Payments for the range
  const clientPayments = await listAllDocuments<Record<string, unknown>>({
    databases,
    databaseId: DATABASE_ID,
    collectionId: COLLECTIONS.CLIENT_PAYMENTS,
    queries: [
      Query.greaterThanEqual("updatedAt", range.from),
      Query.lessThanEqual("updatedAt", range.to),
    ],
    pageLimit: 100,
    maxPages: 200,
  });

  const cpLeadIds = Array.from(new Set(clientPayments.map((p) => typeof p.leadId === "string" ? p.leadId : "").filter(Boolean)));
  const cpLeadById = new Map<string, Record<string, unknown>>();
  if (cpLeadIds.length > 0) {
    const CHUNK = 100;
    for (let i = 0; i < cpLeadIds.length; i += CHUNK) {
      const chunk = cpLeadIds.slice(i, i + CHUNK);
      const ldocs = await listAllDocuments<Record<string, unknown>>({
        databases,
        databaseId: DATABASE_ID,
        collectionId: COLLECTIONS.LEADS,
        queries: [Query.equal("$id", chunk), Query.limit(CHUNK)],
        pageLimit: CHUNK,
        maxPages: 1,
      });
      for (const d of ldocs) cpLeadById.set(d.$id as string, d);
    }
  }

  for (const cp of clientPayments) {
    const leadId = cp.leadId as string;
    const lead = cpLeadById.get(leadId);
    if (!lead) continue;

    const ownerId = lead.ownerId as string | undefined;
    const assignedToId = lead.assignedToId as string | undefined;
    const attributedTo = assignedToId || ownerId;

    const leadCreated = (lead.closedAt as string) || (lead.$createdAt as string) || (lead.createdAt as string);
    if (leadCreated && leadCreated < range.from) {
      continue; // Payments for leads closed before range are followups, not upfront
    }

    let updates: { createdAt?: string; amount?: number; status?: string; actorId?: string }[] = [];
    try {
      const raw = cp.updates ?? cp.updatesJson;
      updates = JSON.parse(typeof raw === "string" ? raw : "[]");
      if (!Array.isArray(updates)) updates = [];
    } catch {
      updates = [];
    }

    let totalForLead = 0;
    const agentTotals = new Map<string, number>();

    for (const u of updates) {
      if (
        u.createdAt &&
        u.createdAt >= range.from &&
        u.createdAt <= range.to &&
        (u.status === "partially_paid" || u.status === "fully_paid")
      ) {
        if (attributedTo) {
          const amount = Number(u.amount) || 0;
          if (amount > 0) {
            agentTotals.set(attributedTo, (agentTotals.get(attributedTo) ?? 0) + amount);
            totalForLead += amount;
          }
        }
      }
    }

    if (totalForLead === 0 && updates.length === 0) {
      const createdAt = cp.createdAt as string | undefined;
      if (
        createdAt &&
        createdAt >= range.from &&
        createdAt <= range.to &&
        ((cp.status as string) === "partially_paid" || (cp.status as string) === "fully_paid")
      ) {
        if (attributedTo) {
          let plan: { upfrontAmount?: number } = {};
          try {
            plan = JSON.parse(typeof (cp.paymentPlan ?? cp.paymentPlanJson) === "string" ? (cp.paymentPlan ?? cp.paymentPlanJson) as string : "{}");
          } catch { /* ignore */ }
          const amount = Number(plan.upfrontAmount) || 0;
          if (amount > 0) {
            agentTotals.set(attributedTo, (agentTotals.get(attributedTo) ?? 0) + amount);
          }
        }
      }
    }

    for (const [agentId, amount] of agentTotals.entries()) {
      if (scopedUserIds.has(agentId)) {
        addMetrics(ensureMetrics(agentId), { upfront: amount });
      }
    }
  }

  // Technical payments in the window
  const technicalPaymentsByAgentId = await getTechnicalPaymentTotalsByUserAction({
    actorId: actor.$id,
    dateFrom: range.from,
    dateTo: range.to,
  });

  for (const [agentId, amount] of Object.entries(technicalPaymentsByAgentId)) {
    if (scopedUserIds.has(agentId)) {
      addMetrics(ensureMetrics(agentId), { technicalUpfront: amount });
    }
  }

  scopedUsers.forEach((user) => ensureMetrics(user.$id));

  const userMap = new Map(scopedUsers.map((user) => [user.$id, user] as const));

  const buildMember = (userId: string): WeeklyReportMember => {
    const metrics = metricsByUserId.get(userId) ?? emptyMetrics();
    return {
      user: userMap.get(userId)!,
      metrics: {
        ...metrics,
        kpi: buildKpi(range, leadDaysByUserId.get(userId) ?? new Set<string>()),
      },
    };
  };

  const teams: WeeklyReportTeam[] = [];

  if (actor.role === "agent") {
    const member = buildMember(actor.$id);
    const totals: WeeklyReportMetrics = {
      ...emptyMetrics(),
      kpi: member.metrics.kpi,
    };
    addMetrics(totals, member.metrics);
    teams.push({ teamLead: null, members: [member], totals });
    return { range, teams };
  }

  const teamLeads = scopedUsers
    .filter((user) => user.role === "team_lead")
    .sort((a, b) => String(a.name).localeCompare(String(b.name)));

  const seenMembers = new Set<string>();

  for (const teamLead of teamLeads) {
    const teamMembers = scopedUsers
      .filter((user) => user.$id === teamLead.$id || user.teamLeadId === teamLead.$id)
      .filter((user) => user.role === "team_lead" || user.role === "agent" || user.role === "lead_generation")
      .sort((a, b) => String(a.name).localeCompare(String(b.name)));

    const agentsByBranch = new Map<string, User[]>();
    teamMembers.forEach((user) => {
      const branchId = (user.branchIds && user.branchIds.length > 0) ? user.branchIds[0] : (user.branchId || "unassigned");
      const existing = agentsByBranch.get(branchId) || [];
      existing.push(user);
      agentsByBranch.set(branchId, existing);
    });

    if (agentsByBranch.size === 0) {
      agentsByBranch.set("unassigned", []);
    }

    for (const [branchId, branchUsers] of agentsByBranch.entries()) {
      const branchName = branchMap.get(branchId) || "Unassigned Branch";
      const suffix = agentsByBranch.size > 1 || branchId !== "unassigned" ? ` - ${branchName}` : "";

      const members = branchUsers.map((user) => {
        seenMembers.add(user.$id);
        return buildMember(user.$id);
      });

      const totals: WeeklyReportMetrics = {
        calls: 0,
        leads: 0,
        followups: 0,
        closures: 0,
        upfront: 0,
        coldCalls: 0,
        notInterested: 0,
        technicalUpfront: 0,
        kpi: combineKpi(members),
      };
      members.forEach((member) => addMetrics(totals, member.metrics));
      
      const tlWithSuffix = {
        ...teamLead,
        name: `${teamLead.name}${suffix}`,
      };

      teams.push({ teamLead: tlWithSuffix, members, totals });
    }
  }



  if (actor.role === "team_lead") {
    const only = teams.filter((team) => team.teamLead?.$id === actor.$id);
    return { range, teams: only.length > 0 ? only : teams.slice(0, 1) };
  }

  return { range, teams };
}
