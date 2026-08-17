"use server";

import { Query } from "node-appwrite";
import { COLLECTIONS, DATABASE_ID } from "@/lib/constants/appwrite";
import { createAdminClient } from "@/lib/server/appwrite";
import { assertAuthenticatedUserId } from "@/lib/server/current-user";
import { listAllDocuments } from "@/lib/server/appwrite-pagination";
import { isRoleEligibleForComponent } from "@/lib/constants/component-access";
import { getAgentsByTeamLead, getAssignableUsers } from "@/lib/services/user-service";
import type { User } from "@/lib/types";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface AgentPaymentDetail {
  candidateName: string;
  amount: number;
  leadId: string;
  /** "upfront" | "technical" | "followup" */
  category: "upfront" | "technical" | "followup";
}

export interface AgentPaymentDetailsResult {
  agentName: string;
  upfront: AgentPaymentDetail[];
  technicalAndFollowups: AgentPaymentDetail[];
  totalAmount: number;
  upfrontTotal: number;
  technicalAndFollowupsTotal: number;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

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
  const start = new Date(Date.UTC(year, month - 1, 1));
  const end = new Date(Date.UTC(year, month, 0));
  return {
    from: start.toISOString().slice(0, 10),
    to: end.toISOString().slice(0, 10),
  };
}

function parseLeadName(leadDoc: Record<string, unknown>): string {
  try {
    const raw = typeof leadDoc.data === "string" ? leadDoc.data : "{}";
    const data = JSON.parse(raw) as Record<string, unknown>;
    const firstName = typeof data.firstName === "string" ? data.firstName.trim() : "";
    const lastName = typeof data.lastName === "string" ? data.lastName.trim() : "";
    const fullName = [firstName, lastName].filter(Boolean).join(" ");
    if (fullName) return fullName;
    if (typeof data.candidateName === "string" && data.candidateName.trim()) return data.candidateName.trim();
    if (typeof data.name === "string" && data.name.trim()) return data.name.trim();
    if (typeof data.email === "string" && data.email.trim()) return data.email.trim();
    return "Unknown";
  } catch {
    return "Unknown";
  }
}

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

// ─── Main action ────────────────────────────────────────────────────────────

/**
 * Fetch per-agent payment details (candidate name + amount) for a given
 * agent and month.  Returns data split into "upfront" and "technical & followups".
 *
 * Only Admin/Developer/Monitor/Operations/Team-Lead callers may request
 * another user's data.  Agents may only request their own.
 */
