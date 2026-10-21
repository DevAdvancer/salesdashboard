import { getPaymentCycleAttribution } from '@/lib/utils/lead-payment-cycle';
import { getFollowupsPaymentAmount } from '@/lib/utils/followups-payment-amount';

export function targetPaymentRecipient(actorId: unknown, fallbackId: string, contributorIds: Set<string>, creditedId?: unknown) {
  if (typeof creditedId === 'string' && creditedId.trim()) return creditedId.trim();
  return typeof actorId === 'string' && contributorIds.has(actorId) ? actorId : fallbackId;
}

/** The summary and drill-down share attribution and deduct followups exactly once. */
export function targetUpfrontAmounts(input: {
  payment: Record<string, unknown>; lead: Record<string, unknown>;
  from: string; to: string; contributorIds: Set<string>; followups: Record<string, unknown>[];
}) {
  const { payment, lead, from, to, contributorIds } = input;
  const cycle = getPaymentCycleAttribution(payment, lead);
  const fallback = cycle.assignedToId || cycle.ownerId || '';
  const closed = cycle.closedAt || lead.$createdAt || lead.createdAt;
  const totals = new Map<string, number>();
  if (typeof closed === 'string' && closed < from) return totals;
  let updates: { createdAt?: string; amount?: number; status?: string; actorId?: string }[] = [];
  try {
    updates = JSON.parse(String(payment.updates ?? payment.updatesJson ?? '[]'));
    if (!Array.isArray(updates)) updates = [];
  } catch { /* Legacy records can have no update history. */ }
  const add = (id: string, value: unknown) => {
    const amount = Number(value);
    if (id && Number.isFinite(amount) && amount > 0) totals.set(id, (totals.get(id) ?? 0) + amount);
  };
  for (const update of updates) {
    if (update?.createdAt && update.createdAt >= from && update.createdAt <= to &&
      (update.status === 'partially_paid' || update.status === 'fully_paid')) {
      add(targetPaymentRecipient(update.actorId, fallback, contributorIds), update.amount);
    }
  }
  if (!updates.length && typeof payment.createdAt === 'string' && payment.createdAt >= from && payment.createdAt <= to &&
    (payment.status === 'partially_paid' || payment.status === 'fully_paid')) {
    try { add(fallback, JSON.parse(String(payment.paymentPlan ?? payment.paymentPlanJson ?? '{}')).upfrontAmount); } catch { /* No plan amount. */ }
  }
  if (cycle.isCurrent) {
    const followups = input.followups.filter(record => record.leadId === payment.leadId);
    let remaining = followups.reduce((sum, record) => sum + getFollowupsPaymentAmount(record), 0);
    // The owner balance is reduced first; split admin/monitor updates must not
    // cause the same followup to be subtracted once per person.
    for (const id of [...new Set([fallback, ...totals.keys()])]) {
      if (!totals.has(id)) continue;
      const deduction = Math.min(totals.get(id)!, remaining);
      totals.set(id, totals.get(id)! - deduction);
      remaining -= deduction;
      if (remaining === 0) break;
    }
  }
  return totals;
}
