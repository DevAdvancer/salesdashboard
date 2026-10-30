import { getFollowupsPaymentAmount } from '@/lib/utils/followups-payment-amount';

const nonBlank = (value: unknown) => typeof value === 'string' ? value.trim() : '';
export const UNASSIGNED_FOLLOWUP_PROFILE_ID = 'unassigned-followups';

export function isIndependentFollowup(leadId: unknown) {
  return !nonBlank(leadId) || nonBlank(leadId).startsWith('manual_followup:');
}

/** The recorder is audit metadata, not an override of the credited profile. */
export function followupPaymentRecipient(record: Record<string, unknown>, lead?: Record<string, unknown>) {
  const explicit = nonBlank(record.creditedAgentId);
  if (explicit) return explicit;
  if (isIndependentFollowup(record.leadId)) return nonBlank(record.createdById);
  return nonBlank(lead?.assignedToId) || nonBlank(lead?.ownerId) || nonBlank(record.createdById);
}

export type FollowupFinancialUpdate = { sourceFollowupId?: string; amount?: number | null; status?: string;
  createdAt?: string; actorId?: string; note?: string | null; followupEdit?: boolean; recordedAmount?: number };
type FollowupSource = { id?: string; $id?: unknown; amount?: unknown; status?: unknown;
  createdAt?: unknown; recordedAt?: unknown; updatedAt?: unknown; systemCreatedAt?: unknown; $createdAt?: unknown;
  createdById?: unknown; recordedById?: unknown; updatedById?: unknown; actorId?: unknown;
  note?: unknown; paymentRemark?: unknown; remark?: unknown; date?: unknown; paymentDate?: unknown };

function legacyMatchCandidates<T extends FollowupSource>(updates: FollowupFinancialUpdate[], followups: T[]) {
  return updates.map(update => {
    if (update.sourceFollowupId || update.amount == null || !Number.isFinite(update.amount)) return [];
    const timestamp = Date.parse(update.createdAt || '');
    const amount = update.status === 'refunded' ? -Math.abs(update.amount) : update.amount;
    return followups.flatMap(source => {
      const note = nonBlank(update.note) || 'Followup payment added';
      const sourceNote = nonBlank(source.note ?? source.paymentRemark ?? source.remark) || 'Followup payment added';
      if (!Number.isFinite(timestamp) || (note !== 'Followup payment added' && note !== sourceNote)) return [];
      const created = Date.parse(String(source.recordedAt || source.createdAt || ''));
      const edited = Date.parse(String(source.updatedAt || (source.recordedAt ? source.createdAt : '') || ''));
      const recreated = Date.parse(String(source.systemCreatedAt || source.$createdAt || ''));
      // Creation establishes the receipt. A later saved edit (or a documented
      // legacy document recreation) establishes a full-value snapshot, not cash.
      const anchors = [{ at: created, phase: 'created' },
        ...(edited > created ? [{ at: edited, phase: 'edited' }] : []),
        ...(recreated > created + 1000 ? [{ at: recreated, phase: 'edited' }] : [])];
      const anchor = anchors.filter(candidate => Number.isFinite(candidate.at) && Math.abs(timestamp - candidate.at) < 60000)
        .sort((a, b) => Math.abs(timestamp - a.at) - Math.abs(timestamp - b.at))[0];
      if (!anchor) return [];
      // A creation receipt keeps its ORIGINAL amount even after an edit changes
      // the source snapshot. Custom notes also need the recorded actor match;
      // amount equality with the latest snapshot cannot identify that receipt.
      const expectedActor = anchor.phase === 'created'
        ? nonBlank(source.recordedById ?? source.createdById)
        : nonBlank(source.updatedById ?? source.actorId);
      const customNoteReceipt = note === sourceNote && Boolean(expectedActor) && update.actorId === expectedActor;
      if (amount !== getFollowupsPaymentAmount(source) &&
        (!(note === 'Followup payment added' || customNoteReceipt) ||
          !anchors.some(candidate => candidate.phase === 'edited'))) return [];
      return [{ source, phase: anchor.phase }];
    });
  });
}

/** Match only unambiguous old mirrors; creation and edit are separate events. */
export function legacyFollowupMatches<T extends FollowupSource>(updates: FollowupFinancialUpdate[], followups: T[]): Map<number, T> {
  const candidates = legacyMatchCandidates(updates, followups);
  const matches = new Map<number, T>();
  candidates.forEach((options, index) => {
    const candidate = options[0];
    if (options.length === 1 && candidate && candidates.filter(other => other.some(option =>
      option.source === candidate.source && option.phase === candidate.phase)).length === 1) matches.set(index, candidate.source);
  });
  return matches;
}

/** Read-only repair: legacy mirrors stored a full amount on every edit. */
export function reconcileFollowupPaymentUpdates<T extends FollowupFinancialUpdate>(updates: T[], followups: FollowupSource[]): T[] {
  const legacy = legacyFollowupMatches(updates, followups);
  const sourcesById = new Map(followups.map(source => [String(source.id ?? source.$id ?? ''), source]));
  const normalized = updates.map(update => ({ ...update }));
  const totals = new Map<FollowupSource, number>();
  const chronological = updates.map((update, index) => ({ update, index }))
    .sort((a, b) => Date.parse(a.update.createdAt || '') - Date.parse(b.update.createdAt || ''));
  for (const { update, index } of chronological) {
    const source = update.sourceFollowupId ? sourcesById.get(update.sourceFollowupId) : legacy.get(index);
    if (!source || update.amount == null || !Number.isFinite(update.amount)) continue;
    const previous = totals.get(source) ?? 0;
    const isEdit = totals.has(source);
    const raw = update.status === 'refunded' ? -Math.abs(update.amount) : update.amount;
    const amount = legacy.has(index) ? raw - previous : update.amount;
    normalized[index] = { ...update, amount,
      sourceFollowupId: String(source.id ?? source.$id ?? ''),
      paymentDate: String(source.paymentDate || source.date || ''),
      followupEdit: update.followupEdit || isEdit,
      ...(legacy.has(index) && amount !== update.amount ? { recordedAmount: update.amount } : {}),
    };
    totals.set(source, previous + amount);
  }
  return normalized;
}
