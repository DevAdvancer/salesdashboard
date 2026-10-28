import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useEffect } from 'react';
import { CrmSecurityGate } from '@/components/crm-security-gate';

const mockLogout = jest.fn(); const mockRecoverServerSession = jest.fn(); const mockRetryRestore = jest.fn();
const mockUser = { $id: 'agent', name: 'Agent', email: 'agent@example.com', role: 'agent' };
let mockLoading = false; let mockRestoreError = ''; let mockInitialAccess: any = null; let mockPathname = '/dashboard';
let mockNativePending = false; let mockReady = true;
jest.mock('@/lib/utils/document-navigation', () => ({ replaceDocument: jest.fn() }));
import { replaceDocument } from '@/lib/utils/document-navigation';
jest.mock('next/navigation', () => ({ usePathname: () => mockPathname }));
jest.mock('@/components/native-mfa-gate', () => ({ NativeMfaGate: ({ onVerified, onSignOut }: any) =>
  <section><h1>Native email code</h1><button onClick={onVerified}>Native code verified</button><button onClick={onSignOut}>Sign out native</button></section> }));
jest.mock('@/lib/contexts/auth-context', () => ({ useAuth: () => ({ user: mockNativePending ? null : mockUser, loading: mockLoading,
  initialAccess: mockInitialAccess, serverSessionReady: mockReady, nativeMfaPending: mockNativePending, logout: mockLogout,
  recoverServerSession: mockRecoverServerSession, sessionRestoreError: mockRestoreError, retrySessionRestore: mockRetryRestore }) }));
