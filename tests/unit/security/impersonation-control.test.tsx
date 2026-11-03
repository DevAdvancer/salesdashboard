import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ImpersonationControl } from '@/components/impersonation-control';
import { useAuth } from '@/lib/contexts/auth-context';
jest.mock('@/lib/contexts/auth-context', () => ({ useAuth: jest.fn() }));
jest.mock('@/lib/appwrite', () => ({ databases: { clearReadCache: jest.fn() } }));
jest.mock('@/lib/queries/client', () => ({ getQueryClient: () => ({ cancelQueries: jest.fn() }), clearBrowserQueryClient: jest.fn() }));
jest.mock('idb-keyval', () => ({ del: jest.fn() }));
const nativeFetch = global.fetch;
const mockFetch = jest.fn();
beforeEach(() => { jest.clearAllMocks(); global.fetch = mockFetch;
  (useAuth as jest.Mock).mockReturnValue({ user: { $id: 'operator', name: 'Operator', role: 'agent' } }); });
afterEach(() => { global.fetch = nativeFetch; });

test('does not show user switching without the native capability', async () => {
  mockFetch.mockResolvedValue({ ok: true, json: async () => ({ canImpersonate: false, active: null }) });
  render(<ImpersonationControl />);
  await waitFor(() => expect(mockFetch).toHaveBeenCalled());
  expect(screen.queryByRole('button', { name: 'Start impersonating' })).not.toBeInTheDocument();
});
test('capable users can request a target by email without depending on their CRM role', async () => {
  mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ canImpersonate: true, active: null }) })
    .mockResolvedValueOnce({ ok: false, json: async () => ({ error: 'Capability revoked.' }) });
  render(<ImpersonationControl />);
  fireEvent.change(await screen.findByLabelText('Impersonate a user'), { target: { value: 'target@example.com' } });
  fireEvent.click(screen.getByRole('button', { name: 'Start impersonating' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Capability revoked.');
  expect(mockFetch.mock.calls[1][1]).toMatchObject({ method: 'POST', body: JSON.stringify({ target: 'target@example.com' }) });
});
test('shows both identities and keeps Stop available from bootstrap even after capability revocation', async () => {
  (useAuth as jest.Mock).mockReturnValue({ user: { $id: 'target', name: 'Target', impersonatorUserId: 'operator', impersonatorName: 'Operator' } });
  mockFetch.mockResolvedValue({ ok: false, status: 403 });
  render(<ImpersonationControl />);
  expect(screen.getByRole('status')).toHaveTextContent('Operator is impersonating Target');
  expect(screen.getByRole('button', { name: 'Stop impersonating' })).toBeEnabled();
  expect(await screen.findByRole('alert')).toHaveTextContent('permission changed');
});
