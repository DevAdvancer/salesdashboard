import fc from 'fast-check';
import type { Lead } from '@/lib/types';
import { getLeadLifecycleEvents, recordLeadLifecycleEvent, recordReopenedLeadChanges } from '@/lib/utils/lead-payment-cycle';

const original = { $id: 'lead', ownerId: 'agent', status: 'Won', isClosed: true,
  closedAt: '2026-10-01T14:00:00Z', data: JSON.stringify({ firstName: 'Client', leadAmount: 100 }) } as Lead;
const reopened = { ...original, isClosed: false, status: 'Reopened',
  data: JSON.stringify(recordLeadLifecycleEvent(original, 'reopened', 'tl', 'Team Lead', 'Reopened', '2026-10-20T14:00:00Z', 'cycle-2')) };

it('preserves the reopen event and captures every saved amount edit without changing its cycle', () => {
  fc.assert(fc.property(fc.integer({ min: 101, max: 100000 }), amount => {
    const next = recordReopenedLeadChanges(reopened, { ...JSON.parse(reopened.data), leadAmount: amount,
      paymentCycleId: 'forged', lifecycleHistory: [] }, 'agent', 'Agent', '2026-10-20T15:00:00Z', 'edit');
    expect(next.paymentCycleId).toBe('cycle-2');
    expect(getLeadLifecycleEvents(next)).toHaveLength(2);
    expect(getLeadLifecycleEvents(next)[1]).toMatchObject({ type: 'updated', actorId: 'agent',
      changes: { leadAmount: { from: 100, to: amount } } });
  }));
});

it('does not create edit events for unchanged saves or initial lead edits', () => {
  const unchanged = recordReopenedLeadChanges(reopened, JSON.parse(reopened.data), 'a', 'Agent', 'now', 'edit');
  expect(getLeadLifecycleEvents(unchanged)).toHaveLength(1);
  expect(getLeadLifecycleEvents(recordReopenedLeadChanges(original, { firstName: 'Changed' }, 'a', 'Agent', 'now', 'edit'))).toHaveLength(0);
});

it('captures follow-up and assignee changes stored outside the business data', () => {
  const next = recordReopenedLeadChanges(reopened, JSON.parse(reopened.data), 'tl', 'Team Lead', 'now', 'edit', {
    assignedToId: 'new-agent', followUpStatus: 'pending',
  });
  expect(getLeadLifecycleEvents(next)[1].changes).toEqual({
    assignedToId: { from: null, to: 'new-agent' }, followUpStatus: { from: null, to: 'pending' },
  });
});
