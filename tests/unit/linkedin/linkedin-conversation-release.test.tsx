import { render, renderHook, screen } from '@testing-library/react';
import BetaPage from '@/app/beta/page';
import { getMyLinkedinConversationAccessAction } from '@/app/actions/beta';
import { useAuth } from '@/lib/contexts/auth-context';
import { useLinkedinConversationAccess } from '@/lib/hooks/use-linkedin-conversation-access';

jest.mock('@/app/actions/beta', () => ({ getMyLinkedinConversationAccessAction: jest.fn() }));
jest.mock('@/lib/contexts/auth-context', () => ({ useAuth: jest.fn() }));
jest.mock('@/components/protected-route', () => ({
  ProtectedRoute: ({ children, componentKey }: { children: React.ReactNode; componentKey: string }) => (
    <div data-testid="protected-route" data-component-key={componentKey}>{children}</div>
  ),
}));

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(useAuth).mockReturnValue({ user: { $id: 'agent', role: 'agent', department: 'sales', isActive: true },
    serverSessionReady: true } as never);
});

it('keeps the admin Beta page as an empty state without access controls', () => {
  render(<BetaPage />);
  expect(screen.getByTestId('protected-route')).toHaveAttribute('data-component-key', 'beta');
  expect(screen.getByRole('heading', { name: 'Beta' })).toBeInTheDocument();
  expect(screen.getByText('No new features are currently in beta.')).toBeInTheDocument();
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  expect(screen.queryByRole('switch')).not.toBeInTheDocument();
  expect(getMyLinkedinConversationAccessAction).not.toHaveBeenCalled();
});

it.each(['agent', 'team_lead', 'senior_tl', 'lead_generation'])('enables %s without a beta lookup and requires a ready CRM session', role => {
  jest.mocked(useAuth).mockReturnValue({ user: { $id: 'sender', role, department: 'sales', isActive: true },
    serverSessionReady: true } as never);
  const { result, rerender } = renderHook(() => useLinkedinConversationAccess());
  expect(result.current).toBe(true);
  expect(getMyLinkedinConversationAccessAction).not.toHaveBeenCalled();
  jest.mocked(useAuth).mockReturnValue({ user: { $id: 'sender', role, department: 'sales', isActive: true },
    serverSessionReady: false } as never);
  rerender();
  expect(result.current).toBeNull();
});

it.each([{ department: 'resume' }, { isActive: false }, { role: 'compliance' }])(
  'keeps ineligible users blocked for %s', override => {
    jest.mocked(useAuth).mockReturnValue({ user: { $id: 'agent', role: 'agent', department: 'sales', isActive: true, ...override },
      serverSessionReady: true } as never);
    const { result } = renderHook(() => useLinkedinConversationAccess());
    expect(result.current).toBe(false);
    expect(getMyLinkedinConversationAccessAction).not.toHaveBeenCalled();
  },
);
