import type { Lead, MonthlyTarget, MonthlyTargetAssignment, User } from "@/lib/types";

/**
 * Pure helpers that compute the per-agent and per-TL rows shown on the
 * Target-Report page. No I/O — the caller fetches leads, payments,
 * targets, and assignments, then hands them in.
 *
 * Attribution rules:
 *   • A lead is attributed to its `ownerId` (the agent who created it).
 *   • Money counted for a lead is the sum of `client_payments.updates[].amount`
 *     (or `paymentPlan.upfrontAmount` if no update carried an amount) — the
 *     same source the Payments-Report uses.
 *   • Referral leads are excluded entirely (matched on `data.source`).
 *   • Date filter: a lead counts when its `closedAt` falls inside the
 *     month window; if `closedAt` is missing, the lead's `$createdAt`
 *     is used as a fallback so client_payments created in-window are
 *     still attributed.
 */

export interface TargetReportAgentRow {
  userId: string;
  userName: string;
  /** 0 when the TL has not yet entered a per-agent target. */
  target: number;
  /** Sum of money received from non-referral leads owned by this user, in window. */
  achieved: number;
  /** achieved / target as a 0-1 fraction. Null when no target has been set. */
  percent: number | null;
  leadCount: number;
  referralExcludedCount: number;
  /**
   * How many leads owned by this user were marked "Not Interested" in
   * the selected month. Counts active events from `not_interested_leads`
   * — events whose `previousAssignedToId` or `previousOwnerId` resolves
   * to this agent and whose `markedAt` falls in the month window.
   */
  notInterestedCount: number;
}

export interface TargetReportTlRow {
  teamLeadId: string;
  teamLeadName: string;
  /** Sum of per-agent targets on the assignments, or the team-total if
   *  no assignments exist. May be 0 if neither is set. */
  target: number;
  achieved: number;
  percent: number | null;
  agents: TargetReportAgentRow[];
  /** True when the team total was set by the admin but no per-agent
   *  assignments exist yet — the UI uses this to prompt the TL. */
  needsSplit: boolean;
}

export interface TargetReportTotals {
  target: number;
  achieved: number;
  percent: number | null;
  agentCount: number;
}

export interface TargetReportResult {
  rows: TargetReportTlRow[];
  totals: TargetReportTotals;
  unresolvedAgentIds: string[];
}

export interface LeadPaymentSnapshot {
  /** Sum of every update's amount. Null when no update carried an amount. */
  totalPaid: number | null;
  /** Payment plan upfront amount — used as a fallback when totalPaid is null. */
  upfrontAmount: number;
}

export interface LeadSnapshot {
  $id: string;
  ownerId: string;
  /** ISO date or YYYY-MM-DD. Used to filter by month. */
  closedAt: string | null;
  createdAt: string | null;
  source: string;
}

function isReferralSource(source: unknown): boolean {
  if (typeof source !== "string") return false;
  const normalized = source.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
  return normalized === "referral";
}

function toMonthKey(iso: string | null | undefined): string | null {
  if (typeof iso !== "string") return null;
  const trimmed = iso.trim();
  if (!trimmed) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) return trimmed.slice(0, 7);
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 7);
}

function resolvePaidAmount(snapshot: LeadPaymentSnapshot | undefined): number {
  if (!snapshot) return 0;
  if (snapshot.totalPaid !== null && Number.isFinite(snapshot.totalPaid)) {
    return Math.max(0, snapshot.totalPaid);
  }
  if (typeof snapshot.upfrontAmount === "number" && Number.isFinite(snapshot.upfrontAmount)) {
    return Math.max(0, snapshot.upfrontAmount);
  }
  return 0;
}

function toPercent(numerator: number, denominator: number): number | null {
  if (!(denominator > 0)) return null;
  return Math.max(0, numerator / denominator);
}

function toLeadSnapshot(lead: Lead): LeadSnapshot {
  let source = "";
  try {
    const parsed = lead.data ? JSON.parse(lead.data) : {};
    if (parsed && typeof parsed === "object") {
      const rawSource = (parsed as { source?: unknown }).source;
      const rawSourceName = (parsed as { sourceName?: unknown }).sourceName;
      source =
        typeof rawSource === "string"
          ? rawSource
          : typeof rawSourceName === "string"
            ? rawSourceName
            : "";
    }
  } catch {
    source = "";
  }
  return {
    $id: lead.$id,
    ownerId: typeof lead.ownerId === "string" ? lead.ownerId : "",
    closedAt: typeof lead.closedAt === "string" ? lead.closedAt : null,
    createdAt:
      typeof lead.$createdAt === "string"
        ? lead.$createdAt
        : null,
    source,
  };
}

/**
 * Build the report. `monthKey` is "YYYY-MM".
 *
 * `usersByAgentId` must contain every agent the actor can read. The
 * function silently drops payment data for agents not in the map — the
 * caller is responsible for restricting the read scope.
 */
