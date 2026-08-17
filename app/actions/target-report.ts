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

  // 2. Fetch daily stats for the agents
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
        // If today is in the range, strictly fetch until yesterday from cache to avoid double counting
        // because we dynamically compute and add today's stats later.
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
      agentStatsByUserId[doc.agentId].achieved += doc.upfrontRevenue || 0;
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
        agentStatsByUserId[doc.agentId].achieved += doc.upfrontRevenue || 0;
        agentStatsByUserId[doc.agentId].leadCount += doc.leadsGenerated || 0;
        agentStatsByUserId[doc.agentId].referralExcludedCount += doc.referralsGenerated || 0;
        agentStatsByUserId[doc.agentId].notInterestedCount += doc.notInterestedMarked || 0;
      }
    }
  }

  // 3. Targets + assignments already fetched above.

  // 4c. Followup payments in the month window.
  // We query all followup payments in this month, and if their target agent
  // is in our readableAgentIds and they are linked to an actual client lead (not a manual entry),
  // we add their amount to that agent's followup total.
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

  for (const doc of docs) {
    const createdById = typeof doc.createdById === "string" ? doc.createdById : "";
    const creditedAgentId = typeof doc.creditedAgentId === "string" && doc.creditedAgentId.trim() !== "" ? doc.creditedAgentId : null;
    const targetAgentId = creditedAgentId || createdById;
    
    const leadId = typeof doc.leadId === "string" ? doc.leadId : "";
    const amount = typeof doc.amount === "number" ? doc.amount : 0;
    
    if (!targetAgentId || !leadId || !leadId.startsWith("manual_followup:")) continue;
    if (!readableSet.has(targetAgentId)) continue;
    
    followupsByAgentId[targetAgentId] = (followupsByAgentId[targetAgentId] ?? 0) + amount;
  }

  // 4d. Technical payments in the month window.
  const technicalPaymentsByAgentId = await getTechnicalPaymentTotalsByUserAction({
    actorId: actor.$id,
    dateFrom: monthStartIso,
    dateTo: monthEndIso,
  });

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
