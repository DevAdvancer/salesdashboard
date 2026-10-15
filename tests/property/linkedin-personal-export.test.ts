jest.mock('node-appwrite', () => ({ Query: Object.fromEntries(
  ['equal', 'greaterThanEqual', 'lessThanEqual', 'orderAsc', 'select'].map(method =>
    [method, (...args: unknown[]) => JSON.stringify({ method, args })])) }));
jest.mock('@/lib/server/appwrite', () => ({ createAdminClient: jest.fn() }));
jest.mock('@/lib/server/current-user', () => ({ getAuthenticatedUserDoc: jest.fn() }));
jest.mock('@/lib/server/appwrite-pagination', () => ({ listAllDocuments: jest.fn() }));

import fc from 'fast-check';
import { createAdminClient } from '@/lib/server/appwrite';
import { getAuthenticatedUserDoc } from '@/lib/server/current-user';
import { listAllDocuments } from '@/lib/server/appwrite-pagination';
import { exportMyLinkedinSentDataAction } from '@/app/actions/linkedin/export';
import { COLLECTIONS } from '@/lib/constants/appwrite';

const date = '2026-10-14';
const databases = { clearReadCacheForCollection: jest.fn() };

beforeEach(() => {
  jest.clearAllMocks();
  (createAdminClient as jest.Mock).mockResolvedValue({ databases });
  (getAuthenticatedUserDoc as jest.Mock).mockResolvedValue({ $id: 'me', role: 'agent', department: 'sales', isActive: true });
});

it('never exports another agent, another account, another day, or a cold call', async () => {
  await fc.assert(fc.asyncProperty(fc.array(fc.record({
    ownAgent: fc.boolean(), ownAccount: fc.boolean(), ownDay: fc.boolean(), coldCall: fc.boolean(),
  }), { minLength: 1, maxLength: 60 }), async flags => {
    const requests = flags.map((f, i) => ({ $id: `r${i}`, agentId: f.ownAgent ? 'me' : 'other',
      accountId: f.ownAccount ? 'mine' : 'delegated', dateSent: `${f.ownDay ? date : '2026-10-13'}T00:00:00.000Z`,
      targetUrl: `https://www.linkedin.com/in/p${i}`, company: 'Company', status: 'sent', coldCall: f.coldCall }));
    (listAllDocuments as jest.Mock).mockImplementation(async ({ collectionId }) => collectionId === COLLECTIONS.LINKEDIN_ACCOUNTS
      ? [{ $id: 'mine', assignedUserId: 'me', idName: 'My ID', accountType: 'main' },
        { $id: 'delegated', assignedUserId: 'other', idName: 'Other ID', accountType: 'sudo' }]
      : requests);
    const result = await exportMyLinkedinSentDataAction(date);
    expect(result.map(row => row['Profile URL'])).toEqual(requests.filter((_, i) => {
      const f = flags[i]; return f.ownAgent && f.ownAccount && f.ownDay && !f.coldCall;
    }).map(r => r.targetUrl));
    for (const row of result) expect(Object.keys(row)).toEqual(['Date', 'Account', 'Type', 'Company', 'Profile URL', 'Status']);
  }), { numRuns: 50 });
});

it.each(['2026-02-30', '', '2026-10-14T00:00:00Z', 'invalid'])('rejects invalid calendar dates: %s', async value => {
  await expect(exportMyLinkedinSentDataAction(value)).rejects.toThrow('valid export date');
  expect(createAdminClient).not.toHaveBeenCalled();
});

it.each([{ isActive: false }, { department: 'resume' }, { role: 'monitor' }])('rejects ineligible actors: %o', async override => {
  (getAuthenticatedUserDoc as jest.Mock).mockResolvedValue({ $id: 'me', role: 'agent', department: 'sales', isActive: true, ...override });
  await expect(exportMyLinkedinSentDataAction(date)).rejects.toThrow('cannot export');
  expect(createAdminClient).not.toHaveBeenCalled();
});

it('constrains database queries to the authenticated actor and whole business day', async () => {
  (listAllDocuments as jest.Mock).mockResolvedValueOnce([{ $id: 'mine', assignedUserId: 'me' }]).mockResolvedValueOnce([]);
  await exportMyLinkedinSentDataAction(date);
  const query = JSON.stringify((listAllDocuments as jest.Mock).mock.calls[1][0].queries);
  for (const expected of ['agentId', 'me', `${date}T00:00:00.000Z`, `${date}T23:59:59.999Z`]) expect(query).toContain(expected);
});