export async function getAgentPaymentDetailsAction(input: {
  actorId: string;
  agentId: string;
  monthKey: string;
}): Promise<AgentPaymentDetailsResult> {
  const { databases } = await createAdminClient();

  if (!/^\d{4}-\d{2}$/.test(input.monthKey)) {
    throw new Error("Invalid month. Use YYYY-MM.");
  }
  await assertAuthenticatedUserId(input.actorId);

  // ── Load actor ────────────────────────────────────────────────────────
  const actorDoc = await databases
    .getDocument(DATABASE_ID, COLLECTIONS.USERS, input.actorId)
    .catch(() => null);
  if (!actorDoc) throw new Error("User not found");
  const actor: User = {
    $id: actorDoc.$id,
    name: actorDoc.name,
    email: actorDoc.email,
    role: actorDoc.role,
    teamLeadId: actorDoc.teamLeadId || null,
    branchIds: actorDoc.branchIds || [],
    branchId: actorDoc.branchId || null,
    department: actorDoc.department === "resume" ? "resume" : "sales",
    $createdAt: actorDoc.$createdAt,
    $updatedAt: actorDoc.$updatedAt,
  };

  if (!isRoleEligibleForComponent("target-report", actor.role)) {
    throw new Error("Not authorized");
  }
  ensureSalesCrmAccess(actor);

  // ── Verify actor can read this agent ──────────────────────────────────
  const isAdminLike =
    actor.role === "admin" ||
    actor.role === "developer" ||
    actor.role === "monitor" ||
    actor.role === "operations";
  const isTl = actor.role === "team_lead";

  if (!isAdminLike && !isTl) {
    // Agent — can only see self
    if (input.agentId !== actor.$id) {
      throw new Error("Not authorized to view this agent's details.");
    }
  } else if (isTl) {
    // TL — can see self + own team
    if (input.agentId !== actor.$id) {
      const agents = await getAgentsByTeamLead(actor.$id, "sales");
      const teamIds = new Set([actor.$id, ...agents.map((a) => a.$id)]);
      if (!teamIds.has(input.agentId)) {
        throw new Error("Not authorized to view this agent's details.");
      }
    }
  }
  // Admin-like: no restriction

  // ── Load agent doc for the name ───────────────────────────────────────
  const agentDoc = await databases
    .getDocument(DATABASE_ID, COLLECTIONS.USERS, input.agentId)
    .catch(() => null);
  const agentName = agentDoc?.name ?? input.agentId;

  const { from: monthFromIso, to: monthToIso } = monthBounds(input.monthKey);
  const monthStartIso = `${monthFromIso}T00:00:00.000Z`;
  const monthEndIso = `${monthToIso}T23:59:59.999Z`;

  // ── 1.  Upfront client payments ───────────────────────────────────────
  // We need leads owned by / assigned to this agent, then their client
  // payments with updates falling in the month window.
  const upfrontDetails: AgentPaymentDetail[] = [];

  // Fetch client_payments updated in the month window
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

  // Collect lead IDs to batch-fetch
  const cpLeadIds = Array.from(new Set(clientPayments.map((p) => p.leadId as string).filter(Boolean)));
  const cpLeadById = new Map<string, Record<string, unknown>>();
  if (cpLeadIds.length > 0) {
    const CHUNK = 100;
    for (let i = 0; i < cpLeadIds.length; i += CHUNK) {
      const chunk = cpLeadIds.slice(i, i + CHUNK);
      const docs = await listAllDocuments<Record<string, unknown>>({
        databases,
        databaseId: DATABASE_ID,
        collectionId: COLLECTIONS.LEADS,
        queries: [Query.equal("$id", chunk), Query.limit(CHUNK)],
        pageLimit: CHUNK,
        maxPages: 1,
      });
      for (const d of docs) cpLeadById.set(d.$id as string, d);
    }
  }

  for (const cp of clientPayments) {
    const leadId = cp.leadId as string;
    const lead = cpLeadById.get(leadId);
    if (!lead) continue;

    // Attribution: lead owner or assignee must be the target agent
    const ownerId = lead.ownerId as string | undefined;
    const assignedToId = lead.assignedToId as string | undefined;
    const attributedTo = assignedToId || ownerId;


    let updates: { createdAt?: string; amount?: number; status?: string; actorId?: string }[] = [];
    try {
      const raw = cp.updates ?? cp.updatesJson;
      updates = JSON.parse(typeof raw === "string" ? raw : "[]");
      if (!Array.isArray(updates)) updates = [];
    } catch {
      updates = [];
    }

    let totalForLead = 0;
    for (const u of updates) {
      if (
        u.createdAt &&
        u.createdAt >= monthStartIso &&
        u.createdAt <= monthEndIso &&
        (u.status === "partially_paid" || u.status === "fully_paid")
      ) {
        // Respect actor attribution — only count if actorId matches or
        // if no actorId is set and lead is attributed to the agent.
        const updateActor = u.actorId || (cp.updatedById as string) || attributedTo;
        if (updateActor === input.agentId) {
          const amount = Number(u.amount) || 0;
          if (amount > 0) totalForLead += amount;
        }
      }
    }

    // Fallback: if no updates carried an amount but the payment was created in window
    if (totalForLead === 0 && updates.length === 0) {
      const createdAt = cp.createdAt as string | undefined;
      if (
        createdAt &&
        createdAt >= monthStartIso &&
        createdAt <= monthEndIso &&
        ((cp.status as string) === "partially_paid" || (cp.status as string) === "fully_paid")
      ) {
        const fallbackActor = (cp.updatedById as string) || attributedTo;
        if (fallbackActor === input.agentId) {
          let plan: { upfrontAmount?: number } = {};
          try {
            plan = JSON.parse(typeof (cp.paymentPlan ?? cp.paymentPlanJson) === "string" ? (cp.paymentPlan ?? cp.paymentPlanJson) as string : "{}");
          } catch { /* ignore */ }
          totalForLead = Number(plan.upfrontAmount) || 0;
        }
      }
    }

    if (totalForLead > 0) {
      upfrontDetails.push({
        candidateName: parseLeadName(lead),
        amount: totalForLead,
        leadId,
        category: "upfront",
      });
    }
  }

  // ── 2.  Technical payments ────────────────────────────────────────────
  const techDetails: AgentPaymentDetail[] = [];
  const techPayments = await listAllDocuments<Record<string, unknown>>({
    databases,
    databaseId: DATABASE_ID,
    collectionId: COLLECTIONS.TECHNICAL_PAYMENTS,
    queries: [
      Query.equal("userId", input.agentId),
      Query.greaterThanEqual("createdAt", monthStartIso),
      Query.lessThanEqual("createdAt", monthEndIso),
    ],
    pageLimit: 100,
    maxPages: 100,
  });

  // Batch-fetch lead data for tech payments
  const techLeadIds = Array.from(new Set(techPayments.map((p) => p.leadId as string).filter(Boolean)));
  const techLeadById = new Map<string, Record<string, unknown>>();
  if (techLeadIds.length > 0) {
    const CHUNK = 100;
    for (let i = 0; i < techLeadIds.length; i += CHUNK) {
      const chunk = techLeadIds.slice(i, i + CHUNK);
      const docs = await listAllDocuments<Record<string, unknown>>({
        databases,
        databaseId: DATABASE_ID,
        collectionId: COLLECTIONS.LEADS,
        queries: [Query.equal("$id", chunk), Query.limit(CHUNK)],
        pageLimit: CHUNK,
        maxPages: 1,
      });
      for (const d of docs) techLeadById.set(d.$id as string, d);
    }
  }

  for (const tp of techPayments) {
    const amount = Number(tp.amount) || 0;
    if (amount <= 0) continue;
    const leadId = tp.leadId as string;
    const lead = techLeadById.get(leadId);
    techDetails.push({
      candidateName: lead ? parseLeadName(lead) : "Unknown",
      amount,
      leadId: leadId || "",
      category: "technical",
    });
  }

  // ── 3.  Followup payments ─────────────────────────────────────────────
  const followupDetails: AgentPaymentDetail[] = [];
  const followupDocs = await listAllDocuments<Record<string, unknown>>({
    databases,
    databaseId: DATABASE_ID,
    collectionId: COLLECTIONS.PREVIOUS_FOLLOWUPS_PAYMENTS,
    queries: [
      Query.greaterThanEqual("date", monthFromIso),
      Query.lessThanEqual("date", monthToIso),
    ],
    pageLimit: 100,
    maxPages: 100,
  });

  for (const doc of followupDocs) {
    const createdById = typeof doc.createdById === "string" ? doc.createdById : "";
    const creditedAgentId =
      typeof doc.creditedAgentId === "string" && doc.creditedAgentId.trim() !== ""
        ? doc.creditedAgentId
        : null;
    const targetAgentId = creditedAgentId || createdById;

    const leadId = typeof doc.leadId === "string" ? doc.leadId : "";
    const amount = typeof doc.amount === "number" ? doc.amount : 0;

    // Match the same filter the target report uses:
    // only manual followup entries (leadId starts with "manual_followup:")
    if (!targetAgentId || !leadId || !leadId.startsWith("manual_followup:")) continue;
    if (targetAgentId !== input.agentId) continue;
    if (amount <= 0) continue;

    const candidateName =
      typeof doc.candidateName === "string" && doc.candidateName.trim()
        ? doc.candidateName.trim()
        : "Unknown";

    followupDetails.push({
      candidateName,
      amount,
      leadId,
      category: "followup",
    });
  }

  // ── Assemble result ───────────────────────────────────────────────────
  const technicalAndFollowups = [...techDetails, ...followupDetails];
  const upfrontTotal = upfrontDetails.reduce((s, d) => s + d.amount, 0);
  const technicalAndFollowupsTotal = technicalAndFollowups.reduce((s, d) => s + d.amount, 0);

  return {
    agentName,
    upfront: upfrontDetails,
    technicalAndFollowups,
    totalAmount: upfrontTotal + technicalAndFollowupsTotal,
    upfrontTotal,
    technicalAndFollowupsTotal,
  };
}
