import { consumeEmailOtp, issueEmailOtp, OTP_TTL_MS, PROOF_TTL_MS, signProof, validProof } from '@/lib/server/crm-security-store';
import { Account, Users, type Databases } from 'node-appwrite';

jest.mock('node-appwrite', () => ({
  ID: { unique: jest.fn(() => `challenge-${Math.random().toString(36).slice(2)}`) },
  Client: jest.fn(() => ({ setEndpoint() { return this; }, setProject() { return this; }, setKey() { return this; } })),
  Account: jest.fn(), Users: jest.fn(),
}));
const binding = { userId: 'user', sessionId: 'session', purpose: 'login' as const };
const now = Date.parse('2026-10-22T13:00:00Z');
let records: Map<string, any>;
let db: Databases;
let oldKey: string | undefined;
let sendToken: jest.Mock; let validateToken: jest.Mock; let getUser: jest.Mock; let deleteSession: jest.Mock;
beforeEach(() => {
  oldKey = process.env.APPWRITE_API_KEY;
  process.env.APPWRITE_API_KEY = 'unit-test-secret';
  records = new Map();
  db = {
    createDocument: jest.fn(async (_database, _collection, id, data) => {
      if (records.has(id)) throw { code: 409 };
      records.set(id, data); return { $id: id, ...data };
    }),
    getDocument: jest.fn(async (_database, _collection, id) => {
      if (!records.has(id)) throw { code: 404 };
      return records.get(id);
    }),
    deleteDocument: jest.fn(async (_database, _collection, id) => records.delete(id)),
  } as unknown as Databases;
  sendToken = jest.fn(async (userId) => ({ userId, secret: '123456', expire: new Date(now + OTP_TTL_MS).toISOString() }));
  validateToken = jest.fn(async (userId, code) => {
    if (code !== '123456') throw { code: 401 };
    return { $id: `temporary-${Math.random()}`, userId };
  });
  getUser = jest.fn(async ($id) => ({ $id, email: 'registered@example.com', status: true }));
  deleteSession = jest.fn().mockResolvedValue({});
  (Account as jest.Mock).mockImplementation(() => ({ createEmailToken: sendToken, createSession: validateToken }));
  (Users as jest.Mock).mockImplementation(() => ({ get: getUser, deleteSession }));
});
afterEach(() => { if (oldKey === undefined) delete process.env.APPWRITE_API_KEY; else process.env.APPWRITE_API_KEY = oldKey; });
async function challenge() {
  const issued = await issueEmailOtp(db, binding, 'registered@example.com', now);
  return { ...issued, code: '123456' };
}
it('binds signed verification to one account, one session and an expiry', () => {
  const proof = signProof({ userId: 'user', sessionId: 'session', expiresAt: now + PROOF_TTL_MS });
  expect(validProof(proof, 'user', 'session', now)).toBe(true);
  expect(validProof(proof + 'x', 'user', 'session', now)).toBe(false);
  expect(validProof(proof, 'other', 'session', now)).toBe(false);
  expect(validProof(proof, 'user', 'other-session', now)).toBe(false);
  expect(validProof(proof, 'user', 'session', now + PROOF_TTL_MS)).toBe(false);
});
it('sends only to the server-selected email and never stores or returns the plaintext code', async () => {
  const { challengeId, code, ...issued } = await challenge();
  expect(sendToken).toHaveBeenCalledWith('user', 'registered@example.com');
  expect(JSON.stringify(records.get(challengeId))).not.toContain(`"${code}"`);
  expect(issued).not.toHaveProperty('code');
  await expect(consumeEmailOtp(db, binding, challengeId, code, now)).resolves.toBeUndefined();
  expect(validateToken).toHaveBeenCalledWith('user', code);
  expect(deleteSession).toHaveBeenCalledWith('user', expect.stringContaining('temporary-'));
});
it('atomically consumes a correct code once even with concurrent verification', async () => {
  const { challengeId, code } = await challenge();
  const attempts = await Promise.allSettled([consumeEmailOtp(db, binding, challengeId, code, now), consumeEmailOtp(db, binding, challengeId, code, now)]);
  expect(attempts.filter(result => result.status === 'fulfilled')).toHaveLength(1);
});
it('limits guesses across requests and rejects the correct code after five incorrect attempts', async () => {
  const { challengeId, code } = await challenge();
  const wrong = code === '000000' ? '000001' : '000000';
  for (let i = 0; i < 5; i++) await expect(consumeEmailOtp(db, binding, challengeId, wrong, now)).rejects.toThrow('incorrect');
  await expect(consumeEmailOtp(db, binding, challengeId, code, now)).rejects.toThrow('Too many attempts');
});
it('rejects expired challenges and challenges from another session or purpose', async () => {
  const { challengeId, code } = await challenge();
  await expect(consumeEmailOtp(db, binding, challengeId, code, now + OTP_TTL_MS)).rejects.toThrow('expired');
  await expect(consumeEmailOtp(db, { ...binding, sessionId: 'other' }, challengeId, code, now)).rejects.toThrow('another sign-in');
  await expect(consumeEmailOtp(db, { ...binding, purpose: 'delegate', delegateId: 'cover' }, challengeId, code, now)).rejects.toThrow('another sign-in');
});
it('throttles resends and rejects verification after a failed email delivery', async () => {
  const { challengeId } = await challenge();
  await expect(issueEmailOtp(db, binding, 'registered@example.com', now)).rejects.toThrow('wait a minute');
  sendToken.mockRejectedValue({ code: 503 });
  await expect(issueEmailOtp(db, binding, 'registered@example.com', now + 60_000)).rejects.toThrow('could not be sent');
  expect(records.has(challengeId)).toBe(true);
  expect([...records.values()].filter(row => JSON.parse(row.data).provider)).toHaveLength(1);
});
it('rejects a mismatched native email before asking Appwrite to send a token', async () => {
  getUser.mockResolvedValue({ email: 'other@example.com', status: true });
  await expect(challenge()).rejects.toThrow('does not match');
  expect(sendToken).not.toHaveBeenCalled();
});
it('verifies the assigned cover account rather than the absent account', async () => {
  const cover = { ...binding, purpose: 'delegate' as const, delegateId: 'cover' };
  const issued = await issueEmailOtp(db, cover, 'registered@example.com', now);
  await consumeEmailOtp(db, cover, issued.challengeId, '123456', now);
  expect(sendToken).toHaveBeenCalledWith('cover', 'registered@example.com');
  expect(deleteSession).toHaveBeenCalledWith('cover', expect.any(String));
});
it('fails closed when the temporary Appwrite session cannot be removed', async () => {
  const issued = await challenge(); deleteSession.mockRejectedValue({ code: 503 });
  await expect(consumeEmailOtp(db, binding, issued.challengeId, issued.code, now)).rejects.toBeDefined();
});
