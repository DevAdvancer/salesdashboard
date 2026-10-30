import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import { FollowupsPaymentForm } from '@/components/followups/followups-payment-form';
import { FOLLOWUPS_PAYMENT_COMPANIES } from '@/lib/types';
import { listLeadsAction, getLeadAction } from '@/app/actions/lead/queries';
import { listClientPaymentSummariesAction } from '@/app/actions/client-payments/list';
import { getClientPaymentRecordAction } from '@/app/actions/client-payments/record';
import { getCreditableAgentsAction } from '@/app/actions/previous-followups-payments';

let mockSessionReady = false;
const mockUser = { $id: 'admin', role: 'admin' };

jest.mock('@/lib/contexts/auth-context', () => ({ useAuth: () => ({
  user: mockUser, isAdmin: true, serverSessionReady: mockSessionReady,
}) }));
jest.mock('@/app/actions/previous-followups-payments', () => ({ getCreditableAgentsAction: jest.fn() }));
jest.mock('@/app/actions/client-payments/record', () => ({ getClientPaymentRecordAction: jest.fn() }));
jest.mock('@/app/actions/client-payments/list', () => ({ listClientPaymentSummariesAction: jest.fn() }));
jest.mock('@/app/actions/lead/queries', () => ({ listLeadsAction: jest.fn(), getLeadAction: jest.fn() }));

beforeEach(() => {
  mockSessionReady = false;
  jest.clearAllMocks();
  jest.mocked(getCreditableAgentsAction).mockResolvedValue([]);
  jest.mocked(getClientPaymentRecordAction).mockResolvedValue(null);
});

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

it('adds an independent BGC profile without selecting a client', async () => {
  const save = jest.fn();
  render(<FollowupsPaymentForm onSave={save} onCancel={jest.fn()} />);
  await userEvent.click(screen.getByRole('button', { name: 'BGC' }));
  await userEvent.type(screen.getByPlaceholderText('Enter candidate name'), 'BGC Profile');
  await userEvent.click(screen.getByRole('button', { name: 'Add Payment' }));
  expect(save).toHaveBeenCalledWith(expect.objectContaining({ category: 'bgc', leadId: null,
    candidateName: 'BGC Profile', hasPaymentRecord: false }));
});

it('keeps the independent BGC identifier when editing', async () => {
  const save = jest.fn();
  render(<FollowupsPaymentForm onSave={save} onCancel={jest.fn()} payment={{
    $id: 'bgc', leadId: 'manual_followup:bgc:profile', category: 'bgc', company: FOLLOWUPS_PAYMENT_COMPANIES[0],
    candidateName: 'BGC Profile', amount: 200, status: 'paid', date: '2026-08-20', createdAt: '2026-09-01T12:00:00Z',
  }} />);
  await userEvent.click(screen.getByRole('button', { name: 'Update Payment' }));
  expect(save).toHaveBeenCalledWith(expect.objectContaining({ category: 'bgc', leadId: 'manual_followup:bgc:profile' }));
});

it('finds an old payment client whose lead has since been reopened', async () => {
  mockSessionReady = true;
  const lead = { $id: 'old-client', isClosed: false, status: 'Reopened',
    $createdAt: '2025-01-01T12:00:00Z', data: JSON.stringify({ firstName: 'Old', lastName: 'Client' }) };
  jest.mocked(listLeadsAction).mockResolvedValue({ leads: [lead] as any, total: 1, page: 1, pageSize: 50 });
  jest.mocked(getLeadAction).mockResolvedValue(lead as any);
  jest.mocked(listClientPaymentSummariesAction).mockResolvedValue([{ leadId: 'old-client' }] as any);
  render(<FollowupsPaymentForm onSave={jest.fn()} onCancel={jest.fn()} />);
  await userEvent.click(screen.getByRole('button', { name: 'Client Entry (Tracked)' }));
  await userEvent.type(screen.getByPlaceholderText('Type to search your assigned clients...'), 'Old');
  expect(await screen.findByRole('button', { name: 'Old Client' })).toBeInTheDocument();
  expect(listLeadsAction).toHaveBeenCalledWith(expect.objectContaining({ includeClosed: true, searchQuery: 'Old' }),
    'admin', 'admin', undefined, { page: 1, pageSize: 50 });
});

it('a delayed agent-options response cannot change client credit to the admin recording it', async () => {
  mockSessionReady = true;
  let finishAgents!: (agents: Array<{ id: string; name: string }>) => void;
  jest.mocked(getCreditableAgentsAction).mockReturnValue(new Promise(resolve => { finishAgents = resolve; }));
  const lead = { $id: 'client', isClosed: true, status: 'Won', ownerId: 'pankaj', assignedToId: 'pankaj',
    data: JSON.stringify({ firstName: 'Assigned', lastName: 'Client' }) };
  jest.mocked(listLeadsAction).mockResolvedValue({ leads: [lead] as any, total: 1, page: 1, pageSize: 50 });
  jest.mocked(getLeadAction).mockResolvedValue(lead as any);
  jest.mocked(listClientPaymentSummariesAction).mockResolvedValue([{ leadId: 'client' }] as any);
  const save = jest.fn();
  render(<FollowupsPaymentForm onSave={save} onCancel={jest.fn()} />);
  await userEvent.click(screen.getByRole('button', { name: 'Client Entry (Tracked)' }));
  await userEvent.type(screen.getByPlaceholderText('Type to search your assigned clients...'), 'Assigned');
  await userEvent.click(await screen.findByRole('button', { name: 'Assigned Client' }));
  await act(async () => { finishAgents([{ id: 'admin', name: 'Admin' }, { id: 'pankaj', name: 'Pankaj' }]); });
  await userEvent.click(screen.getByRole('button', { name: 'Add Payment' }));
  expect(save).toHaveBeenCalledWith(expect.objectContaining({ leadId: 'client', creditedAgentId: null }));
});
