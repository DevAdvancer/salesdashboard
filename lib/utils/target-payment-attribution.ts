import { getPaymentCycleAttribution } from '@/lib/utils/lead-payment-cycle';
import { legacyFollowupMatches } from '@/lib/utils/followup-payment-attribution';
import { getCurrentEasternIsoDate } from '@/lib/utils/eastern-date';

export function targetPaymentRecipient(actorId: unknown, fallbackId: string, contributorIds: Set<string>, creditedId?: unknown) {
  if (typeof creditedId === 'string' && creditedId.trim()) return creditedId.trim();
  return typeof actorId === 'string' && contributorIds.has(actorId) ? actorId : fallbackId;
}

/** Calendar dates stay literal; timestamps are interpreted in business time. */
export function paymentBusinessDate(value: unknown): string {
  if (typeof value !== 'string' || !value) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : getCurrentEasternIsoDate(date);
}

/** The summary and drill-down read financial events, never the record's last edit. */
export function targetUpfrontAmounts(input: {
  payment: Record<string, unknown>; lead: Record<string, unknown>;
  from: string; to: string; contributorIds: Set<string>; followups: Record<string, unknown>[];
}) {
  const { payment, lead, contributorIds } = input;
  const cycle = getPaymentCycleAttribution(payment, lead);
  const fallback = cycle.assignedToId || cycle.ownerId || '';
  const from = input.from.slice(0, 10), to = input.to.slice(0, 10);
  const totals = new Map<string, number>();
  let updates: { createdAt?: string; paymentDate?: string; amount?: number; status?: string;
    actorId?: string; sourceFollowupId?: string; note?: string }[] = [];
  try {
    updates = JSON.parse(String(payment.updates ?? payment.updatesJson ?? '[]'));
    updates = Array.isArray(updates) ? updates.filter(update => update && typeof update === 'object') : [];
  } catch { /* Legacy records can have no update history. */ }
  const add = (id: string, value: unknown, status?: unknown) => {
    if (value === null || value === undefined) return;
    const raw = Number(value);
    const amount = status === 'refunded' ? -Math.abs(raw) : raw;
    if (id && Number.isFinite(amount) && amount !== 0) totals.set(id, (totals.get(id) ?? 0) + amount);
  };
  // Old mirrors did not carry sourceFollowupId. Match an individual financial
  // event rather than subtracting a lead's whole followup balance from upfront.
  const legacyMirrors = legacyFollowupMatches(updates, input.followups.filter(record => record.leadId === payment.leadId));
  for (const [index, update] of updates.entries()) {
    if (!update || update.sourceFollowupId || legacyMirrors.has(index)) continue;
    const date = paymentBusinessDate(update.paymentDate || update.createdAt);
    if (date && date >= from && date <= to &&
      (update.status === 'partially_paid' || update.status === 'fully_paid' || update.status === 'refunded')) {
      add(targetPaymentRecipient(update.actorId, fallback, contributorIds), update.amount, update.status);
    }
  }
  const created = paymentBusinessDate(payment.createdAt || payment.$createdAt);
  if (!updates.length && created && created >= from && created <= to &&
    (payment.status === 'partially_paid' || payment.status === 'fully_paid')) {
    try { add(fallback, JSON.parse(String(payment.paymentPlan ?? payment.paymentPlanJson ?? '{}')).upfrontAmount); } catch { /* No plan amount. */ }
  }
  return totals;
}
