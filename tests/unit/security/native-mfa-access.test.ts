import { evaluateCrmAccess, effectiveCrmAuditActor, type SecurityIdentity } from '@/lib/server/crm-access';

const mockList = jest.fn();
jest.mock('next/headers', () => ({ cookies: jest.fn(), headers: jest.fn() }));
jest.mock('node-appwrite', () => ({
  Client: class { setEndpoint() { return this; } setProject() { return this; } setKey() { return this; } },
  Account: jest.fn(), Databases: jest.fn(() => ({ listDocuments: mockList })),
}));
let identity: SecurityIdentity;
const flag = process.env.CRM_ACCESS_ENFORCEMENT;
beforeEach(() => {
  jest.clearAllMocks(); jest.useFakeTimers().setSystemTime(new Date('2026-10-28T16:00:00Z'));
  process.env.CRM_ACCESS_ENFORCEMENT = 'true';
  identity = { account: { $id: 'person', mfa: true, emailVerification: true, status: true },
    session: { $id: 'session', userId: 'person', factors: ['password', 'email'], mfaUpdatedAt: '2026-10-28T13:00:00Z', expire: '2026-10-30T13:00:00Z' },
    user: { $id: 'person', name: 'Person', role: 'agent', isActive: true } } as SecurityIdentity;
});
afterEach(() => { jest.useRealTimers(); if (flag === undefined) delete process.env.CRM_ACCESS_ENFORCEMENT; else process.env.CRM_ACCESS_ENFORCEMENT = flag; });

it.each(['agent', 'team_lead', 'senior_tl', 'lead_generation', 'compliance', 'admin', 'developer', 'monitor', 'operations'])(
  'allows native-verified %s without attendance or a cover request', async role => {
    identity.user.role = role as SecurityIdentity['user']['role'];
    expect(await evaluateCrmAccess(identity)).toMatchObject({ state: 'allowed', recheckAt: '2026-10-29T01:00:00.000Z' });
    expect(mockList).not.toHaveBeenCalled();
  });
it('never accepts a legacy proof or an old proxy pass instead of native MFA', async () => {
  identity.account.mfa = false;
  Object.assign(identity, { proof: 'old-signed-proof', preverified: { state: 'allowed', dateKey: '2026-10-28' } });
  expect((await evaluateCrmAccess(identity)).state).toBe('mfa_setup_required');
  identity.account.mfa = true; identity.session.factors = ['password'];
  expect((await evaluateCrmAccess(identity)).state).toBe('mfa_required');
});
it('attributes mutations to the signed-in account rather than a historical covering delegate', async () => {
  expect(await effectiveCrmAuditActor({ id: 'stale-cover', name: 'Cover' }, identity)).toEqual({ id: 'person', name: 'Person' });
});
