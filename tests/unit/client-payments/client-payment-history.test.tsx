import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ClientPaymentTimelineCard } from '@/components/client/detail/client-payment-timeline-card';
import type { ClientPaymentRecord } from '@/lib/types';

it('shows payments from both closure cycles, the reopen actor, and a refund', () => {
  const old: ClientPaymentRecord = { $id: 'old', leadId: 'lead', personalDetails: {},
    paymentPlan: { percent: 12, months: 4, upfrontAmount: 1600 }, status: 'fully_paid', createdAt: '2026-08-25T20:00:00Z',
    updates: [{ id: 'paid', status: 'fully_paid', actorId: 'agent', actorName: 'Agent', amount: 1600, createdAt: '2026-08-25T20:00:00Z' }] };
  render(<ClientPaymentTimelineCard paymentRecord={{ ...old, $id: 'new', previousRecords: [old],
    createdAt: '2026-10-19T16:00:00Z', status: 'refunded',
    updates: [{ id: 'refund', status: 'refunded', actorId: 'agent', actorName: 'Agent', amount: -1500, createdAt: '2026-10-19T17:00:00Z' }],
    lifecycleEvents: [{ id: 'reopen', type: 'reopened', actorId: 'tl', actorName: 'Team Lead',
      status: 'Reopened', previousStatus: 'Won', previousClosedAt: old.createdAt, createdAt: '2026-10-19T15:00:00Z' }],
  }} />);
  expect(screen.getByText('Lead reopened')).toBeInTheDocument();
  expect(screen.getByText('Status changed to Refunded')).toBeInTheDocument();
  expect(screen.getByText(/Payment Amount: \$1,600/)).toBeInTheDocument();
  expect(screen.getByText(/Payment Amount: \$-1,500/)).toBeInTheDocument();
  expect(screen.getByText('Updated by: Team Lead')).toBeInTheDocument();
});

it('shows saved lead changes alongside the payment history', () => {
  render(<ClientPaymentTimelineCard paymentRecord={{ $id: 'new', leadId: 'lead', personalDetails: {},
    paymentPlan: { percent: 12, months: 4, upfrontAmount: 500 }, status: 'not_paid',
    createdAt: '2026-10-20T16:00:00Z', updates: [], lifecycleEvents: [{
      id: 'edit', type: 'updated', actorId: 'agent', actorName: 'Agent', status: 'Reopened',
      previousStatus: 'Reopened', previousClosedAt: '2026-10-01T15:00:00Z',
      createdAt: '2026-10-20T15:00:00Z', changes: { leadAmount: { from: 100, to: 500 } },
    }],
  }} />);
  expect(screen.getByText('Lead details updated')).toBeInTheDocument();
  expect(screen.getByText(/leadAmount: 100 → 500/)).toBeInTheDocument();
  expect(screen.getByText('Updated by: Agent')).toBeInTheDocument();
});
