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

test('deducts each followup only once when a payment has multiple credited people', () => {
  const totals = targetUpfrontAmounts({ payment: payment([paid('admin', 100), paid('monitor', 200), paid('agent', 50)]),
    lead, from, to, contributorIds, followups: [{ leadId: 'lead', amount: 60 }] });
  expect([...totals.values()].reduce((sum, amount) => sum + amount, 0)).toBe(290);
});

test('does not count out-of-range updates or payments from prior closure cycles', () => {
  expect(targetUpfrontAmounts({ payment: payment([{ ...paid('admin', 100), createdAt: '2026-09-10T12:00:00Z' }]),
    lead, from, to, contributorIds, followups: [] }).size).toBe(0);
  expect(targetUpfrontAmounts({ payment: payment([paid('admin', 100)]),
    lead: { ...lead, closedAt: '2026-09-01T12:00:00Z' }, from, to, contributorIds, followups: [] }).size).toBe(0);
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
