import { reconcilePaymentDocuments } from '@/lib/utils/client-payment-reconciliation';
import { buildClientPaymentHistory, mapFollowupHistoryUpdate } from '@/lib/utils/client-payment-history';
import { targetUpfrontAmounts } from '@/lib/utils/target-payment-attribution';
import type { ClientPaymentRecord, ClientPaymentUpdate } from '@/lib/types';

const source = { $id: 'followup', leadId: 'lead', amount: 500, status: 'paid', date: '2026-09-30',
  createdAt: '2026-10-01T14:18:33.703Z', updatedAt: '2026-10-01T15:21:06.394Z',
  $createdAt: '2026-10-01T15:21:07.001Z', createdByName: 'Alisha', createdById: 'alisha',
  updatedById: 'admin', updatedByName: 'Abhirup', creditedAgentId: 'alisha' };
const updates: ClientPaymentUpdate[] = [
  { id: 'edit', status: 'fully_paid', note: 'Followup payment added', amount: 500,
    actorId: 'admin', actorName: 'Abhirup', createdAt: '2026-10-01T15:21:07.578Z' },
  { id: 'receipt', status: 'fully_paid', note: 'Followup payment added', amount: 500,
    actorId: 'alisha', actorName: 'Alisha', createdAt: '2026-10-01T14:18:34.054Z' },
  { id: 'initial', status: 'partially_paid', note: 'Initialized', amount: 1000,
    actorId: 'alisha', actorName: 'Alisha', createdAt: '2026-08-18T19:39:30.871Z' },
];
const document = { $id: 'payment', leadId: 'lead', updates: JSON.stringify(updates), paymentPlan: '{}' };

test('the screenshot edit contributes zero extra cash and retains its recorded audit amount and actor', () => {
  const before = JSON.stringify({ document, source });
  const result = reconcilePaymentDocuments([document], [source]);
  const rows = JSON.parse(result[0]!.updates) as ClientPaymentUpdate[];
  expect(rows.map(row => row.amount)).toEqual([0, 500, 1000]);
  expect(rows[0]).toMatchObject({ actorName: 'Abhirup', recordedAmount: 500, followupEdit: true, sourceFollowupId: 'followup' });
  expect(rows.reduce((sum, row) => sum + (row.amount ?? 0), 0)).toBe(1500);
  expect(reconcilePaymentDocuments(result, [source])).toEqual(result);
  expect(JSON.stringify({ document, source })).toBe(before);
});

test('history shows one receipt and a separate edit without claiming Abhirup added another payment', () => {
  const record = { $id: 'payment', leadId: 'lead', personalDetails: {}, paymentPlan: {}, status: 'fully_paid',
    updates, createdAt: '2026-08-18T19:39:30.871Z', followupUpdates: [mapFollowupHistoryUpdate(source)] } as ClientPaymentRecord;
  const entries = buildClientPaymentHistory(record);
  expect(entries).toHaveLength(3);
  expect(entries[0]).toMatchObject({ title: 'Follow-up details updated', actorName: 'Abhirup', amount: null });
  expect(entries[1]).toMatchObject({ actorName: 'Alisha', amount: 500, paymentDate: '2026-09-30' });
  expect(entries.reduce((sum, entry) => sum + (entry.amount ?? 0), 0)).toBe(1500);
});

test('both old mirror entries are excluded from upfront target credit', () => {
  expect(targetUpfrontAmounts({ payment: document, lead: { assignedToId: 'alisha', data: '{}' },
    from: '2026-10-01', to: '2026-10-31', contributorIds: new Set(['admin']), followups: [source] }).size).toBe(0);
});

test('later genuine adjustments remain signed deltas and document recreation keeps older edits recognizable', () => {
  const adjusted = { ...source, amount: 700, updatedAt: '2026-10-02T12:00:00Z' };
  const docs = reconcilePaymentDocuments([{ ...document, updates: JSON.stringify([
    { ...updates[0], id: 'adjustment', sourceFollowupId: 'followup', amount: 200, createdAt: '2026-10-02T12:00:00Z' }, ...updates,
  ]) }], [adjusted]);
  expect(JSON.parse(docs[0]!.updates).map((row: ClientPaymentUpdate) => row.amount)).toEqual([200, 0, 500, 1000]);
});

test('two independent equal-value receipts with separate sources stay separate', () => {
  const second = { ...source, $id: 'other', createdAt: '2026-10-02T12:00:00Z', updatedAt: null, $createdAt: '2026-10-02T12:00:00Z' };
  const docs = reconcilePaymentDocuments([{ ...document, updates: JSON.stringify([
    { ...updates[1], id: 'other-receipt', createdAt: second.createdAt }, updates[1], updates[2],
  ]) }], [source, second]);
  expect(JSON.parse(docs[0]!.updates).reduce((sum: number, row: ClientPaymentUpdate) => sum + (row.amount ?? 0), 0)).toBe(2000);
});
