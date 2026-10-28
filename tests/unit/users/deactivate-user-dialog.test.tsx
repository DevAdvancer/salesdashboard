import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { DeactivateUserDialog } from '@/components/users/deactivate-user-dialog';
import { previewUserDeactivationAction, setAgentActiveAction } from '@/app/actions/user';
import type { User } from '@/lib/types';

jest.mock('@/app/actions/user', () => ({ previewUserDeactivationAction: jest.fn(), setAgentActiveAction: jest.fn() }));
const target = { $id: 'agent', name: 'Departing Agent', isActive: true } as User;
const initial = { hash: 'preview-tl', recipientId: 'tl', openLeads: 5, closedLeads: 2, requests: 9, accounts: 3,
  recipients: [{ $id: 'tl', name: 'Team Lead', role: 'team_lead' }, { $id: 'new', name: 'New Agent', role: 'agent' }] };

beforeEach(() => {
  jest.resetAllMocks();
  (previewUserDeactivationAction as jest.Mock).mockImplementation(async input => ({ ...initial,
    recipientId: input.recipientId || 'tl', hash: `preview-${input.recipientId || 'tl'}` }));
  (setAgentActiveAction as jest.Mock).mockResolvedValue({ success: true });
});

it('previews open and closed leads, permits self-handoff and confirms only the selected fresh preview', async () => {
  const close = jest.fn(), complete = jest.fn().mockResolvedValue(undefined);
  render(<DeactivateUserDialog target={target} actorId="tl" onClose={close} onComplete={complete} />);
  expect(setAgentActiveAction).not.toHaveBeenCalled();
  expect(await screen.findByText(/5 open leads and 2 closed leads/)).toBeInTheDocument();
  expect(screen.getByRole('option', { name: /myself/ })).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Hand all leads to'), { target: { value: 'new' } });
  await waitFor(() => expect(screen.getByLabelText('Hand all leads to')).toHaveValue('new'));
  fireEvent.click(screen.getByRole('button', { name: 'Confirm handoff and inactivate' }));
  await waitFor(() => expect(setAgentActiveAction).toHaveBeenCalledWith({ userId: 'agent', currentUserId: 'tl',
    isActive: false, recipientId: 'new', planHash: 'preview-new' }));
  await waitFor(() => expect(close).toHaveBeenCalled());
});

it('keeps failures visible and requires a fresh preview before a retry', async () => {
  (setAgentActiveAction as jest.Mock).mockRejectedValue(new Error('Login is disabled. Handoff is incomplete.'));
  const close = jest.fn();
  render(<DeactivateUserDialog target={target} actorId="tl" onClose={close} onComplete={jest.fn().mockResolvedValue(undefined)} />);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Confirm handoff and inactivate' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'Confirm handoff and inactivate' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Handoff is incomplete');
  expect(close).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'Confirm handoff and inactivate' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Refresh preview' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Confirm handoff and inactivate' })).toBeEnabled());
  expect(setAgentActiveAction).toHaveBeenCalledTimes(1);
});

it('continues a large handoff with fresh previews and the same chosen recipient', async () => {
  (setAgentActiveAction as jest.Mock).mockResolvedValueOnce({ leadsTransferred: 10, remainingLeads: 3 })
    .mockResolvedValueOnce({ leadsTransferred: 3, remainingLeads: 0 });
  const close = jest.fn();
  render(<DeactivateUserDialog target={target} actorId="tl" onClose={close} onComplete={jest.fn().mockResolvedValue(undefined)} />);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Confirm handoff and inactivate' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'Confirm handoff and inactivate' }));
  await waitFor(() => expect(close).toHaveBeenCalled());
  expect(setAgentActiveAction).toHaveBeenCalledTimes(2);
  expect(previewUserDeactivationAction).toHaveBeenLastCalledWith({ currentUserId: 'tl', userId: 'agent', recipientId: 'tl' });
  for (const [input] of (setAgentActiveAction as jest.Mock).mock.calls) expect(input.recipientId).toBe('tl');
});
