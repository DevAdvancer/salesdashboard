import { targetPaymentRecipient, targetUpfrontAmounts } from '@/lib/utils/target-payment-attribution';
import { buildTargetReport, targetReportBranchEntries } from '@/lib/utils/monthly-target-report';
import type { MonthlyTarget, MonthlyTargetAssignment, User } from '@/lib/types';

const contributorIds = new Set(['admin', 'monitor']);
const from = '2026-10-01T00:00:00Z', to = '2026-10-31T23:59:59Z';
const lead = { ownerId: 'agent', closedAt: '2026-10-05T12:00:00Z', data: '{}' };
const payment = (updates: unknown[]) => ({ leadId: 'lead', updates: JSON.stringify(updates), paymentPlan: '{}' });
const paid = (actorId: string, amount: number) => ({ actorId, amount, status: 'partially_paid', createdAt: '2026-10-10T12:00:00Z' });

test('credits Admin and Monitor updates to their profiles while retaining ordinary agent attribution', () => {
  const totals = targetUpfrontAmounts({ payment: payment([paid('admin', 100), paid('monitor', 200), paid('other-agent', 50)]),
    lead, from, to, contributorIds, followups: [] });
  expect(Object.fromEntries(totals)).toEqual({ admin: 100, monitor: 200, agent: 50 });
  expect(targetPaymentRecipient('admin', 'agent', contributorIds, 'explicit-credit')).toBe('explicit-credit');
});

test('does not subtract independent followups from unrelated payment events', () => {
  const totals = targetUpfrontAmounts({ payment: payment([paid('admin', 100), paid('monitor', 200), paid('agent', 50)]),
    lead, from, to, contributorIds, followups: [{ leadId: 'lead', amount: 60 }] });
  expect([...totals.values()].reduce((sum, amount) => sum + amount, 0)).toBe(350);
});

test('uses payment event dates even when the lead closed in an earlier month', () => {
  expect(targetUpfrontAmounts({ payment: payment([{ ...paid('admin', 100), createdAt: '2026-09-10T12:00:00Z' }]),
    lead, from, to, contributorIds, followups: [] }).size).toBe(0);
  expect(targetUpfrontAmounts({ payment: payment([paid('admin', 100)]),
    lead: { ...lead, closedAt: '2026-09-01T12:00:00Z' }, from, to, contributorIds, followups: [] }).get('admin')).toBe(100);
});

test('a followup refund never increases upfront revenue and mirrored entries count only at their source', () => {
  const totals = targetUpfrontAmounts({ payment: payment([
    paid('agent', 500), { ...paid('agent', 200), sourceFollowupId: 'followup' },
    { ...paid('agent', -200), status: 'refunded', sourceFollowupId: 'refund' },
  ]), lead, from, to, contributorIds,
    followups: [{ leadId: 'lead', amount: 200, status: 'refunded' }] });
  expect(totals.get('agent')).toBe(500);
});

test('a direct refund reduces its payment month, regardless of when the record was last edited', () => {
  const cp = { ...payment([{ ...paid('agent', 200), status: 'refunded', paymentDate: '2026-08-31' }]),
    updatedAt: '2026-10-20T12:00:00Z' };
  const args = { payment: cp, lead, contributorIds, followups: [] };
  expect(targetUpfrontAmounts({ ...args, from: '2026-08-01', to: '2026-08-31' }).get('agent')).toBe(-200);
  expect(targetUpfrontAmounts({ ...args, from: '2026-09-01', to: '2026-09-30' }).size).toBe(0);
});

test('payments at the UTC month boundary belong to their Eastern calendar month', () => {
  const cp = payment([{ ...paid('agent', 100), createdAt: '2026-09-01T02:00:00Z' }]);
  const args = { payment: cp, lead, contributorIds, followups: [] };
  expect(targetUpfrontAmounts({ ...args, from: '2026-08-01', to: '2026-08-31' }).get('agent')).toBe(100);
  expect(targetUpfrontAmounts({ ...args, from: '2026-09-01', to: '2026-09-30' }).size).toBe(0);
});

test('legacy followup mirrors are matched individually without reducing another contributor', () => {
  const totals = targetUpfrontAmounts({ payment: payment([paid('admin', 100),
    { ...paid('agent', 200), note: 'Followup payment added' }]), lead, from, to, contributorIds,
    followups: [{ leadId: 'lead', amount: 200, createdAt: '2026-10-10T12:00:01Z' }] });
  expect(Object.fromEntries(totals)).toEqual({ admin: 100 });
});

test('shows Admin and Monitor contributions and raises both report totals without requiring team assignments', () => {
  const users = ['tl', 'agent', 'admin', 'monitor'].map(id => ({ $id: id, name: id, role: id === 'tl' ? 'team_lead' : id,
    branchIds: ['ahm', 'ncr'], primaryBranchId: 'ncr', department: 'sales' })) as User[];
  const result = buildTargetReport({ monthKey: '2026-10',
    targets: [{ $id: 't', teamLeadId: 'tl', totalAmount: 1000 }] as MonthlyTarget[],
    assignmentsByTargetId: { t: [{ agentId: 'agent', amount: 400 }] as MonthlyTargetAssignment[] },
    usersByAgentId: new Map(users.map(user => [user.$id, user])),
    agentStatsByUserId: Object.fromEntries([['agent', 50], ['admin', 100], ['monitor', 200]].map(([id, amount]) =>
      [id, { achieved: amount, leadCount: 0, referralExcludedCount: 0, notInterestedCount: 0 }])),
    branchMap: new Map([['ahm', 'AHM'], ['ncr', 'NCR']]),
  });
  expect(result.totals).toMatchObject({ target: 1300, achieved: 350 });
  expect(result.rows.filter(row => row.kind === 'contributor').map(row => row.teamLeadId).sort()).toEqual(['admin', 'monitor']);
  const agent = result.rows.flatMap(row => row.agents).find(row => row.userId === 'agent')!;
  expect(agent.branchName).toBe('NCR');
  const entries = targetReportBranchEntries([agent]);
  expect(entries.map(entry => entry.branchName)).toEqual(['NCR']);
  expect(entries.filter(entry => entry.primary)).toHaveLength(1);
  expect(entries.filter(entry => entry.primary).reduce((sum, entry) => sum + entry.agent.achieved, 0)).toBe(50);
});
