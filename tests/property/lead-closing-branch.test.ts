import fc from 'fast-check';
import { paymentReportingBranch, resolveLeadClosingBranch } from '@/lib/utils/lead-closing-branch';
import { snapshotPaymentPlan } from '@/lib/utils/lead-payment-cycle';
import type { Lead } from '@/lib/types';

test('an agent can credit exactly one assigned branch, never a forged branch or an omitted multi-branch choice', () => {
  fc.assert(fc.property(fc.uniqueArray(fc.uuid(), { minLength: 1, maxLength: 6 }), fc.uuid(), (branchIds, other) => {
    fc.pre(!branchIds.includes(other));
    const actor = { role: 'agent' as const, branchIds, primaryBranchId: branchIds[0], branchId: null };
    for (const id of branchIds) expect(resolveLeadClosingBranch(actor, { branchId: other }, id)).toBe(id);
    expect(() => resolveLeadClosingBranch(actor, { branchId: other }, other)).toThrow('assigned branches');
    if (branchIds.length > 1) expect(() => resolveLeadClosingBranch(actor, { branchId: other })).toThrow('Choose the branch');
    else expect(resolveLeadClosingBranch(actor, { branchId: other })).toBe(branchIds[0]);
  }));
});

test('a later branch choice never changes the snapshot of a previous closure cycle', () => {
  fc.assert(fc.property(fc.uuid(), fc.uuid(), (firstBranch, nextBranch) => {
    const lead = { $id: 'lead', branchId: firstBranch, ownerId: 'agent', assignedToId: 'agent' } as Lead;
    const plan = { percent: 10, months: 3, upfrontAmount: 1000 };
    const first = snapshotPaymentPlan(plan, lead, {}, '2026-10-01T12:00:00Z');
    const next = snapshotPaymentPlan(plan, { ...lead, branchId: nextBranch }, { paymentCycleId: 'new' }, '2026-11-01T12:00:00Z');
    expect(first.closure?.branchId).toBe(firstBranch);
    expect(next.closure?.branchId).toBe(nextBranch);
  }));
});

test('only an explicit closing choice overrides the owner primary branch, across all companies', () => {
  fc.assert(fc.property(fc.uuid(), fc.uuid(), (primary, inherited) => {
    expect(paymentReportingBranch({ branchId: inherited }, primary)).toBe(primary);
    expect(paymentReportingBranch({ branchId: inherited, branchSource: 'primary' }, primary)).toBe(primary);
    expect(paymentReportingBranch({ branchId: inherited, branchSource: 'selected' }, primary)).toBe(inherited);
  }));
});

test('the confirmed 1200 NCR selection stays NCR while legacy 5000 follows AHM', () => {
  const rows = [{ amount: 1200, closure: { branchId: 'NCR', branchSource: 'selected' } },
    ...[1500, 1500, 500, 1500].map(amount => ({ amount, closure: { branchId: 'NCR' } }))];
  const totals: Record<string, number> = {};
  for (const row of rows) {
    const branch = paymentReportingBranch(row.closure, 'AHM')!;
    totals[branch] = (totals[branch] || 0) + row.amount;
  }
  expect(totals).toEqual({ NCR: 1200, AHM: 5000 });
});
