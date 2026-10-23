import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ClientPaymentTimelineCard } from '@/components/client/detail/client-payment-timeline-card';
import type { ClientPaymentRecord } from '@/lib/types';
import { buildClientPaymentHistory, mapFollowupHistoryUpdate } from '@/lib/utils/client-payment-history';

it('shows payments from both closure cycles and a refund without lead lifecycle events', () => {
  const old: ClientPaymentRecord = { $id: 'old', leadId: 'lead', personalDetails: {},
    paymentPlan: { percent: 12, months: 4, upfrontAmount: 1600 }, status: 'fully_paid', createdAt: '2026-08-25T20:00:00Z',
    updates: [{ id: 'paid', status: 'fully_paid', actorId: 'agent', actorName: 'Agent', amount: 1600, createdAt: '2026-08-25T20:00:00Z' }] };
  render(<ClientPaymentTimelineCard paymentRecord={{ ...old, $id: 'new', previousRecords: [old],
    createdAt: '2026-10-19T16:00:00Z', status: 'refunded',
    updates: [{ id: 'refund', status: 'refunded', actorId: 'agent', actorName: 'Agent', amount: -1500, createdAt: '2026-10-19T17:00:00Z' }],
    lifecycleEvents: [{ id: 'reopen', type: 'reopened', actorId: 'tl', actorName: 'Team Lead',
      status: 'Reopened', previousStatus: 'Won', previousClosedAt: old.createdAt, createdAt: '2026-10-19T15:00:00Z' },
      { id: 'edit', type: 'updated', actorId: 'tl', actorName: 'Team Lead', status: 'Reopened',
        previousStatus: 'Reopened', previousClosedAt: old.createdAt, createdAt: '2026-10-19T15:30:00Z',
        changes: { company: { from: 'Silverspace INC', to: 'Vizva INC' } } },
      { id: 'close', type: 'closed', actorId: 'tl', actorName: 'Team Lead', status: 'Won',
        previousStatus: 'Reopened', previousClosedAt: null, createdAt: '2026-10-19T16:00:00Z' }],
  }} />);
  expect(screen.queryByText(/Lead reopened|Lead details updated|Lead closed/)).not.toBeInTheDocument();
  expect(screen.queryByText(/Silverspace INC|Vizva INC/)).not.toBeInTheDocument();
  expect(screen.getByText('Status changed to Fully Paid')).toBeInTheDocument();
  expect(screen.getByText('Status changed to Refunded')).toBeInTheDocument();
  expect(screen.getByText(/Payment Amount: \$1,600/)).toBeInTheDocument();
  expect(screen.getByText(/Payment Amount: \$-1,500/)).toBeInTheDocument();
  expect(screen.queryByText('Updated by: Team Lead')).not.toBeInTheDocument();
  expect(screen.getAllByText('Updated by: Agent')).toHaveLength(2);
  expect(screen.getAllByText(/Payment cycle:/)).toHaveLength(2);
  const amounts = screen.getAllByText(/Payment Amount:/);
  expect(amounts[0]).toHaveTextContent('$-1,500.00');
  expect(amounts[1]).toHaveTextContent('$1,600.00');
});

it('shows the empty state when there are lead changes but no payment updates', () => {
  render(<ClientPaymentTimelineCard paymentRecord={{ $id: 'new', leadId: 'lead', personalDetails: {},
    paymentPlan: { percent: 12, months: 4, upfrontAmount: 500 }, status: 'not_paid',
    createdAt: '2026-10-20T16:00:00Z', updates: [], lifecycleEvents: [{
      id: 'edit', type: 'updated', actorId: 'agent', actorName: 'Agent', status: 'Reopened',
      previousStatus: 'Reopened', previousClosedAt: '2026-10-01T15:00:00Z',
      createdAt: '2026-10-20T15:00:00Z', changes: { leadAmount: { from: 100, to: 500 } },
    }],
  }} />);
  expect(screen.getByText('No updates recorded yet.')).toBeInTheDocument();
  expect(screen.queryByText('Lead details updated')).not.toBeInTheDocument();
  expect(screen.queryByText(/leadAmount: 100 → 500/)).not.toBeInTheDocument();
  expect(screen.queryByText('Updated by: Agent')).not.toBeInTheDocument();
});

