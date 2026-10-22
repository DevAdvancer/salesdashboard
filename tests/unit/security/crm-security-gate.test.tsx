import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { CrmSecurityGate } from '@/components/crm-security-gate';

const mockLogout = jest.fn();
const mockUser = { $id: 'agent', name: 'Agent', email: 'agent@example.com', role: 'agent' };
let mockLoading = false;
let mockInitialAccess: any = null;
let mockPathname = '/dashboard';
const mockRouter = { replace: jest.fn(), refresh: jest.fn() };
jest.mock('@/lib/utils/document-navigation', () => ({ replaceDocument: jest.fn() }));
import { replaceDocument } from '@/lib/utils/document-navigation';
jest.mock('next/navigation', () => ({ usePathname: () => mockPathname, useRouter: () => mockRouter }));
jest.mock('@/lib/contexts/auth-context', () => ({ useAuth: () => ({ user: mockUser, loading: mockLoading, initialAccess: mockInitialAccess, serverSessionReady: true, logout: mockLogout }) }));
let currentState: Record<string, unknown>;
beforeEach(() => {
  mockPathname = '/dashboard'; mockRouter.replace.mockClear(); mockRouter.refresh.mockClear(); (replaceDocument as jest.Mock).mockClear();
  mockLoading = false; mockInitialAccess = null;
  currentState = { state: 'attendance_required', dateKey: '2026-10-22', canVerifyDelegate: false };
  global.fetch = jest.fn(async (_url, options) => {
    if (options?.method === 'POST') {
      const body = JSON.parse(String(options.body));
      if (body.operation === 'send-login-code' || body.operation === 'send-delegate-code') return { ok: true, json: async () => ({ challengeId: 'challenge' }) } as Response;
      if (body.operation === 'request-cover') currentState = { state: 'approval_pending', dateKey: '2026-10-22' };
      return { ok: true, json: async () => ({ success: true }) } as Response;
    }
    return { ok: true, json: async () => currentState } as Response;
  });
});
it('leaves the login page after fresh verified access and clears cached navigation', async () => {
  mockPathname = '/login';
  mockInitialAccess = { userId: 'agent', status: { state: 'allowed', dateKey: '2026-10-22' } };
  render(<CrmSecurityGate><div>Dashboard</div></CrmSecurityGate>);
  await waitFor(() => expect(replaceDocument).toHaveBeenCalledWith('/dashboard'));
  expect(mockRouter.refresh).not.toHaveBeenCalled();
  expect(screen.queryByRole('link', { name: 'Open dashboard' })).not.toBeInTheDocument();
  expect(screen.getByRole('status')).toHaveAttribute('aria-label', 'Opening dashboard');
});
it('does not mount dashboard data providers while the authentication bootstrap is loading', async () => {
  mockLoading = true;
  render(<CrmSecurityGate><div>Private CRM content</div></CrmSecurityGate>);
  expect(screen.getByRole('status')).toHaveTextContent('Checking your session');
  expect(screen.queryByText('Private CRM content')).not.toBeInTheDocument();
});
it('navigates with the verified session after submitting OTP without mounting the blank login child', async () => {
  mockPathname = '/login'; currentState = { state: 'otp_required', dateKey: '2026-10-22' };
  render(<CrmSecurityGate><div>Login child</div></CrmSecurityGate>);
  const code = await screen.findByLabelText('Email verification code');
  expect(replaceDocument).not.toHaveBeenCalled();
  fireEvent.change(code, { target: { value: '123456' } });
  currentState = { state: 'allowed', dateKey: '2026-10-22' };
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Verify and continue' })); });
  await waitFor(() => expect(replaceDocument).toHaveBeenCalledWith('/dashboard'));
  expect(screen.queryByText('Login child')).not.toBeInTheDocument();
});
it('uses fresh bootstrap access without requesting it again', async () => {
  mockInitialAccess = { userId: mockUser.$id, status: { state: 'allowed', dateKey: '2026-10-22' } };
  render(<CrmSecurityGate><div>Private CRM content</div></CrmSecurityGate>);
  expect(await screen.findByText('Private CRM content')).toBeInTheDocument();
  expect(fetch).not.toHaveBeenCalled();
});
it('continues directly from the verified OTP response without a second access request', async () => {
  currentState = { state: 'otp_required', dateKey: '2026-10-22' };
  const original = global.fetch;
  global.fetch = jest.fn(async (url, options) => {
    if (options?.method === 'POST' && JSON.parse(String(options.body)).operation === 'verify-login') {
      return { ok: true, json: async () => ({ success: true, status: { state: 'allowed', dateKey: '2026-10-22' } }) } as Response;
    }
    return original(url, options);
  });
  render(<CrmSecurityGate><div>Private CRM content</div></CrmSecurityGate>);
  fireEvent.change(await screen.findByLabelText('Email verification code'), { target: { value: '123456' } });
  const before = (fetch as jest.Mock).mock.calls.length;
  fireEvent.click(screen.getByRole('button', { name: 'Verify and continue' }));
  expect(await screen.findByText('Private CRM content')).toBeInTheDocument();
  expect((fetch as jest.Mock).mock.calls.slice(before)).toHaveLength(1);
});
it('blocks CRM content and hides the name field when there is no assigned cover', async () => {
  render(<CrmSecurityGate><div>Private CRM content</div></CrmSecurityGate>);
  expect(await screen.findByText(/Ask your TL or manager/)).toBeInTheDocument();
  expect(screen.queryByLabelText(/full name/)).not.toBeInTheDocument();
  expect(screen.queryByText('Private CRM content')).not.toBeInTheDocument();
});
it('shows the assigned-person name only when assigned and stays blocked after requesting approval', async () => {
  currentState.canVerifyDelegate = true;
  render(<CrmSecurityGate><div>Private CRM content</div></CrmSecurityGate>);
  fireEvent.change(await screen.findByLabelText(/full name/), { target: { value: 'Assigned Agent' } });
  fireEvent.click(screen.getByRole('button', { name: 'Verify assigned person' }));
  fireEvent.change(await screen.findByLabelText(/Code sent to the assigned/), { target: { value: '123456' } });
  fireEvent.click(screen.getByRole('button', { name: 'Verify and request approval' }));
  expect(await screen.findByText(/Access stays blocked until approval/)).toBeInTheDocument();
  expect(screen.queryByText('Private CRM content')).not.toBeInTheDocument();
});
it('sends the email challenge and does not mount private content before OTP verification', async () => {
  currentState = { state: 'otp_required', dateKey: '2026-10-22' };
  render(<CrmSecurityGate><div>Private CRM content</div></CrmSecurityGate>);
  const codeInput = await screen.findByLabelText('Email verification code');
  expect(screen.queryByText('Private CRM content')).not.toBeInTheDocument();
  currentState = { state: 'allowed', dateKey: '2026-10-22' };
  fireEvent.change(codeInput, { target: { value: '123456' } });
  fireEvent.click(screen.getByRole('button', { name: 'Verify and continue' }));
  expect(await screen.findByText('Private CRM content')).toBeInTheDocument();
});
it('fails closed on an access-check outage after previously allowing access', async () => {
  currentState = { state: 'allowed', dateKey: '2026-10-22' };
  render(<CrmSecurityGate><div>Private CRM content</div></CrmSecurityGate>);
  expect(await screen.findByText('Private CRM content')).toBeInTheDocument();
  (global.fetch as jest.Mock).mockRejectedValueOnce(new Error('Access check unavailable'));
  fireEvent(window, new Event('focus'));
  await waitFor(() => expect(screen.queryByText('Private CRM content')).not.toBeInTheDocument());
  expect(screen.getByRole('alert')).toHaveTextContent('Access check unavailable');
});
