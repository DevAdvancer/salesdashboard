import fc from 'fast-check';
import { targetReportBranchSplits } from '@/lib/utils/target-report-branch-splits';
import type { User } from '@/lib/types';
import type { TargetReportResult } from '@/lib/utils/monthly-target-report';

function run(selected: number, legacy: number, extra = false) {
  const users = new Map<string, User>([['owner', { $id: 'owner', branchIds: ['ahm', 'ncr'], primaryBranchId: 'ahm' } as User]]);
  const leads = new Map([['selected', { ownerId: 'owner' }], ['legacy', { ownerId: 'owner' }]]);
  const payments = [
    { leadId: 'selected', paymentPlan: JSON.stringify({ closure: { ownerId: 'owner', branchId: 'ncr', branchSource: 'selected' } }), updates: JSON.stringify([{ amount: selected, status: 'fully_paid', createdAt: '2026-11-02T12:00:00Z' }]) },
    { leadId: 'legacy', paymentPlan: JSON.stringify({ closure: { ownerId: 'owner', branchId: 'ncr' } }), updates: JSON.stringify([{ amount: legacy, status: 'fully_paid', createdAt: '2026-11-02T12:00:00Z' }]) },
  ];
  if (extra) {
    users.set('hidden', { $id: 'hidden', primaryBranchId: 'ncr' } as User);
    leads.set('hidden', { ownerId: 'hidden' });
    payments.push({ leadId: 'hidden', paymentPlan: JSON.stringify({ closure: { ownerId: 'hidden', branchId: 'ncr', branchSource: 'selected' } }), updates: JSON.stringify([{ amount: 99999, status: 'fully_paid', createdAt: '2026-11-02T12:00:00Z' }]) });
  }
  const result = { rows: [{ agents: [{ userId: 'owner', achieved: selected + legacy }] }] } as TargetReportResult;
  return targetReportBranchSplits({ result, users, leads, payments, branches: new Map([['ncr', 'NCR'], ['ahm', 'AHM']]),
    contributorIds: new Set(), followups: [], from: '2026-10-02', to: '2026-11-02' });
}

test('target report keeps the confirmed 1200 NCR choice and defaults legacy 5000 to AHM', () => {
  expect(run(1200, 5000)).toEqual([{ branchId: 'ncr', branchName: 'NCR', amount: 1200 }, { branchId: 'ahm', branchName: 'AHM', amount: 5000 }]);
});

test('branch splits conserve achieved revenue, including refunds, without leaking other profiles', () => {
  fc.assert(fc.property(fc.integer({ min: -100000, max: 100000 }), fc.integer({ min: -100000, max: 100000 }), (selected, legacy) => {
    const splits = run(selected, legacy, true);
    expect(splits.find(split => split.branchId === 'ncr')?.amount).toBe(selected);
    expect(splits.find(split => split.branchId === 'ahm')?.amount).toBe(legacy);
    expect(splits.reduce((sum, split) => sum + split.amount, 0)).toBe(selected + legacy);
  }));
});