const base: ClientPaymentRecord = { $id: 'payment', leadId: 'lead', personalDetails: {},
  paymentPlan: { percent: 12, months: 4, upfrontAmount: 1000 }, status: 'partially_paid',
  createdAt: '2026-06-23T18:56:54Z', updates: [{ id: 'initial', status: 'partially_paid',
    amount: 1000, note: 'Initialized', actorId: 'agent', actorName: 'Agent', createdAt: '2026-06-23T18:56:54Z' }] };

it('shows a saved zero-dollar follow-up note without claiming the client is fully paid', () => {
  render(<ClientPaymentTimelineCard paymentRecord={{ ...base, followupUpdates: [mapFollowupHistoryUpdate({
    $id: 'followup', amount: 0, status: 'paid', date: '2026-10-21', createdAt: '2026-10-21T14:01:45Z',
    createdById: 'agent', createdByName: 'Agent', paymentRemark: 'Waiting for interview before paying the balance',
  })] }} />);
  expect(screen.getByText('Payment follow-up recorded')).toBeInTheDocument();
  expect(screen.getByText('Follow-up Amount: $0.00')).toBeInTheDocument();
  expect(screen.getByText(/Waiting for interview before paying the balance/)).toBeInTheDocument();
  expect(screen.queryByText('Status changed to Fully Paid')).not.toBeInTheDocument();
  expect(screen.getByText('Follow-up date: 2026-10-21')).toBeInTheDocument();
  expect(screen.getAllByText('Updated by: Agent')).toHaveLength(2);
});

it('does not duplicate follow-ups already mirrored into any prior closure cycle', () => {
  const update = { id: 'mirror', sourceFollowupId: 'followup', status: 'fully_paid' as const,
    amount: 200, note: 'Received balance', actorId: 'agent', actorName: 'Agent', createdAt: '2026-09-01T14:00:00Z' };
  const record: ClientPaymentRecord = { ...base, previousRecords: [{ ...base, $id: 'old', updates: [update] }],
    followupUpdates: [{ id: 'followup', status: 'paid', amount: 200, note: 'Received balance', actorId: 'agent',
      actorName: 'Agent', createdAt: '2026-09-01T13:59:59Z', paymentDate: '2026-09-01' }] };
  const before = JSON.stringify(record);
  render(<ClientPaymentTimelineCard paymentRecord={record} />);
  expect(screen.getAllByText(/Received balance/)).toHaveLength(1);
  expect(screen.getAllByText(/Payment Amount: \$200/)).toHaveLength(1);
  expect(screen.queryByText(/Follow-up Amount/)).not.toBeInTheDocument();
  expect(JSON.stringify(record)).toBe(before);
});

it('shows remark-only edits even when the financial mirror did not create another update', () => {
  const record: ClientPaymentRecord = { ...base, updates: [...base.updates, {
    id: 'mirror', sourceFollowupId: 'followup', status: 'partially_paid', amount: 200, note: 'First note',
    actorId: 'agent', actorName: 'Agent', createdAt: '2026-10-21T14:01:45Z',
  }], followupUpdates: [mapFollowupHistoryUpdate({
    $id: 'followup', amount: 200, status: 'paid', date: '2026-10-21', createdAt: '2026-10-21T14:01:45Z',
    createdByName: 'Agent', updatedAt: '2026-10-22T15:00:00Z', updatedByName: 'Manager',
    paymentRemark: 'Client promised the next installment tomorrow',
  })] };
  render(<ClientPaymentTimelineCard paymentRecord={record} />);
  expect(screen.getByText('Payment follow-up updated')).toBeInTheDocument();
  expect(screen.getByText(/Client promised the next installment tomorrow/)).toBeInTheDocument();
  expect(screen.getByText('Updated by: Manager')).toBeInTheDocument();
  expect(screen.getAllByText(/Payment Amount: \$200/)).toHaveLength(1);
  expect(screen.queryByText(/Follow-up Amount/)).not.toBeInTheDocument();
});

it('keeps refund adjustments and shows an unsynced refund with a signed amount', () => {
  const record: ClientPaymentRecord = { ...base, followupUpdates: [mapFollowupHistoryUpdate({
    $id: 'refund', amount: 200, status: 'refunded', remark: 'Refund confirmed',
    createdAt: '2026-10-22T15:00:00Z', date: '2026-10-22', createdByName: 'Agent',
  })] };
  const entries = buildClientPaymentHistory(record);
  expect(entries[0]).toMatchObject({ kind: 'followup', amount: -200, note: 'Refund confirmed' });
  expect(record.status).toBe('partially_paid');
  expect(record.updates.reduce((sum, update) => sum + (update.amount ?? 0), 0)).toBe(1000);
});
