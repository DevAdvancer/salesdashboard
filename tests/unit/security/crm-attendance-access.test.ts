import { decideAccessRequest, evaluateCrmAccess, startDelegateOtp } from '@/lib/server/crm-access';
import type { SecurityIdentity } from '@/lib/server/crm-access';
import { signProof } from '@/lib/server/crm-security-store';
import { COLLECTIONS } from '@/lib/constants/appwrite';
import type { User } from '@/lib/types';

jest.mock('next/headers', () => ({ cookies: jest.fn() }));
jest.mock('@/lib/server/email-service', () => ({ sendNotificationEmail: jest.fn() }));
jest.mock('@/app/actions/attendance/shared', () => ({ upsertAttendanceDoc: jest.fn() }));
jest.mock('node-appwrite', () => ({
  Client: class { setEndpoint() { return this; } setProject() { return this; } setKey() { return this; } },
  Account: jest.fn(), Databases: jest.fn(() => mockDb), ID: { unique: () => 'new-id' },
  Query: Object.fromEntries(['equal', 'limit', 'orderDesc'].map(name => [name, (...args: unknown[]) => JSON.stringify({ name, args })])),
}));
const mockDb = { getDocument: jest.fn(), listDocuments: jest.fn(), updateDocument: jest.fn(), createDocument: jest.fn() };
let records: Map<string, any>;
let identity: SecurityIdentity;
let previousKey: string | undefined;
let previousFlag: string | undefined;
const person = (id: string, role = 'agent') => ({ $id: id, name: id, email: `${id}@example.com`, role, department: 'sales', teamLeadId: 'manager', isActive: true });
const dateKey = '2026-10-22';
const assignedAt = '2026-10-22T12:00:00.000Z';
function setAttendance(userId: string, present: boolean, delegateUserId: string | null = null) {
  records.set(`attendance:${userId}`, { $id: `attendance-${userId}`, userId, dateKey, present, delegateUserId, assignedAt });
}
function setRequest(state: string) {
  records.set('request', { $id: 'request', userId: 'absent', delegateId: 'cover', dateKey, state,
    data: JSON.stringify({ sessionId: 'session', assignedAt, requestedAt: assignedAt, delegateName: 'cover', decidedById: 'manager' }) });
}
beforeEach(() => {
  jest.clearAllMocks(); jest.useFakeTimers().setSystemTime(new Date('2026-10-22T14:00:00Z'));
  previousKey = process.env.APPWRITE_API_KEY; previousFlag = process.env.CRM_ACCESS_ENFORCEMENT;
  process.env.APPWRITE_API_KEY = 'unit-test-key'; process.env.CRM_ACCESS_ENFORCEMENT = 'true';
  records = new Map([['absent', person('absent')], ['cover', person('cover')], ['manager', person('manager', 'team_lead')]]);
  mockDb.getDocument.mockImplementation(async (_database, _collection, id) => {
    if (!records.has(id)) throw { code: 404 }; return records.get(id);
  });
  mockDb.listDocuments.mockImplementation(async (_database, collection, queries) => {
    let documents = [...records.values()].filter(row => collection === COLLECTIONS.ATTENDANCE ? row.$id.startsWith('attendance-') : row.$id === 'request');
    for (const query of queries) {
      const parsed = JSON.parse(query);
      if (parsed.name === 'equal') documents = documents.filter(row => row[parsed.args[0]] === parsed.args[1]);
    }
    return { documents };
  });
  mockDb.updateDocument.mockImplementation(async (_database, _collection, id, patch) => {
    records.set(id, { ...records.get(id), ...patch }); return records.get(id);
  });
  identity = { account: { $id: 'absent', email: 'absent@example.com' }, session: { $id: 'session' },
    user: person('absent'), proof: signProof({ userId: 'absent', sessionId: 'session', expiresAt: Date.now() + 3_600_000 }) } as SecurityIdentity;
});
afterEach(() => {
  jest.useRealTimers();
  if (previousKey === undefined) delete process.env.APPWRITE_API_KEY; else process.env.APPWRITE_API_KEY = previousKey;
  if (previousFlag === undefined) delete process.env.CRM_ACCESS_ENFORCEMENT; else process.env.CRM_ACCESS_ENFORCEMENT = previousFlag;
});
it.each(['admin', 'developer', 'monitor', 'operations'])('requires an email OTP even for attendance-exempt %s', async role => {
  identity.user.role = role as User['role']; identity.proof = undefined;
  expect(await evaluateCrmAccess(identity)).toMatchObject({ state: 'otp_required' });
});
it.each(['admin', 'developer', 'monitor', 'operations'])('allows verified attendance-exempt %s without an attendance record', async role => {
  identity.user.role = role as User['role'];
  expect(await evaluateCrmAccess(identity)).toMatchObject({ state: 'allowed' });
});
it('hides name verification when absent with no assigned cover and rejects direct name submission', async () => {
  expect(await evaluateCrmAccess(identity)).toMatchObject({ state: 'attendance_required', canVerifyDelegate: false });
  await expect(startDelegateOtp(identity, 'Anyone')).rejects.toThrow('No one is assigned');
});
it.each(['agent', 'team_lead', 'senior_tl', 'lead_generation', 'compliance'])('allows verified %s before 10 AM and enforces attendance at the cutoff', async role => {
  identity.user.role = role as User['role'];
  jest.setSystemTime(new Date('2026-10-22T13:59:59Z'));
  expect(await evaluateCrmAccess(identity)).toMatchObject({ state: 'allowed', recheckAt: '2026-10-22T14:00:00.000Z' });
  expect(mockDb.listDocuments).not.toHaveBeenCalled();
  identity.proof = undefined;
  expect(await evaluateCrmAccess(identity)).toMatchObject({ state: 'otp_required' });
  identity.proof = signProof({ userId: 'absent', sessionId: 'session', expiresAt: Date.now() + 3_600_000 });
  jest.setSystemTime(new Date('2026-10-22T14:00:00Z'));
  expect(await evaluateCrmAccess(identity)).toMatchObject({ state: 'attendance_required' });
});
it('allows present users and rejects attendance belonging to another day', async () => {
  setAttendance('absent', true);
  expect(await evaluateCrmAccess(identity)).toMatchObject({ state: 'allowed' });
  records.get('attendance:absent').dateKey = '2026-10-21';
  expect(await evaluateCrmAccess(identity)).toMatchObject({ state: 'attendance_required', canVerifyDelegate: false });
});
it('requires verified assigned cover and a separate manager approval', async () => {
  setAttendance('absent', false, 'cover'); setAttendance('cover', true);
  expect(await evaluateCrmAccess(identity)).toMatchObject({ state: 'attendance_required', canVerifyDelegate: true });
  await expect(startDelegateOtp(identity, 'Someone Else')).rejects.toThrow('person assigned');
  setRequest('pending');
  expect(await evaluateCrmAccess(identity)).toMatchObject({ state: 'approval_pending' });
  await decideAccessRequest(person('manager', 'team_lead') as User, 'request', true);
  expect(await evaluateCrmAccess(identity)).toMatchObject({ state: 'allowed', actingAs: 'cover' });
  expect(JSON.parse(records.get('request').data).decisions).toMatchObject([{ actorId: 'manager', approved: true }]);
});
it('revokes access immediately after rejection, assignment changes, cover absence or manager deactivation', async () => {
  setAttendance('absent', false, 'cover'); setAttendance('cover', true); setRequest('approved');
  await decideAccessRequest(person('manager', 'team_lead') as User, 'request', false);
  expect(await evaluateCrmAccess(identity)).toMatchObject({ state: 'approval_denied' });
  setRequest('approved'); records.get('attendance:absent').assignedAt = '2026-10-22T12:30:00.000Z';
  expect(await evaluateCrmAccess(identity)).toMatchObject({ state: 'attendance_required' });
  setAttendance('absent', false, 'cover'); setAttendance('cover', false);
  expect((await evaluateCrmAccess(identity)).state).not.toBe('allowed');
  setAttendance('cover', true); records.get('manager').isActive = false;
  expect((await evaluateCrmAccess(identity)).state).not.toBe('allowed');
});
it('rejects self approval by assigned cover or an unrelated team leader', async () => {
  setAttendance('absent', false, 'cover'); setRequest('pending');
  await expect(decideAccessRequest(person('cover', 'operations') as User, 'request', true)).rejects.toThrow('cannot approve');
  await expect(decideAccessRequest(person('other', 'team_lead') as User, 'request', true)).rejects.toThrow('cannot approve');
  await expect(decideAccessRequest(person('manager', 'team_lead') as User, 'request', true,
    { id: 'cover', name: 'Cover acting for manager' })).rejects.toThrow('cannot approve');
});
it('expires the day-specific approval at Eastern midnight', async () => {
  setAttendance('absent', false, 'cover'); setAttendance('cover', true); setRequest('approved');
  jest.setSystemTime(new Date('2026-10-23T03:59:00Z'));
  identity.proof = signProof({ userId: 'absent', sessionId: 'session', expiresAt: Date.now() + 3_600_000 });
  expect(await evaluateCrmAccess(identity)).toMatchObject({ state: 'allowed', dateKey: '2026-10-22' });
  jest.setSystemTime(new Date('2026-10-23T04:01:00Z'));
  expect(await evaluateCrmAccess(identity)).toMatchObject({ state: 'allowed', dateKey: '2026-10-23', recheckAt: '2026-10-23T14:00:00.000Z' });
  expect((await evaluateCrmAccess(identity)).actingAs).toBeUndefined();
});