export function buildTargetReport(input: {
  monthKey: string;
  targets: MonthlyTarget[];
  assignmentsByTargetId: Record<string, MonthlyTargetAssignment[]>;
  leads: Lead[];
  paymentsByLeadId: Record<string, LeadPaymentSnapshot>;
  usersByAgentId: Map<string, User>;
  /**
   * Optional. Number of "Not Interested" marks per agent id, restricted
   * to events in the selected month. When omitted, every agent's
   * notInterestedCount falls back to 0.
   */
  notInterestedByOwnerId?: Record<string, number>;
}): TargetReportResult {
  const { monthKey, targets, assignmentsByTargetId, leads, paymentsByLeadId, usersByAgentId } =
    input;
  const notInterestedByOwnerId = input.notInterestedByOwnerId ?? {};

  // Pre-aggregate paid amounts per (owner, lead) so we can later
  // break by agent.
  const paidByAgentId = new Map<string, number>();
  const leadCountByAgentId = new Map<string, number>();
  const referralExcludedByAgentId = new Map<string, number>();

  for (const lead of leads) {
    const snapshot = toLeadSnapshot(lead);
    const effectiveDate = snapshot.closedAt ?? snapshot.createdAt;
    const leadMonth = toMonthKey(effectiveDate);
    if (leadMonth !== monthKey) continue;
    if (!snapshot.ownerId) continue;
    // Only count leads whose owner is in the actor's readable agent set.
    if (!usersByAgentId.has(snapshot.ownerId)) continue;

    if (isReferralSource(snapshot.source)) {
      referralExcludedByAgentId.set(
        snapshot.ownerId,
        (referralExcludedByAgentId.get(snapshot.ownerId) ?? 0) + 1,
      );
      continue;
    }

    const paid = resolvePaidAmount(paymentsByLeadId[lead.$id]);
    if (paid > 0) {
      paidByAgentId.set(snapshot.ownerId, (paidByAgentId.get(snapshot.ownerId) ?? 0) + paid);
    }
    leadCountByAgentId.set(
      snapshot.ownerId,
      (leadCountByAgentId.get(snapshot.ownerId) ?? 0) + 1,
    );
  }

  // Build per-TL rows.
  const rows: TargetReportTlRow[] = [];
  const resolvedAgentIds = new Set<string>();

  for (const target of targets) {
    const assignments = assignmentsByTargetId[target.$id] ?? [];
    const assignmentsByAgent = new Map<string, MonthlyTargetAssignment>(
      assignments.map((a) => [a.agentId, a]),
    );
    const teamAgentIds = new Set<string>([
      target.teamLeadId,
      ...assignments.map((a) => a.agentId),
    ]);

    const agents: TargetReportAgentRow[] = [];
    let teamTarget = 0;
    let teamAchieved = 0;

    for (const agentId of teamAgentIds) {
      if (!usersByAgentId.has(agentId)) continue;
      resolvedAgentIds.add(agentId);
      const agent = usersByAgentId.get(agentId)!;
      const achieved = paidByAgentId.get(agentId) ?? 0;
      const assignment = assignmentsByAgent.get(agentId);
      const agentTarget = assignment?.amount ?? 0;
      teamTarget += agentTarget;
      teamAchieved += achieved;
      agents.push({
        userId: agentId,
        userName: agent.name,
        target: agentTarget,
        achieved,
        percent: toPercent(achieved, agentTarget),
        leadCount: leadCountByAgentId.get(agentId) ?? 0,
        referralExcludedCount: referralExcludedByAgentId.get(agentId) ?? 0,
        notInterestedCount: notInterestedByOwnerId[agentId] ?? 0,
      });
    }

    agents.sort((a, b) => b.achieved - a.achieved || a.userName.localeCompare(b.userName));

    // If no assignments were entered but a team total exists, surface
    // that number as a fallback so the percent still makes sense.
    const effectiveTarget = teamTarget > 0 ? teamTarget : target.totalAmount;
    const needsSplit = teamTarget === 0 && target.totalAmount > 0;

    rows.push({
      teamLeadId: target.teamLeadId,
      teamLeadName: target.teamLeadName || target.teamLeadId,
      target: effectiveTarget,
      achieved: teamAchieved,
      percent: toPercent(teamAchieved, effectiveTarget),
      agents,
      needsSplit,
    });
  }

  rows.sort((a, b) => b.achieved - a.achieved || a.teamLeadName.localeCompare(b.teamLeadName));

  // Totals.
  const totalTarget = rows.reduce((sum, r) => sum + r.target, 0);
  const totalAchieved = rows.reduce((sum, r) => sum + r.achieved, 0);

  return {
    rows,
    totals: {
      target: totalTarget,
      achieved: totalAchieved,
      percent: toPercent(totalAchieved, totalTarget),
      agentCount: rows.reduce((sum, r) => sum + r.agents.length, 0),
    },
    unresolvedAgentIds: Array.from(usersByAgentId.keys()).filter((id) => !resolvedAgentIds.has(id)),
  };
}

/**
 * Filter the target report result to show only a specific agent's row.
 * Used when an agent views the report — they should see only their own
 * target (from assignments) and achievement, not the full team view.
 */
export function filterTargetReportForAgent(
  result: TargetReportResult,
  agentId: string,
): TargetReportResult {
  // Find the agent's row across all team rows
  for (const row of result.rows) {
    const agentRow = row.agents.find((a) => a.userId === agentId);
    if (agentRow) {
      // Return a result with just this agent's row
      return {
        rows: [
          {
            ...row,
            agents: [agentRow],
          },
        ],
        totals: {
          target: agentRow.target,
          achieved: agentRow.achieved,
          percent: agentRow.percent,
          agentCount: 1,
        },
        unresolvedAgentIds: [],
      };
    }
  }

  // Agent has no row (no target assigned) — return empty result
  return {
    rows: [],
    totals: {
      target: 0,
      achieved: 0,
      percent: null,
      agentCount: 0,
    },
    unresolvedAgentIds: [],
  };
}
