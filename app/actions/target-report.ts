"use server";

import { Query } from "node-appwrite";
import { COLLECTIONS, DATABASE_ID } from "@/lib/constants/appwrite";
import { createAdminClient } from "@/lib/server/appwrite";
import { assertAuthenticatedUserId } from "@/lib/server/current-user";
import { listAllDocuments } from "@/lib/server/appwrite-pagination";
import { isRoleEligibleForComponent } from "@/lib/constants/component-access";
import {
  buildTargetReport,
  type LeadPaymentSnapshot,
  type TargetReportResult,
} from "@/lib/utils/monthly-target-report";
import type { ClientPaymentPlan, ClientPaymentUpdate, Lead, User } from "@/lib/types";
import { getAgentsByTeamLead, getAssignableUsers, getUserByIdOrNull } from "@/lib/services/user-service";
import { listMonthlyTargetsWithAssignmentsAction } from "@/app/actions/monthly-targets";
import { getTechnicalPaymentTotalsByUserAction } from "@/app/actions/technical-payments";
import { getCurrentEasternIsoDate } from "@/lib/utils/eastern-date";
import { computeAgentStatsForDate } from "@/lib/server/stats-aggregator";

type LeadDoc = Record<string, unknown>;
type UserDoc = Record<string, unknown>;

/**
 * Refuse resume-department users from reading the sales target report.
 * Mirrors `ensureSalesCrmAccess` in app/actions/weekly-report.ts so
 * both reports enforce the same rule: admin/developer/monitor/operations
 * may read either, but a regular TL / agent / lead_generation in the
 * resume department cannot reach sales data.
 */
function ensureSalesCrmAccess(user: User): void {
  if (
    user.department === "resume" &&
    user.role !== "admin" &&
    user.role !== "developer" &&
    user.role !== "monitor" &&
    user.role !== "operations"
  ) {
    throw new Error("Resume users cannot access the sales target report.");
  }
}

// ─── Helpers (mirrored from app/actions/client-payments.ts) ──────────────

function parseJsonOr<T>(value: unknown, fallback: T): T {
  if (typeof value !== "string") return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

/**
 * Returns the per-month start / end ISO date strings (inclusive) for
 * a YYYY-MM monthKey, computed in UTC.
 */
function monthBounds(monthKey: string): { from: string; to: string } {
  if (!/^\d{4}-\d{2}$/.test(monthKey)) {
    throw new Error("Invalid month. Use YYYY-MM.");
  }
  const [yearStr, monthStr] = monthKey.split("-");
  const year = Number(yearStr);
  const month = Number(monthStr);
  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) {
    throw new Error("Invalid month. Use YYYY-MM.");
  }
  // Use the first of the next month, minus 1ms, as the inclusive end.
  const start = new Date(Date.UTC(year, month - 1, 1));
  const end = new Date(Date.UTC(year, month, 0));
  return {
    from: start.toISOString().slice(0, 10),
    to: end.toISOString().slice(0, 10),
  };
}

// ─── Read action ────────────────────────────────────────────────────────

/**
 * Build the full target-report payload for the calling actor.
 *
 * Steps:
 *   1. Resolve the readable agent set (admin: every agent/lead_generation,
 *      TL: self + their agents, agent: self only).
 *   2. Fetch every lead owned by those agents.
 *   3. Fetch the corresponding client_payments and compute the paid
 *      amount per lead (sum of `updates[].amount`, fallback to
 *      `paymentPlan.upfrontAmount`).
 *   4. Fetch the monthly_targets for the month + the matching
 *      monthly_target_assignments.
 *   5. Hand everything to `buildTargetReport` for the pure calculation.
 */
