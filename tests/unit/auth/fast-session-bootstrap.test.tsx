import { act, renderHook, waitFor } from '@testing-library/react';
import { AuthProvider, useAuth } from '@/lib/contexts/auth-context';
import { account, databases } from '@/lib/appwrite';
import type { ReactNode } from 'react';
jest.mock('@/lib/appwrite', () => ({ account: { get: jest.fn(), createJWT: jest.fn(), createEmailPasswordSession: jest.fn() },
  databases: { getDocument: jest.fn() }, DATABASE_ID: 'db', COLLECTIONS: { USERS: 'users' } }));
const user = { $id: 'person', name: 'Person', email: 'person@example.com', role: 'agent', department: 'sales', isActive: true };
const bootstrap = { user, status: { state: 'allowed', dateKey: '2026-10-22' } };
const wrapper = ({ children }: { children: ReactNode }) => <AuthProvider>{children}</AuthProvider>;
beforeEach(() => { jest.clearAllMocks(); sessionStorage.clear(); sessionStorage.setItem('crm.lastServerSessionSyncAt', String(Date.now())); });
it('restores profile and access in one request without minting JWTs or repeating account/profile reads', async () => {
  global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => bootstrap });
  const { result } = renderHook(() => useAuth(), { wrapper });
  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(result.current.user?.$id).toBe(user.$id);
  expect(result.current.serverSessionReady).toBe(true);
  expect(result.current.initialAccess).toEqual({ userId: user.$id, status: bootstrap.status });
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(account.get).not.toHaveBeenCalled(); expect(account.createJWT).not.toHaveBeenCalled();
  expect(databases.getDocument).not.toHaveBeenCalled();
});
it('carries the blocked state from the server without trusting stored user or access data', async () => {
  localStorage.setItem('crm.user', JSON.stringify({ ...user, role: 'admin' }));
  global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ ...bootstrap, status: { state: 'attendance_required', dateKey: '2026-10-22' } }) });
  const { result } = renderHook(() => useAuth(), { wrapper });
  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(result.current.user?.role).toBe('agent');
  expect(result.current.initialAccess?.status.state).toBe('attendance_required');
  localStorage.removeItem('crm.user');
});
it('receives the new profile/access with JWT sync after login instead of another bootstrap/profile request', async () => {
  global.fetch = jest.fn(async (_url, options) => options?.method === 'POST'
    ? { ok: true, json: async () => bootstrap } as Response : { ok: true, json: async () => ({ active: false }) } as Response);
  (account.get as jest.Mock).mockRejectedValue(new Error('No existing session'));
  (account.createJWT as jest.Mock).mockResolvedValue({ jwt: 'native-jwt' });
  (account.createEmailPasswordSession as jest.Mock).mockResolvedValue({ userId: user.$id });
  const { result } = renderHook(() => useAuth(), { wrapper });
  await waitFor(() => expect(result.current.loading).toBe(false));
  (fetch as jest.Mock).mockClear(); (account.get as jest.Mock).mockClear();
  await act(async () => { await result.current.login(user.email, 'password'); });
  expect(result.current.initialAccess?.status.state).toBe('allowed');
  expect(account.get).not.toHaveBeenCalled(); expect(databases.getDocument).not.toHaveBeenCalled();
  expect((fetch as jest.Mock).mock.calls.some(([url]) => String(url).includes('view=bootstrap'))).toBe(false);
});
