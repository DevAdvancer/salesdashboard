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
  global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ ...bootstrap, status: { state: 'mfa_required', dateKey: '2026-10-22' } }) });
  const { result } = renderHook(() => useAuth(), { wrapper });
  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(result.current.user?.role).toBe('agent');
  expect(result.current.initialAccess?.status.state).toBe('mfa_required');
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
  (account.get as jest.Mock).mockResolvedValue(user);
  await act(async () => { await result.current.login(user.email, 'password'); });
  expect(result.current.initialAccess?.status.state).toBe('allowed');
  expect(account.get).toHaveBeenCalledTimes(1); expect(databases.getDocument).not.toHaveBeenCalled();
  expect((fetch as jest.Mock).mock.calls.some(([url]) => String(url).includes('view=bootstrap'))).toBe(false);
});

it('recovers a stalled bootstrap body through the native session without clearing it', async () => {
  jest.useFakeTimers();
  try {
    global.fetch = jest.fn(async (url, options) => {
      if (String(url).includes('view=bootstrap')) return { ok: true, json: () => new Promise(() => {}) } as Response;
      if (options?.method === 'POST') return { ok: true, json: async () => bootstrap } as Response;
      return { ok: true, json: async () => ({ active: false }) } as Response;
    });
    (account.get as jest.Mock).mockResolvedValue({ $id: user.$id, email: user.email });
    (account.createJWT as jest.Mock).mockResolvedValue({ jwt: 'native-jwt' });
    const { result } = renderHook(() => useAuth(), { wrapper });
    await act(async () => { await jest.advanceTimersByTimeAsync(8_001); });
    expect(result.current.loading).toBe(false);
    expect(result.current.user?.$id).toBe(user.$id);
    expect(result.current.initialAccess?.status.state).toBe('allowed');
    expect((fetch as jest.Mock).mock.calls.some(([, options]) => options?.method === 'DELETE')).toBe(false);
  } finally { jest.useRealTimers(); }
});

it('ends a stalled native restore and retries in place without erasing a potentially valid session', async () => {
  jest.useFakeTimers();
  try {
    global.fetch = jest.fn().mockResolvedValue({ status: 401, ok: false });
    let resolveOld!: (value: unknown) => void;
    (account.get as jest.Mock).mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve; }));
    const { result } = renderHook(() => useAuth(), { wrapper });
    await act(async () => { await jest.advanceTimersByTimeAsync(8_001); });
    expect(result.current.loading).toBe(false);
    expect(result.current.sessionRestoreError).toContain('Retry');
    expect(result.current.serverSessionReady).toBe(false);
    expect((fetch as jest.Mock).mock.calls.some(([, options]) => options?.method === 'DELETE')).toBe(false);
    (fetch as jest.Mock).mockResolvedValue({ ok: true, json: async () => bootstrap });
    await act(async () => { result.current.retrySessionRestore?.(); });
    expect(result.current.user?.$id).toBe(user.$id);
    expect(result.current.sessionRestoreError).toBe('');
    await act(async () => { resolveOld({ $id: 'old-user', email: 'old@example.com' }); });
    expect(result.current.user?.$id).toBe(user.$id);
    expect(result.current.serverSessionReady).toBe(true);
  } finally { jest.useRealTimers(); }
});

it('restores a valid session when browser storage is unavailable', async () => {
  const storage = jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('Storage unavailable'); });
  const write = jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Storage unavailable'); });
  try {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => bootstrap });
    (account.createJWT as jest.Mock).mockResolvedValue({ jwt: 'native-jwt' });
    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.user?.$id).toBe(user.$id);
    expect(result.current.sessionRestoreError).toBe('');
  } finally { storage.mockRestore(); write.mockRestore(); }
});

it('bounds the entire restore and prevents a late SDK result from syncing an obsolete session', async () => {
  jest.useFakeTimers();
  try {
    global.fetch = jest.fn(async (url) => {
      if (String(url).includes('view=bootstrap')) {
        await new Promise(resolve => setTimeout(resolve, 7_000));
        return { status: 401, ok: false } as Response;
      }
      return { ok: true, json: async () => {
        await new Promise(resolve => setTimeout(resolve, 3_000));
        return { active: false };
      } } as Response;
    });
    (account.get as jest.Mock).mockImplementationOnce(async () => {
      await new Promise(resolve => setTimeout(resolve, 6_000));
      return { $id: user.$id, email: user.email };
    });
    let resolveJwt!: (value: unknown) => void;
    (account.createJWT as jest.Mock).mockImplementationOnce(() => new Promise(resolve => { resolveJwt = resolve; }));
    const { result } = renderHook(() => useAuth(), { wrapper });
    await act(async () => { await jest.advanceTimersByTimeAsync(20_001); });
    expect(result.current.loading).toBe(false);
    expect(result.current.sessionRestoreError).toContain('took too long');
    expect(result.current.serverSessionReady).toBe(false);
    (fetch as jest.Mock).mockResolvedValue({ ok: true, json: async () => bootstrap });
    await act(async () => { result.current.retrySessionRestore?.(); });
    expect(result.current.user?.$id).toBe(user.$id);
    await act(async () => { resolveJwt({ jwt: 'obsolete-jwt' }); });
    expect((fetch as jest.Mock).mock.calls.some(([, options]) => options?.method === 'POST')).toBe(false);
    expect(result.current.serverSessionReady).toBe(true);
  } finally { jest.useRealTimers(); }
});
