/** @jest-environment node */
import { clearCrmIdentityCache, resolveSecurityIdentity } from '@/lib/server/crm-access';
const mockAccount = { get: jest.fn(), getSession: jest.fn() };
const mockDb = { getDocument: jest.fn() };
jest.mock('node-appwrite', () => ({
  Client: class { setEndpoint() { return this; } setProject() { return this; } setKey() { return this; } setJWT() { return this; } },
  Account: jest.fn(() => mockAccount), Databases: jest.fn(() => mockDb),
}));
function jar(jwt: string, legacyProof = 'proof') { return { get: (name: string) => name === 'crm_appwrite_jwt' ? { value: jwt } : name === 'crm_email_verified' ? { value: legacyProof } : undefined }; }
beforeEach(() => {
  jest.clearAllMocks();
  // Strict mode: these cases cover the live check with settled reuse switched off.
  process.env.CRM_IDENTITY_CACHE_MS = '0';
  clearCrmIdentityCache();
  mockAccount.get.mockResolvedValue({ $id: 'person', email: 'person@example.com' });
  mockAccount.getSession.mockResolvedValue({ $id: 'session' });
  mockDb.getDocument.mockResolvedValue({ $id: 'person', email: 'person@example.com', isActive: true });
});
it('coalesces parallel identity reads without caching a settled authorization result', async () => {
  await Promise.all(Array.from({ length: 20 }, () => resolveSecurityIdentity(jar('parallel'))));
  expect(mockAccount.get).toHaveBeenCalledTimes(1); expect(mockAccount.getSession).toHaveBeenCalledTimes(1);
  expect(mockDb.getDocument).toHaveBeenCalledTimes(1);
  mockDb.getDocument.mockResolvedValueOnce({ $id: 'person', isActive: false });
  await expect(resolveSecurityIdentity(jar('parallel'))).rejects.toThrow('inactive');
  expect(mockAccount.get).toHaveBeenCalledTimes(2);
  await expect(resolveSecurityIdentity(jar('parallel'))).resolves.toMatchObject({ user: { email: 'person@example.com', isActive: true } });
});
it('isolates native credentials and ignores retired proof cookies', async () => {
  await Promise.all([resolveSecurityIdentity(jar('one', 'proof-one')), resolveSecurityIdentity(jar('two', 'proof-one')), resolveSecurityIdentity(jar('one', 'proof-two'))]);
  expect(mockAccount.get).toHaveBeenCalledTimes(2);
});
it('does not reuse a prior success after the native session has been revoked', async () => {
  await resolveSecurityIdentity(jar('revoked'));
  mockAccount.get.mockRejectedValueOnce(new Error('Session revoked'));
  await expect(resolveSecurityIdentity(jar('revoked'))).rejects.toThrow('sign in again');
});
it('refuses an account whose native email no longer matches its CRM profile', async () => {
  mockDb.getDocument.mockResolvedValueOnce({ $id: 'person', email: 'other@example.com', isActive: true });
  await expect(resolveSecurityIdentity(jar('mismatch'))).rejects.toMatchObject({ code: 'ACCOUNT_EMAIL_MISMATCH', status: 403 });
});
describe('signed pass forwarded by the proxy for the same request', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { signAccessPass } = require('@/lib/server/crm-access-pass');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const today = () => require('@/lib/utils/est-date').getTodayEst();
  const pass = (accountId = 'person', sessionId = 'session') => signAccessPass({ accountId, sessionId, dateKey: today(),
    status: { state: 'allowed', dateKey: today() }, user: { $id: accountId, email: 'person@example.com', isActive: true, role: 'agent' } });
  it('still validates the native session but skips re-reading the user record', async () => {
    const identity = await resolveSecurityIdentity(jar('with-pass'), pass());
    expect(mockAccount.get).toHaveBeenCalledTimes(1); expect(mockAccount.getSession).toHaveBeenCalledTimes(1);
    expect(mockDb.getDocument).not.toHaveBeenCalled();
    expect(identity.preverified).toMatchObject({ state: 'allowed' });
  });
  it('ignores a pass issued for another session or account, or a forged one', async () => {
    for (const [token, key] of [[pass('person', 'stolen'), 'a'], [pass('admin', 'session'), 'b'], ['forged.value', 'c']]) {
      const identity = await resolveSecurityIdentity(jar(`other-${key}`), token);
      expect(identity.preverified).toBeUndefined();
    }
    expect(mockDb.getDocument).toHaveBeenCalledTimes(3);
  });
  it('never reuses a pass once the native session is revoked', async () => {
    mockAccount.get.mockRejectedValueOnce(new Error('Session revoked'));
    await expect(resolveSecurityIdentity(jar('revoked-pass'), pass())).rejects.toThrow('sign in again');
  });
});
describe('short-lived reuse of a validated native session', () => {
  const session = (expire = new Date(Date.now() + 3_600_000).toISOString()) => ({ $id: 'session', expire });
  beforeEach(() => { process.env.CRM_IDENTITY_CACHE_MS = '30000'; });
  afterAll(() => { delete process.env.CRM_IDENTITY_CACHE_MS; });
  it('reuses a success for the same credentials within the window, ignoring the per-request pass', async () => {
    mockAccount.getSession.mockResolvedValue(session());
    await resolveSecurityIdentity(jar('cached'));
    const again = await resolveSecurityIdentity(jar('cached'), 'any-pass');
    expect(mockAccount.get).toHaveBeenCalledTimes(1); expect(mockDb.getDocument).toHaveBeenCalledTimes(1);
    expect(again.preverified).toBeUndefined();
    await resolveSecurityIdentity(jar('other-cached'));
    expect(mockAccount.get).toHaveBeenCalledTimes(2);
  });
  it('rechecks after the window, after clearing, and never caches failures', async () => {
    jest.useFakeTimers({ now: Date.now() });
    try {
      mockAccount.getSession.mockResolvedValue(session());
      await resolveSecurityIdentity(jar('expiring'));
      jest.advanceTimersByTime(30_001);
      mockAccount.get.mockRejectedValueOnce(new Error('Session revoked'));
      await expect(resolveSecurityIdentity(jar('expiring'))).rejects.toThrow('sign in again');
      await resolveSecurityIdentity(jar('expiring'));
      clearCrmIdentityCache();
      await resolveSecurityIdentity(jar('expiring'));
      expect(mockAccount.get).toHaveBeenCalledTimes(4);
    } finally { jest.useRealTimers(); }
  });
  it('never reuses a session past its native expiry', async () => {
    mockAccount.getSession.mockResolvedValue(session(new Date(Date.now() - 1).toISOString()));
    await resolveSecurityIdentity(jar('expired'));
    await resolveSecurityIdentity(jar('expired'));
    expect(mockAccount.get).toHaveBeenCalledTimes(2);
  });
});
describe('signed access cookie issued after one full check', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { accessCookieFor, assertCrmAccessForProxy } = require('@/lib/server/crm-access');
  const verified = { $id: 'person', email: 'person@example.com', mfa: true, emailVerification: true, status: true };
  const nativeSession = () => ({ $id: 'session', userId: 'person', factors: ['password', 'email'],
    mfaUpdatedAt: new Date(Date.now() - 3_600_000).toISOString(), expire: new Date(Date.now() + 86_400_000).toISOString() });
  function withCookie(jwt: string, value?: string) {
    return { get: (name: string) => name === 'crm_appwrite_jwt' ? { value: jwt } : name === 'crm_access' && value ? { value } : undefined };
  }
  async function issued(jwt: string) {
    const { cookie } = await assertCrmAccessForProxy(withCookie(jwt));
    expect(cookie).toMatchObject({ name: 'crm_access', options: { httpOnly: true, sameSite: 'lax', path: '/' } });
    jest.clearAllMocks();
    return cookie.value as string;
  }
  beforeEach(() => { mockAccount.get.mockResolvedValue(verified); mockAccount.getSession.mockResolvedValue(nativeSession()); });
  it('lets the proxy admit later requests with no Appwrite calls', async () => {
    const value = await issued('jwt-a');
    await expect(assertCrmAccessForProxy(withCookie('jwt-a', value))).resolves.toEqual({ pass: null, cookie: null });
    expect(mockAccount.get).not.toHaveBeenCalled(); expect(mockDb.getDocument).not.toHaveBeenCalled();
  });
  it('skips the native session lookup in handlers but still reads the live user record', async () => {
    const value = await issued('jwt-b');
    await expect(resolveSecurityIdentity(withCookie('jwt-b', value))).resolves.toMatchObject({ account: { $id: 'person' }, session: { $id: 'session' } });
    expect(mockAccount.get).not.toHaveBeenCalled(); expect(mockDb.getDocument).toHaveBeenCalledTimes(1);
    mockDb.getDocument.mockResolvedValueOnce({ $id: 'person', email: 'person@example.com', isActive: false });
    await expect(resolveSecurityIdentity(withCookie('jwt-b', value))).rejects.toMatchObject({ code: 'ACCOUNT_INACTIVE' });
  });
  it('is ignored for other credentials, when tampered with, or once the native session expired', async () => {
    const value = await issued('jwt-c');
    const [body, sig] = value.split('.');
    const forged = `${Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body, 'base64url').toString()), credential: 'x' })).toString('base64url')}.${sig}`;
    for (const jar of [withCookie('jwt-other', value), withCookie('jwt-c', forged)]) {
      await assertCrmAccessForProxy(jar);
    }
    expect(mockAccount.get).toHaveBeenCalledTimes(2);
    expect(accessCookieFor({ account: verified, session: { ...nativeSession(), expire: new Date(Date.now() - 1).toISOString() },
      user: { $id: 'person' } }, withCookie('jwt-c'))).toBeNull();
    expect(accessCookieFor({ account: verified, session: { ...nativeSession(), factors: ['password'] }, user: { $id: 'person' } }, withCookie('jwt-c'))).toBeNull();
  });
});
