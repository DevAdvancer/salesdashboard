jest.mock('@/app/actions/beta', () => ({ listLinkedinHelperBetaUsersAction: jest.fn(), setLinkedinHelperBetaAccessAction: jest.fn() }));
jest.mock('@/lib/contexts/auth-context', () => ({ useAuth: () => ({ user: { $id: 'admin', role: 'admin', isActive: true }, serverSessionReady: true }) }));
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LinkedinBetaManagement } from '@/components/linkedin-beta-management';
import { listLinkedinHelperBetaUsersAction, setLinkedinHelperBetaAccessAction } from '@/app/actions/beta';

const users = [{ id: 'agent', name: 'Agent One', email: 'one@example.test', role: 'agent', eligible: true, enabled: false }];
beforeEach(() => jest.resetAllMocks());

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={client}><LinkedinBetaManagement /></QueryClientProvider>);
}

it('lets the admin select an individual user and shows the saved grant after reloading the list', async () => {
  (listLinkedinHelperBetaUsersAction as jest.Mock).mockResolvedValue(users);
  (setLinkedinHelperBetaAccessAction as jest.Mock).mockImplementation(async () => {
    (listLinkedinHelperBetaUsersAction as jest.Mock).mockResolvedValue([{ ...users[0], enabled: true }]);
  });
  mount();
  fireEvent.click(await screen.findByRole('switch', { name: 'Beta access for Agent One' }));
  await waitFor(() => expect(setLinkedinHelperBetaAccessAction).toHaveBeenCalledWith('agent', true));
  await waitFor(() => expect(screen.getByRole('switch')).toBeChecked());
  expect(screen.getByText('1 selected')).toBeInTheDocument();
});

it('keeps stable access displayed when the grant could not be saved', async () => {
  (listLinkedinHelperBetaUsersAction as jest.Mock).mockResolvedValue(users);
  (setLinkedinHelperBetaAccessAction as jest.Mock).mockRejectedValue(new Error('Please retry.'));
  mount();
  fireEvent.click(await screen.findByRole('switch'));
  expect(await screen.findByRole('alert')).toHaveTextContent('Unable to save access');
  expect(screen.getByRole('switch')).not.toBeChecked();
});
