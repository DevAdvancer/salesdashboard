import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { SecurityNotice } from '@/components/security-notice';
import { acknowledgeSecurityNotice, hasAcknowledgedSecurityNotice } from '@/app/actions/security-notice';
jest.mock('@/lib/contexts/auth-context', () => ({ useAuth: () => ({ user: { $id: 'person' } }) }));
jest.mock('@/app/actions/security-notice', () => ({ acknowledgeSecurityNotice: jest.fn(), hasAcknowledgedSecurityNotice: jest.fn() }));
beforeEach(() => { jest.clearAllMocks(); (hasAcknowledgedSecurityNotice as jest.Mock).mockResolvedValue(false); (acknowledgeSecurityNotice as jest.Mock).mockResolvedValue(undefined); });
it('requires an explicit agreement before saving the account acknowledgment', async () => {
  render(<SecurityNotice />);
  const button = await screen.findByRole('button', { name: 'I agree' });
  expect(button).toBeDisabled();
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(button);
  await waitFor(() => expect(acknowledgeSecurityNotice).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
});
it('does not show again for an account that already agreed', async () => {
  (hasAcknowledgedSecurityNotice as jest.Mock).mockResolvedValue(true);
  render(<SecurityNotice />);
  await waitFor(() => expect(hasAcknowledgedSecurityNotice).toHaveBeenCalled());
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});
it('keeps the notice open if saving fails', async () => {
  (acknowledgeSecurityNotice as jest.Mock).mockRejectedValue(new Error('offline'));
  render(<SecurityNotice />);
  await screen.findByRole('dialog');
  fireEvent.click(screen.getByRole('checkbox')); fireEvent.click(screen.getByRole('button', { name: 'I agree' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Could not save');
  expect(screen.getByRole('dialog')).toBeInTheDocument();
});
