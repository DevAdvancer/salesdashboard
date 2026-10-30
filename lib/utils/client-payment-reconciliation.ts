import type { ClientPaymentUpdate } from '@/lib/types';
import { reconcileFollowupPaymentUpdates } from '@/lib/utils/followup-payment-attribution';

type PaymentDocument = { leadId?: unknown; updates?: unknown; updatesJson?: unknown };

/** Return copies; the stored amounts and audit actors are never rewritten. */
export function reconcilePaymentDocuments<T extends PaymentDocument>(documents: T[], sources: Record<string, unknown>[]) {
  const output = documents.map(doc => ({ ...doc }));
  const groups = new Map<unknown, number[]>();
  documents.forEach((doc, index) => groups.set(doc.leadId, [...(groups.get(doc.leadId) ?? []), index]));
  for (const [leadId, indices] of groups) {
    const parsed = indices.map(index => {
      try {
        const rows = JSON.parse(String(documents[index]?.updates ?? documents[index]?.updatesJson ?? '[]'));
        return Array.isArray(rows) ? rows.filter(row => row && typeof row === 'object') as ClientPaymentUpdate[] : [];
      } catch { return []; }
    });
    const updates = reconcileFollowupPaymentUpdates(parsed.flat(), sources.filter(source => source.leadId === leadId));
    let offset = 0;
    indices.forEach((index, position) => {
      const length = parsed[position]!.length;
      output[index] = { ...output[index]!, updates: JSON.stringify(updates.slice(offset, offset + length)) };
      offset += length;
    });
  }
  return output;
}
