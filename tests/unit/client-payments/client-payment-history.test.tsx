import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ClientPaymentTimelineCard } from '@/components/client/detail/client-payment-timeline-card';
import type { ClientPaymentRecord } from '@/lib/types';

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
