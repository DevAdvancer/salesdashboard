import { act, render, renderHook, screen, waitFor } from '@testing-library/react';
import { getMyLinkedinConversationAccessAction, listLinkedinConversationBetaUsersAction } from '@/app/actions/beta';
import BetaPage from '@/app/beta/page';
import { useAuth } from '@/lib/contexts/auth-context';
import { useLinkedinConversationAccess } from '@/lib/hooks/use-linkedin-conversation-access';
import { LINKEDIN_CONVERSATION_RELEASE_AT } from '@/lib/utils/linkedin-conversation-release';

jest.mock('@/app/actions/beta', () => ({ getMyLinkedinConversationAccessAction: jest.fn(),
  listLinkedinConversationBetaUsersAction: jest.fn(), setLinkedinConversationBetaAccessAction: jest.fn() }));
jest.mock('@/lib/contexts/auth-context', () => ({ useAuth: jest.fn() }));
jest.mock('@/components/protected-route', () => ({
  ProtectedRoute: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers().setSystemTime(new Date(Date.parse(LINKEDIN_CONVERSATION_RELEASE_AT) - 1000));
  jest.mocked(useAuth).mockReturnValue({ user: { $id: 'agent', role: 'agent', department: 'sales', isActive: true },
    serverSessionReady: true } as never);
  jest.mocked(getMyLinkedinConversationAccessAction).mockResolvedValue(false);
});
afterEach(() => jest.useRealTimers());

it('opens an existing browser tab at launch without another grant read and requires a ready CRM session', async () => {
  const { result, rerender } = renderHook(() => useLinkedinConversationAccess());
  await waitFor(() => expect(result.current).toBe(false));
  act(() => { jest.advanceTimersByTime(1000); });
  expect(result.current).toBe(true);
  expect(getMyLinkedinConversationAccessAction).toHaveBeenCalledTimes(1);
  jest.mocked(useAuth).mockReturnValue({ user: { $id: 'agent', role: 'agent', department: 'sales', isActive: true },
    serverSessionReady: false } as never);
  rerender();
  expect(result.current).toBeNull();
});

it.each([{ department: 'resume' }, { isActive: false }, { role: 'compliance' }])(
  'keeps ineligible users blocked after launch for %s', override => {
    jest.setSystemTime(new Date(LINKEDIN_CONVERSATION_RELEASE_AT));
    jest.mocked(useAuth).mockReturnValue({ user: { $id: 'agent', role: 'agent', department: 'sales', isActive: true, ...override },
      serverSessionReady: true } as never);
    const { result } = renderHook(() => useLinkedinConversationAccess());
    expect(result.current).toBe(false);
    expect(getMyLinkedinConversationAccessAction).not.toHaveBeenCalled();
  },
);

it('opens the retired Beta page after launch without mounting its old grant reader', () => {
  jest.setSystemTime(new Date(LINKEDIN_CONVERSATION_RELEASE_AT));
  render(<BetaPage />);
  expect(screen.getByText('LinkedIn Conversations is available to everyone')).toBeInTheDocument();
  expect(listLinkedinConversationBetaUsersAction).not.toHaveBeenCalled();
});
