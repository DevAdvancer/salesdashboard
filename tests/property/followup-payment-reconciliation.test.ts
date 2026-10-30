import fc from 'fast-check';
import { reconcilePaymentDocuments } from '@/lib/utils/client-payment-reconciliation';
import type { ClientPaymentUpdate } from '@/lib/types';

test('legacy full-value edits conserve the final receipt balance, preserve actors, and remain idempotent', () => {
  fc.assert(fc.property(fc.integer({ min: 1, max: 100000 }), fc.integer({ min: 0, max: 100000 }), fc.boolean(),
    (received, edited, refunded) => {
      const source = { $id: 'source', leadId: 'lead', amount: edited, status: refunded ? 'refunded' : 'paid',
        date: '2026-09-30', createdAt: '2026-10-01T14:18:33Z', updatedAt: '2026-10-01T15:21:06Z' };
      const raw = [
        { id: 'edit', actorId: 'editor', actorName: 'Editor', amount: edited, status: refunded ? 'refunded' : 'fully_paid',
          note: 'Followup payment added', createdAt: '2026-10-01T15:21:07Z' },
        { id: 'original', actorId: 'creator', actorName: 'Creator', amount: received, status: 'partially_paid',
          note: 'Followup payment added', createdAt: '2026-10-01T14:18:34Z' },
      ];
      const document = { $id: 'payment', leadId: 'lead', updates: JSON.stringify(raw) };
      const before = JSON.stringify({ source, document });
      const normalized = reconcilePaymentDocuments([document], [source]);
      const updates = JSON.parse(normalized[0]!.updates) as ClientPaymentUpdate[];
      expect(updates.reduce((sum, update) => sum + (update.amount ?? 0), 0)).toBe((refunded ? -edited : edited) || 0);
      expect(updates.map(update => update.actorId)).toEqual(['editor', 'creator']);
      expect(reconcilePaymentDocuments(normalized, [source])).toEqual(normalized);
      expect(JSON.stringify({ source, document })).toBe(before);
    }));
});