let currentState: any;
beforeEach(() => {
  jest.clearAllMocks(); mockPathname = '/dashboard'; mockLoading = false; mockInitialAccess = null; mockRestoreError = '';
  mockNativePending = false; mockReady = true; mockRecoverServerSession.mockResolvedValue(undefined);
  currentState = { state: 'mfa_required', dateKey: '2026-10-28' };
  global.fetch = jest.fn(async () => ({ ok: true, json: async () => currentState })) as any;
});
it('redirects from login after native-verified bootstrap without another request', async () => {
  mockPathname = '/login'; mockInitialAccess = { userId: 'agent', status: { state: 'allowed', dateKey: '2026-10-28' } };
  render(<CrmSecurityGate><div>Private CRM content</div></CrmSecurityGate>);
  await waitFor(() => expect(replaceDocument).toHaveBeenCalledWith('/dashboard'));
  expect(fetch).not.toHaveBeenCalled();
});
it.each(['mfa_required', 'mfa_setup_required'])('mounts native MFA rather than CRM providers for %s', async state => {
  currentState.state = state;
  render(<CrmSecurityGate><div>Private CRM content</div></CrmSecurityGate>);
  expect(await screen.findByText('Native email code')).toBeInTheDocument();
  expect(screen.queryByText('Private CRM content')).not.toBeInTheDocument();
  expect(screen.queryByText(/Attendance approval/)).not.toBeInTheDocument();
  expect(screen.queryByLabelText(/full name/)).not.toBeInTheDocument();
});
it('shows native MFA for a password session that cannot yet create a JWT', () => {
  mockNativePending = true; mockReady = false;
  render(<CrmSecurityGate><div>Private CRM content</div></CrmSecurityGate>);
  expect(screen.getByText('Native email code')).toBeInTheDocument();
  expect(fetch).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText('Native code verified'));
  expect(mockRetryRestore).toHaveBeenCalledTimes(1);
});
it('does not reuse bootstrap data after a failed forced recheck', async () => {
  mockInitialAccess = { userId: 'agent', status: { state: 'allowed', dateKey: '2026-10-28' } };
  render(<CrmSecurityGate><div>Private CRM content</div></CrmSecurityGate>);
  (fetch as jest.Mock).mockRejectedValue(new Error('Service unavailable'));
  await act(async () => { fireEvent(window, new Event('crm-access-recheck')); });
  expect(screen.queryByText('Private CRM content')).not.toBeInTheDocument();
  expect(screen.getByRole('alert')).toHaveTextContent('Service unavailable');
});
it('bounds stalled reads and offers in-place retry', async () => {
  jest.useFakeTimers();
  try {
    (fetch as jest.Mock).mockResolvedValue({ ok: true, json: () => new Promise(() => {}) });
    const view = render(<CrmSecurityGate><div>Private CRM content</div></CrmSecurityGate>);
    await act(async () => { await jest.advanceTimersByTimeAsync(20_001); });
    expect(screen.getByRole('alert')).toHaveTextContent('Access verification took too long');
    (fetch as jest.Mock).mockResolvedValue({ ok: true, json: async () => ({ state: 'allowed', dateKey: '2026-10-28' }) });
    await act(async () => { fireEvent.click(screen.getByText('Check access again')); });
    expect(screen.getByText('Private CRM content')).toBeInTheDocument(); view.unmount();
  } finally { jest.useRealTimers(); }
});
it('shows session-restoration retry without mounting data providers', () => {
  mockRestoreError = 'Session restoration failed';
  render(<CrmSecurityGate><div>Private CRM content</div></CrmSecurityGate>);
  expect(screen.queryByText('Private CRM content')).not.toBeInTheDocument();
  fireEvent.click(screen.getByText('Retry loading')); expect(mockRetryRestore).toHaveBeenCalledTimes(1);
});
it('has no five-minute, attendance-boundary, focus or waiting-user access polling', async () => {
  jest.useFakeTimers().setSystemTime(new Date('2026-10-28T13:59:00Z'));
  try {
    mockInitialAccess = { userId: 'agent', status: { state: 'allowed', dateKey: '2026-10-28', recheckAt: '2026-10-29T01:00:00.000Z' } };
    const view = render(<CrmSecurityGate><div>Private CRM content</div></CrmSecurityGate>);
    await act(async () => { await jest.advanceTimersByTimeAsync(60 * 60_000); fireEvent(window, new Event('focus')); });
    expect(fetch).not.toHaveBeenCalled(); view.unmount();
  } finally { jest.useRealTimers(); }
});
it('requests a new sign-in at the server-selected native session expiry', async () => {
  jest.useFakeTimers().setSystemTime(new Date('2026-10-28T16:00:00Z'));
  try {
    mockInitialAccess = { userId: 'agent', status: { state: 'allowed', dateKey: '2026-10-28', recheckAt: '2026-10-28T16:01:00.000Z' } };
    const view = render(<CrmSecurityGate><div>Private CRM content</div></CrmSecurityGate>);
    await act(async () => { await jest.advanceTimersByTimeAsync(60_000); });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Native email code')).toBeInTheDocument();
    expect(screen.queryByText('Private CRM content')).not.toBeInTheDocument(); view.unmount();
  } finally { jest.useRealTimers(); }
});
it('silently recovers a server JWT without unmounting verified content', async () => {
  mockInitialAccess = { userId: 'agent', status: { state: 'allowed', dateKey: '2026-10-28' } };
  let unmounts = 0;
  function Content() { useEffect(() => () => { unmounts++; }, []); return <div>Private CRM content</div>; }
  render(<CrmSecurityGate><Content /></CrmSecurityGate>);
  (fetch as jest.Mock).mockResolvedValueOnce({ ok: false, status: 401, json: async () => ({ error: 'Session expired' }) });
  currentState.state = 'allowed';
  await act(async () => { fireEvent(window, new Event('crm-access-recheck')); });
  expect(mockRecoverServerSession).toHaveBeenCalledTimes(1); expect(unmounts).toBe(0);
});
it('preserves verified content on equivalent bootstrap object updates', () => {
  mockInitialAccess = { userId: 'agent', status: { state: 'allowed', dateKey: '2026-10-28' } };
  const view = render(<CrmSecurityGate><div>Private CRM content</div></CrmSecurityGate>);
  mockInitialAccess = { ...mockInitialAccess, status: { ...mockInitialAccess.status } };
  view.rerender(<CrmSecurityGate><div>Private CRM content</div></CrmSecurityGate>);
  expect(screen.getByText('Private CRM content')).toBeInTheDocument(); expect(fetch).not.toHaveBeenCalled();
});
