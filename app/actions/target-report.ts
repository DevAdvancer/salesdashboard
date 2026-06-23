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

  // 1. Readable agent set (sales-only).
  let readableAgentIds: string[];
  if (actor.role === "agent" || actor.role === "lead_generation") {
    readableAgentIds = [actor.$id];
  } else if (actor.role === "team_lead") {
    // Sales-only — getAgentsByTeamLead with "sales" scope drops any
    // resume agent in the TL's team from the report.
    const agents = await getAgentsByTeamLead(actor.$id, "sales");
    readableAgentIds = Array.from(new Set([actor.$id, ...agents.map((a) => a.$id)]));
  } else {
    // Admin-like: scope to sales so the team table never surfaces
    // resume TLs / agents.
    const all = await getAssignableUsers(actor.role, actor.branchIds ?? [], actor.$id, "sales");
    readableAgentIds = all
      .filter((u) => u.role === "agent" || u.role === "lead_generation" || u.role === "team_lead")
      .map((u) => u.$id);
  }

  // 2. Fetch leads.
  const CHUNK = 100;
  const leads: LeadDoc[] = [];
  for (let i = 0; i < readableAgentIds.length; i += CHUNK) {
    const chunk = readableAgentIds.slice(i, i + CHUNK);
    const docs = await listAllDocuments<LeadDoc>({
      databases,
      databaseId: DATABASE_ID,
      collectionId: COLLECTIONS.LEADS,
      queries: [Query.equal("ownerId", chunk), Query.limit(CHUNK)],
      pageLimit: CHUNK,
      maxPages: 200,
    });
    leads.push(...docs);
  }

  const leadIds = Array.from(new Set(leads.map((l) => String(l.$id))));

  // 3. Fetch payments for those leads.
  const paymentsByLeadId: Record<string, LeadPaymentSnapshot> = {};
  for (let i = 0; i < leadIds.length; i += CHUNK) {
    const chunk = leadIds.slice(i, i + CHUNK);
    const docs = await listAllDocuments<LeadDoc>({
      databases,
      databaseId: DATABASE_ID,
      collectionId: COLLECTIONS.CLIENT_PAYMENTS,
      queries: [Query.equal("leadId", chunk), Query.limit(CHUNK)],
      pageLimit: CHUNK,
      maxPages: 50,
    });
    for (const doc of docs) {
      const leadId = typeof doc.leadId === "string" ? doc.leadId : "";
      if (!leadId) continue;
      const plan = parseJsonOr<ClientPaymentPlan>(doc.paymentPlan ?? doc.paymentPlanJson, {
        percent: 0,
        months: 0,
        upfrontAmount: 0,
      });
      const updates = parseJsonOr<ClientPaymentUpdate[]>(doc.updates ?? doc.updatesJson, []);
      let totalPaid = 0;
      let paidUpdateCount = 0;
      for (const u of updates) {
        if (u && typeof u.amount === "number" && Number.isFinite(u.amount)) {
          totalPaid += u.amount;
          paidUpdateCount += 1;
        }
      }
      paymentsByLeadId[leadId] = {
        totalPaid: paidUpdateCount > 0 ? totalPaid : null,
        upfrontAmount:
          typeof plan.upfrontAmount === "number" && Number.isFinite(plan.upfrontAmount)
            ? plan.upfrontAmount
            : 0,
      };
    }
  }

  // 4. Targets + assignments.
  const { targets, assignmentsByTargetId } = await listMonthlyTargetsWithAssignmentsAction({
    actorId: actor.$id,
    monthKey: input.monthKey,
  });

  // 4b. Not-Interested marks in the month window — used by the per-agent
  // table so an admin / TL can see why an agent's "Achieved" number is
  // what it is. We restrict to events whose `leadId` is in the set we
  // already pulled (so out-of-scope / orphaned events are dropped) and
  // attribute each event to `previousAssignedToId ?? previousOwnerId`
  // — the same rule the Weekly Report uses.
  const { from: monthFromIso, to: monthToIso } = monthBounds(input.monthKey);
  const monthStartIso = `${monthFromIso}T00:00:00.000Z`;
  const monthEndIso = `${monthToIso}T23:59:59.999Z`;
  const leadIdSet = new Set(leadIds);
  const notInterestedByOwnerId: Record<string, number> = {};
  if (leadIds.length > 0) {
    for (let i = 0; i < leadIds.length; i += CHUNK) {
      const chunk = leadIds.slice(i, i + CHUNK);
      const docs = await listAllDocuments<LeadDoc>({
        databases,
        databaseId: DATABASE_ID,
        collectionId: COLLECTIONS.NOT_INTERESTED_LEADS,
        queries: [
          Query.equal("leadId", chunk),
          Query.greaterThanEqual("markedAt", monthStartIso),
          Query.lessThanEqual("markedAt", monthEndIso),
          Query.limit(CHUNK),
        ],
        pageLimit: CHUNK,
        maxPages: 50,
      });
      for (const doc of docs) {
        // Skip "reopened" events — they mean the lead came back from
        // the not-interested queue. Only the latest active mark should
        // count for the month.
        if (doc.status === "reopened") continue;
        const leadId = typeof doc.leadId === "string" ? doc.leadId : "";
        if (!leadIdSet.has(leadId)) continue;
        const owner =
          (typeof doc.previousAssignedToId === "string" && doc.previousAssignedToId) ||
          (typeof doc.previousOwnerId === "string" ? doc.previousOwnerId : "");
        if (!owner) continue;
        notInterestedByOwnerId[owner] = (notInterestedByOwnerId[owner] ?? 0) + 1;
      }
    }
  }

  // 5. Build users map for the agent set so the report can show names.
  const usersByAgentId = new Map<string, User>();
  if (actor.role === "team_lead") {
    const self = await getUserByIdOrNull(actor.$id);
    if (self) usersByAgentId.set(self.$id, self);
    // Sales-only — same scope as the readable-agent set above.
    const agents = await getAgentsByTeamLead(actor.$id, "sales");
    for (const a of agents) usersByAgentId.set(a.$id, a);
  } else if (actor.role === "agent" || actor.role === "lead_generation") {
    usersByAgentId.set(actor.$id, actor);
  } else {
    // Admin: load every readable user doc. `readableAgentIds` was
    // already filtered to sales by the helper above, so the loop
    // cannot reintroduce resume users.
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

  // Cast to typed Lead[] for the helper (the helper only reads
  // id / data / ownerId / closedAt / createdAt / $createdAt).
  const typedLeads: Lead[] = leads.map((doc) => ({
    $id: String(doc.$id),
    data: typeof doc.data === "string" ? doc.data : "{}",
    status: typeof doc.status === "string" ? doc.status : "",
    ownerId: typeof doc.ownerId === "string" ? doc.ownerId : "",
    assignedToId: typeof doc.assignedToId === "string" ? doc.assignedToId : null,
    branchId: typeof doc.branchId === "string" ? doc.branchId : null,
    isClosed: doc.isClosed === true,
    closedAt: typeof doc.closedAt === "string" ? doc.closedAt : null,
    $createdAt: typeof doc.$createdAt === "string" ? doc.$createdAt : "",
    $updatedAt: typeof doc.$updatedAt === "string" ? doc.$updatedAt : "",
  }));

  const result = buildTargetReport({
    monthKey: input.monthKey,
    targets,
    assignmentsByTargetId,
    leads: typedLeads,
    paymentsByLeadId,
    usersByAgentId,
    notInterestedByOwnerId,
  });

  const { from, to } = monthBounds(input.monthKey);
  return {
    result,
    monthLabel: `${input.monthKey} (${from} → ${to})`,
  };
}
