/** @jest-environment node */
import { resolveSecurityIdentity } from '@/lib/server/crm-access';
const mockAccount = { get: jest.fn(), getSession: jest.fn() };
const mockDb = { getDocument: jest.fn() };
jest.mock('node-appwrite', () => ({
  Client: class { setEndpoint() { return this; } setProject() { return this; } setKey() { return this; } setJWT() { return this; } },
  Account: jest.fn(() => mockAccount), Databases: jest.fn(() => mockDb),
}));
function jar(jwt: string, proof = 'proof') { return { get: (name: string) => name === 'crm_appwrite_jwt' ? { value: jwt } : name === 'crm_email_verified' ? { value: proof } : undefined }; }
beforeEach(() => {
  jest.clearAllMocks();
  mockAccount.get.mockResolvedValue({ $id: 'person', email: 'person@example.com' });
  mockAccount.getSession.mockResolvedValue({ $id: 'session' });
  mockDb.getDocument.mockResolvedValue({ $id: 'person', isActive: true });
});
it('coalesces parallel identity reads without caching a settled authorization result', async () => {
  await Promise.all(Array.from({ length: 20 }, () => resolveSecurityIdentity(jar('parallel'))));
  expect(mockAccount.get).toHaveBeenCalledTimes(1); expect(mockAccount.getSession).toHaveBeenCalledTimes(1);
  expect(mockDb.getDocument).toHaveBeenCalledTimes(1);
  mockDb.getDocument.mockResolvedValueOnce({ $id: 'person', isActive: false });
  await expect(resolveSecurityIdentity(jar('parallel'))).rejects.toThrow('inactive');
  expect(mockAccount.get).toHaveBeenCalledTimes(2);
  await expect(resolveSecurityIdentity(jar('parallel'))).resolves.toMatchObject({ user: { isActive: true } });
});
it('isolates session credentials and OTP proofs even when requests overlap', async () => {
  await Promise.all([resolveSecurityIdentity(jar('one', 'proof-one')), resolveSecurityIdentity(jar('two', 'proof-one')), resolveSecurityIdentity(jar('one', 'proof-two'))]);
  expect(mockAccount.get).toHaveBeenCalledTimes(3);
});
it('does not reuse a prior success after the native session has been revoked', async () => {
  await resolveSecurityIdentity(jar('revoked'));
  mockAccount.get.mockRejectedValueOnce(new Error('Session revoked'));
  await expect(resolveSecurityIdentity(jar('revoked'))).rejects.toThrow('sign in again');
});
describe('signed pass forwarded by the proxy for the same request', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { signAccessPass } = require('@/lib/server/crm-security-store');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const today = () => require('@/lib/utils/est-date').getTodayEst();
  const pass = (accountId = 'person', sessionId = 'session') => signAccessPass({ accountId, sessionId, dateKey: today(),
    status: { state: 'allowed', dateKey: today() }, user: { $id: accountId, isActive: true, role: 'agent' } });
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
