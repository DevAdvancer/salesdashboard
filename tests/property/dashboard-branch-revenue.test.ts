import fc from 'fast-check';
import { dashboardBranchRevenue, dashboardPaymentAmounts, dashboardUpfrontReceipts } from '@/lib/utils/dashboard-branch-revenue';

test('branch splits reconcile to dashboard revenue, including unassigned receipts and excluding outstanding debts', () => {
  const record = fc.record({ branchId: fc.constantFrom('ncr', 'ahm', null), upfrontAmount: fc.integer({ min: 0, max: 50000 }),
    upfrontReceived: fc.integer({ min: -5000, max: 50000 }),
    leadAmount: fc.integer({ min: 0, max: 100000 }), followupsTotal: fc.integer({ min: -5000, max: 5000 }),
    pendingTotal: fc.integer({ min: 0, max: 100000 }), totalPaid: fc.integer({ min: 0, max: 100000 }),
    isFollowupOnly: fc.boolean(), leadStatus: fc.constantFrom('Won', 'Signed/Closure', 'Backed Out', 'Not Interested') });
  fc.assert(fc.property(fc.array(record, { maxLength: 30 }), records => {
    const technical = [{ branchId: 'ncr', amount: 75 }, { branchId: null, amount: 25 }];
    const result = dashboardBranchRevenue(records, technical, ['ncr', 'ahm']);
    const expected = records.reduce((sum, row) => { const amounts = dashboardPaymentAmounts(row); return sum + amounts.upfront + amounts.followups; }, 100);
    expect(result.totals.ncr + result.totals.ahm + result.unassigned).toBe(expected);
    const alteredDebts = records.map(row => ({ ...row, pendingTotal: row.pendingTotal + 99999, totalPaid: row.totalPaid + 99999 }));
    expect(dashboardBranchRevenue(alteredDebts, technical, ['ncr', 'ahm'])).toEqual(result);
  }));
});

test('follow-up receipts retain their own closure branch after a lead closes under a different branch', () => {
  const result = dashboardBranchRevenue([{ branchId: 'ahm', upfrontAmount: 300, leadAmount: 3000, leadStatus: 'Won',
    upfrontReceived: 300,
    followupsTotal: 150, followupsBranchAmounts: { ncr: 100, ahm: 50 } }], [], ['ncr', 'ahm']);
  expect(result).toEqual({ totals: { ncr: 100, ahm: 350 }, unassigned: 0 });
});

test('unpaid plans never become receipts and mirrored follow-ups are never counted twice', () => {
  const updates = [
    { id: 'unpaid', status: 'not_paid', amount: 5000, createdAt: '2026-11-02T17:00:00Z' },
    { id: 'paid', status: 'partially_paid', amount: 1200, createdAt: '2026-11-02T18:00:00Z' },
    { id: 'mirror', sourceFollowupId: 'source', status: 'fully_paid', amount: 5000, createdAt: '2026-11-02T18:30:00Z' },
  ] as any;
  expect(dashboardUpfrontReceipts(updates, '2026-11-02', '2026-11-02').amount).toBe(1200);
  expect(dashboardPaymentAmounts({ branchId: 'ncr', leadStatus: 'Won', leadAmount: 10000, upfrontAmount: 6200, upfrontReceived: 1200, followupsTotal: 0 }).upfront).toBe(1200);
  expect(dashboardPaymentAmounts({ branchId: 'ncr', leadStatus: 'Won', leadAmount: 10000, upfrontAmount: 6200, followupsTotal: 0 }).upfront).toBe(0);
});
