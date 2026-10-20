jest.mock('@/app/actions/beta', () => ({ getMyLinkedinHelperAccessAction: jest.fn() }));
jest.mock('@/lib/contexts/auth-context', () => ({ useAuth: jest.fn() }));
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { useAuth } from '@/lib/contexts/auth-context';
import { getMyLinkedinHelperAccessAction } from '@/app/actions/beta';
import { LinkedinExtensionSection } from '@/components/linkedin-extension-guide';

beforeEach(() => {
  jest.resetAllMocks();
  document.documentElement.setAttribute('data-crm-hub-linkedin-helper-version', '1.7.0');
  (useAuth as jest.Mock).mockReturnValue({ user: { $id: 'agent', role: 'agent', department: 'sales', isActive: true }, serverSessionReady: true });
});
afterEach(() => document.documentElement.removeAttribute('data-crm-hub-linkedin-helper-version'));

function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return function QueryWrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

it('does not advertise an update to a stable user already running v1.7', async () => {
  (getMyLinkedinHelperAccessAction as jest.Mock).mockResolvedValue(false);
  render(<LinkedinExtensionSection />, { wrapper: wrapper() });
  await waitFor(() => expect(screen.getByText('Detected · v1.7.0')).toBeInTheDocument());
  expect(screen.queryByText(/Update/)).not.toBeInTheDocument();
  expect(screen.queryByText(/1\.8\.9/)).not.toBeInTheDocument();
});

it('shows the beta update to a selected user and never shares cached beta access across sign-ins', async () => {
  (getMyLinkedinHelperAccessAction as jest.Mock).mockResolvedValue(true);
  const view = render(<LinkedinExtensionSection />, { wrapper: wrapper() });
  expect(await screen.findByText(/Update available: download LinkedIn Helper v1.8.9/)).toBeInTheDocument();
  (useAuth as jest.Mock).mockReturnValue({ user: { $id: 'other-agent', role: 'agent', department: 'sales', isActive: true }, serverSessionReady: true });
  (getMyLinkedinHelperAccessAction as jest.Mock).mockResolvedValue(false);
  view.rerender(<LinkedinExtensionSection />);
  expect(screen.queryByText(/1\.8\.9/)).not.toBeInTheDocument();
  await waitFor(() => expect(screen.getByText('Detected · v1.7.0')).toBeInTheDocument());
});

it('waits for the server session cookie before checking beta access', () => {
  (useAuth as jest.Mock).mockReturnValue({ user: { $id: 'agent', role: 'agent' }, serverSessionReady: false });
  render(<LinkedinExtensionSection />, { wrapper: wrapper() });
  expect(screen.getByText('Loading LinkedIn Helper…')).toBeInTheDocument();
  expect(getMyLinkedinHelperAccessAction).not.toHaveBeenCalled();
});