export async function getTargetReportAction(input: {
  actorId: string;
  monthKey: string;
}): Promise<{ result: TargetReportResult; monthLabel: string }> {
  const { databases } = await createAdminClient();

  if (!/^\d{4}-\d{2}$/.test(input.monthKey)) {
    throw new Error("Invalid month. Use YYYY-MM.");
  }
  await assertAuthenticatedUserId(input.actorId);
  const userDoc = await databases
    .getDocument(DATABASE_ID, COLLECTIONS.USERS, input.actorId)
    .catch(() => null);
  if (!userDoc) throw new Error("User not found");
  const actor: User = {
    $id: userDoc.$id,
    name: userDoc.name,
    email: userDoc.email,
    role: userDoc.role,
    teamLeadId: userDoc.teamLeadId || null,
    branchIds: userDoc.branchIds || [],
    branchId: userDoc.branchId || null,
    // Default to "sales" when the user doc doesn't carry a department —
    // matches `normalizeDepartment` in lib/services/user-service.ts so
    // the access guard below treats un-set departments as sales.
    department: userDoc.department === "resume" ? "resume" : "sales",
    $createdAt: userDoc.$createdAt,
    $updatedAt: userDoc.$updatedAt,
  };

  if (!isRoleEligibleForComponent("target-report", actor.role)) {
    throw new Error("Not authorized");
  }

  // The Target Report is sales-only. A resume-department user with an
  // eligible role still cannot reach this code path — same rule the
  // Weekly Report enforces in `ensureSalesCrmAccess`.
  ensureSalesCrmAccess(actor);

  // 1. Targets + assignments.
  const { targets, assignmentsByTargetId } = await listMonthlyTargetsWithAssignmentsAction({
    actorId: actor.$id,
    monthKey: input.monthKey,
  });

  // 2. Readable agent set (sales-only).
  let readableAgentIds: string[];
  if (actor.role === "agent" || actor.role === "lead_generation") {
    readableAgentIds = [actor.$id];
  } else if (actor.role === "team_lead") {
    // Sales-only — getAgentsByTeamLead with "sales" scope drops any
    // resume agent in the TL's team from the report.
    const agents = await getAgentsByTeamLead(actor.$id, "sales");
    const target = targets.find(t => t.teamLeadId === actor.$id);
    const assignedIds = target ? (assignmentsByTargetId[target.$id]?.map(a => a.agentId) || []) : [];
    readableAgentIds = Array.from(new Set([actor.$id, ...agents.map((a) => a.$id), ...assignedIds]));
  } else {
    // Admin-like: scope to sales so the team table never surfaces
    // resume TLs / agents.
    const all = await getAssignableUsers(actor.role, actor.branchIds ?? [], actor.$id, "sales");
    const assignedIds = Object.values(assignmentsByTargetId).flatMap(list => list.map(a => a.agentId));
    readableAgentIds = Array.from(new Set([
      ...all.filter((u) => u.role === "agent" || u.role === "lead_generation" || u.role === "team_lead").map((u) => u.$id),
      ...assignedIds
    ]));
  }

  // 2. Fetch daily stats for the agents (only for leads/referrals/NI counts)
  const { from: monthFromIso, to: monthToIso } = monthBounds(input.monthKey);
  const monthStartIso = `${monthFromIso}T00:00:00.000Z`;
  const monthEndIso = `${monthToIso}T23:59:59.999Z`;
  const todayIso = getCurrentEasternIsoDate();

  const agentStatsByUserId: Record<string, {
    achieved: number;
    leadCount: number;
    referralExcludedCount: number;
    notInterestedCount: number;
  }> = {};

  const CHUNK = 100;
  for (let i = 0; i < readableAgentIds.length; i += CHUNK) {
    const chunk = readableAgentIds.slice(i, i + CHUNK);
    const docs = await listAllDocuments<any>({
      databases,
      databaseId: DATABASE_ID,
      collectionId: COLLECTIONS.AGENT_DAILY_STATS,
      queries: [
        Query.equal("agentId", chunk),
        Query.greaterThanEqual("dateKey", monthFromIso),
        Query.lessThanEqual(
          "dateKey",
          monthToIso >= todayIso ? (() => {
            const d = new Date(todayIso);
            d.setUTCDate(d.getUTCDate() - 1);
            return d.toISOString().slice(0, 10);
          })() : monthToIso
        ),
        Query.orderAsc("$id"),
      ],
      pageLimit: 100,
      maxPages: 200,
    });
    for (const doc of docs) {
      if (!agentStatsByUserId[doc.agentId]) {
        agentStatsByUserId[doc.agentId] = {
          achieved: 0,
          leadCount: 0,
          referralExcludedCount: 0,
          notInterestedCount: 0,
        };
      }
      agentStatsByUserId[doc.agentId].leadCount += doc.leadsGenerated || 0;
      agentStatsByUserId[doc.agentId].referralExcludedCount += doc.referralsGenerated || 0;
      agentStatsByUserId[doc.agentId].notInterestedCount += doc.notInterestedMarked || 0;
    }
  }

  if (monthFromIso <= todayIso && monthToIso >= todayIso) {
    const todayStats = await computeAgentStatsForDate(todayIso);
    for (const doc of todayStats) {
      if (readableAgentIds.includes(doc.agentId)) {
        if (!agentStatsByUserId[doc.agentId]) {
          agentStatsByUserId[doc.agentId] = {
            achieved: 0,
            leadCount: 0,
            referralExcludedCount: 0,
            notInterestedCount: 0,
          };
        }
        agentStatsByUserId[doc.agentId].leadCount += doc.leadsGenerated || 0;
        agentStatsByUserId[doc.agentId].referralExcludedCount += doc.referralsGenerated || 0;
        agentStatsByUserId[doc.agentId].notInterestedCount += doc.notInterestedMarked || 0;
      }
    }
  }

  // 4a. Dynamically calculate Upfront Client Payments for the month
  const clientPayments = await listAllDocuments<Record<string, unknown>>({
    databases,
    databaseId: DATABASE_ID,
    collectionId: COLLECTIONS.CLIENT_PAYMENTS,
    queries: [
      Query.greaterThanEqual("updatedAt", monthStartIso),
      Query.lessThanEqual("updatedAt", monthEndIso),
    ],
    pageLimit: 100,
    maxPages: 200,
  });

  const cpLeadIds = Array.from(new Set(clientPayments.map((p) => typeof p.leadId === "string" ? p.leadId : "").filter(Boolean)));
  const cpLeadById = new Map<string, Record<string, unknown>>();
  if (cpLeadIds.length > 0) {
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
    if (leadCreated && leadCreated < monthStartIso) {
      continue; // Payments for leads closed in previous months are followups, not upfront
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
        u.createdAt >= monthStartIso &&
        u.createdAt <= monthEndIso &&
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
        createdAt >= monthStartIso &&
        createdAt <= monthEndIso &&
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
      if (readableAgentIds.includes(agentId)) {
        if (!agentStatsByUserId[agentId]) {
          agentStatsByUserId[agentId] = { achieved: 0, leadCount: 0, referralExcludedCount: 0, notInterestedCount: 0 };
        }
        agentStatsByUserId[agentId].achieved += amount;
      }
    }
  }

  // 4b. Technical payments in the month window.
  const technicalPaymentsByAgentId = await getTechnicalPaymentTotalsByUserAction({
    actorId: actor.$id,
    dateFrom: monthStartIso,
    dateTo: monthEndIso,
  });

  for (const [agentId, amount] of Object.entries(technicalPaymentsByAgentId)) {
    if (readableAgentIds.includes(agentId)) {
      if (!agentStatsByUserId[agentId]) {
        agentStatsByUserId[agentId] = { achieved: 0, leadCount: 0, referralExcludedCount: 0, notInterestedCount: 0 };
      }
      agentStatsByUserId[agentId].achieved += amount;
    }
  }

  // 4c. Followup payments in the month window.
  const followupsByAgentId: Record<string, number> = {};
  const readableSet = new Set(readableAgentIds);
  
  const docs = await listAllDocuments<Record<string, unknown>>({
    databases,
    databaseId: DATABASE_ID,
    collectionId: COLLECTIONS.PREVIOUS_FOLLOWUPS_PAYMENTS,
    queries: [
      Query.greaterThanEqual("date", monthFromIso),
      Query.lessThanEqual("date", monthToIso),
    ],
    maxPages: 100,
  });

  // Collect lead IDs for non-manual followups
  const followupLeadIds = Array.from(new Set(
    docs
      .map(d => typeof d.leadId === "string" ? d.leadId : "")
      .filter(id => id && !id.startsWith("manual_followup:"))
  ));
  
  const followupLeadById = new Map<string, Record<string, unknown>>();
  if (followupLeadIds.length > 0) {
    const CHUNK = 100;
    for (let i = 0; i < followupLeadIds.length; i += CHUNK) {
      const chunk = followupLeadIds.slice(i, i + CHUNK);
      const ldocs = await listAllDocuments<Record<string, unknown>>({
        databases,
        databaseId: DATABASE_ID,
        collectionId: COLLECTIONS.LEADS,
        queries: [Query.equal("$id", chunk), Query.limit(CHUNK)],
        pageLimit: CHUNK,
        maxPages: 1,
      });
      for (const d of ldocs) followupLeadById.set(d.$id as string, d);
    }
  }

  for (const doc of docs) {
    const leadId = typeof doc.leadId === "string" ? doc.leadId : "";
    const amount = typeof doc.amount === "number" ? doc.amount : 0;
    if (!leadId || amount <= 0) continue;

    let targetAgentId = "";

    const creditedAgentId = typeof doc.creditedAgentId === "string" && doc.creditedAgentId.trim() !== "" ? doc.creditedAgentId : null;

    if (leadId.startsWith("manual_followup:")) {
      const createdById = typeof doc.createdById === "string" ? doc.createdById : "";
      targetAgentId = creditedAgentId || createdById;
    } else {
      const lead = followupLeadById.get(leadId);
      if (lead) {
        const ownerId = typeof lead.ownerId === "string" ? lead.ownerId : "";
        const assignedToId = typeof lead.assignedToId === "string" ? lead.assignedToId : "";
        targetAgentId = creditedAgentId || assignedToId || ownerId;
      }
    }
    
    if (!targetAgentId || !readableSet.has(targetAgentId)) continue;
    
    followupsByAgentId[targetAgentId] = (followupsByAgentId[targetAgentId] ?? 0) + amount;
  }



  // 5. Build users map for the agent set so the report can show names.
  const usersByAgentId = new Map<string, User>();
  if (actor.role === "agent" || actor.role === "lead_generation") {
    usersByAgentId.set(actor.$id, actor);
  } else {
    // Admin or Team Lead: load every readable user doc. `readableAgentIds` was
    // already filtered to sales by the helper above, and may include historic 
    // assignments, so we query them all from the database.
    for (let i = 0; i < readableAgentIds.length; i += CHUNK) {
      const chunk = readableAgentIds.slice(i, i + CHUNK);
      const docs = await listAllDocuments<UserDoc>({
        databases,
        databaseId: DATABASE_ID,
        collectionId: COLLECTIONS.USERS,
        queries: [Query.equal("$id", chunk), Query.select(["$id", "name", "email", "role", "department"]), Query.limit(CHUNK)],
        pageLimit: CHUNK,
        maxPages: 50,
      });
      for (const d of docs) {
        usersByAgentId.set(String(d.$id), {
          $id: String(d.$id),
          name: String(d.name ?? ""),
          email: String(d.email ?? ""),
          role: d.role as User["role"],
          teamLeadId: typeof d.teamLeadId === "string" ? d.teamLeadId : null,
          branchIds: Array.isArray(d.branchIds) ? (d.branchIds as string[]) : [],
          branchId: typeof d.branchId === "string" ? d.branchId : null,
          department: d.department === "sales" || d.department === "resume" ? d.department : "sales",
          $createdAt: String(d.$createdAt ?? ""),
          $updatedAt: String(d.$updatedAt ?? ""),
        });
      }
    }
  }

  const result = buildTargetReport({
    monthKey: input.monthKey,
    targets,
    assignmentsByTargetId,
    agentStatsByUserId,
    usersByAgentId,
    followupsByAgentId,
    technicalPaymentsByAgentId,
  });

  const { from, to } = monthBounds(input.monthKey);
  return {
    result,
    monthLabel: `${input.monthKey} (${from} → ${to})`,
  };
}
