import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import { FollowupsPaymentForm } from '@/components/followups/followups-payment-form';
import { FOLLOWUPS_PAYMENT_COMPANIES } from '@/lib/types';

jest.mock('@/lib/contexts/auth-context', () => ({ useAuth: () => ({
  user: { $id: 'admin', role: 'admin' }, isAdmin: true, serverSessionReady: false,
}) }));
jest.mock('@/app/actions/previous-followups-payments', () => ({ getCreditableAgentsAction: jest.fn() }));
jest.mock('@/app/actions/client-payments/record', () => ({ getClientPaymentRecordAction: jest.fn() }));
jest.mock('@/app/actions/lead/queries', () => ({ listLeadsAction: jest.fn(), getLeadAction: jest.fn() }));

it('keeps Refunded selected when editing a refund and submits its negative amount', async () => {
  const save = jest.fn();
  render(<FollowupsPaymentForm onSave={save} onCancel={jest.fn()} payment={{
    $id: 'refund', leadId: 'manual_followup:client', company: FOLLOWUPS_PAYMENT_COMPANIES[0],
    candidateName: 'Client', amount: -200, status: 'refunded', date: '2026-10-19', createdAt: '2026-10-19T16:00:00Z',
  }} />);
  expect(screen.getByLabelText('Is this a refund?')).toBeChecked();
  expect(screen.getByText('Refunded')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Update Payment' }));
  expect(save).toHaveBeenCalledWith(expect.objectContaining({ amount: -200, status: 'refunded' }));
});

it('selecting a refund changes the status to Refunded', async () => {
  render(<FollowupsPaymentForm onSave={jest.fn()} onCancel={jest.fn()} />);
  await userEvent.click(screen.getByLabelText('Is this a refund?'));
  expect(screen.getByText('Refunded')).toBeInTheDocument();
});
