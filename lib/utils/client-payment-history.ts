import type { ClientPaymentFollowupUpdate, ClientPaymentRecord, ClientPaymentUpdate, PaymentStatus } from '@/lib/types';
import { getFollowupsPaymentAmount } from '@/lib/utils/followups-payment-amount';
import { reconcileFollowupPaymentUpdates } from '@/lib/utils/followup-payment-attribution';

export function mapFollowupHistoryUpdate(row: Record<string, unknown>): ClientPaymentFollowupUpdate {
  const edited = Boolean(row.updatedAt);
  return {
    id: String(row.$id),
    amount: getFollowupsPaymentAmount(row),
    status: row.status === 'refunded' || Number(row.amount) < 0 ? 'refunded' : 'paid',
    note: typeof row.paymentRemark === 'string' ? row.paymentRemark : typeof row.remark === 'string' ? row.remark : null,
    actorId: String((edited && row.updatedById) || row.createdById || ''),
    actorName: String((edited && row.updatedByName) || row.createdByName || 'Unknown user'),
    creditedAgentId: String(row.creditedAgentId || row.createdById || ''),
    creditedAgentName: String(row.creditedAgentName ||
      (!row.creditedAgentId || row.creditedAgentId === row.createdById ? row.createdByName : row.creditedAgentId) || ''),
    recordedAt: String(row.createdAt || row.$createdAt || ''),
    recordedById: String(row.createdById || ''),
    systemCreatedAt: typeof row.$createdAt === 'string' ? row.$createdAt : '',
    createdAt: String(row.updatedAt || row.createdAt || row.$createdAt || ''),
    paymentDate: typeof row.date === 'string' ? row.date : '',
  };
}

export interface ClientPaymentHistoryEntry {
  id: string;
  kind: 'payment' | 'followup';
  title: string;
  amount?: number | null;
  /** A source edit not yet reflected in the mirrored financial update. */
  reportedAmount?: number;
  note?: string | null;
  actorName: string;
  creditedAgentName?: string;
  createdAt: string;
  paymentDate?: string;
  cycle?: string;
}

function statusLabel(status: PaymentStatus): string {
  return ({ fully_paid: 'Fully Paid', partially_paid: 'Partially Paid', non_upfront: 'Non-Upfront',
    refunded: 'Refunded', not_paid: 'Not Paid' })[status] || 'Not Paid';
}

/** Merge for display only. Financial updates and past closure cycles are never rewritten. */
export function buildClientPaymentHistory(record: ClientPaymentRecord): ClientPaymentHistoryEntry[] {
  const records = [record, ...(record.previousRecords ?? [])];
  const sourceUpdates = new Map<string, ClientPaymentUpdate[]>();
  const entries: ClientPaymentHistoryEntry[] = [];
  const followups = [...new Map(records.flatMap(cycle => cycle.followupUpdates ?? []).map(source => [source.id, source])).values()];
  const followupById = new Map(followups.map(source => [source.id, source]));
  const reconciledUpdates = reconcileFollowupPaymentUpdates(records.flatMap(cycle => cycle.updates), followups);
  let updateIndex = 0;
  for (const cycle of records) {
    for (const _update of cycle.updates) {
      const update = reconciledUpdates[updateIndex++]!;
      const source = update.sourceFollowupId ? followupById.get(update.sourceFollowupId) : undefined;
      entries.push({ ...update, id: `payment:${cycle.$id}:${update.id}`, kind: 'payment',
        ...(source ? { creditedAgentName: source.creditedAgentName, paymentDate: source.paymentDate } : {}),
        ...(update.followupEdit && update.amount === 0 ? { amount: null } : {}),
        title: update.followupEdit ? update.amount === 0 ? 'Follow-up details updated' : 'Follow-up payment adjusted'
          : `Status changed to ${statusLabel(update.status)}`, cycle: cycle.createdAt });
      const sourceId = update.sourceFollowupId || source?.id;
      if (sourceId) {
        const linked = sourceUpdates.get(sourceId) ?? [];
        linked.push(update);
        sourceUpdates.set(sourceId, linked);
      }
    }
  }
  const seen = new Set<string>();
  for (const followup of followups) {
    if (seen.has(followup.id)) continue;
    seen.add(followup.id);
    const linked = sourceUpdates.get(followup.id) ?? [];
    const latest = [...linked].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0];
    const total = linked.reduce((sum, update) => sum + (update.amount ?? 0), 0);
    const sameAmount = total === followup.amount;
    const sameNote = (latest?.note?.trim() || 'Followup payment added') ===
      (followup.note?.trim() || 'Followup payment added');
    if (latest && sameAmount && sameNote && (latest.status === 'refunded') === (followup.status === 'refunded')) continue;
    entries.push({ ...followup, id: `followup:${followup.id}`, kind: 'followup',
      title: latest ? 'Payment follow-up updated' : followup.status === 'refunded'
        ? 'Follow-up refund recorded' : 'Payment follow-up recorded',
      // A mirrored receipt already shows its amount; a note-only edit must not show it twice.
      amount: latest ? null : followup.amount,
      ...(latest && !sameAmount ? { reportedAmount: followup.amount } : {}),
    });
  }
  return entries.sort((a, b) => (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0));
}
