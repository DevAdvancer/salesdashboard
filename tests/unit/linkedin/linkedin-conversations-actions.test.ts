jest.mock('node-appwrite', () => ({ Query: {
  equal: (field: string, value: unknown) => `${field}=${JSON.stringify(value)}`,
  greaterThanEqual: (field: string, value: string) => `${field}>=${value}`,
  lessThan: (field: string, value: string) => `${field}<${value}`,
  isNotNull: (field: string) => `notNull:${field}`,
  or: (queries: string[]) => `or(${queries.join(',')})`,
  orderAsc: (field: string) => `asc:${field}`, orderDesc: (field: string) => `desc:${field}`,
  select: (fields: string[]) => `select:${fields.join(',')}`,
} }));
jest.mock('@/lib/server/current-user', () => ({ getAuthenticatedUserDoc: jest.fn() }));
jest.mock('@/lib/server/appwrite', () => ({ createAdminClient: jest.fn() }));
jest.mock('@/lib/server/appwrite-pagination', () => ({ listAllDocuments: jest.fn() }));
jest.mock('@/lib/server/beta-feature-access', () => ({ hasBetaFeatureAccess: jest.fn().mockResolvedValue(true) }));

import { exportLinkedinConversationsAction, listLinkedinConversationsAction, listRecentLinkedinConnectionsAction } from '@/app/actions/linkedin/conversations';
import { COLLECTIONS } from '@/lib/constants/appwrite';
import { createAdminClient } from '@/lib/server/appwrite';
import { listAllDocuments } from '@/lib/server/appwrite-pagination';
import { getAuthenticatedUserDoc } from '@/lib/server/current-user';
import type { LinkedinRequest, User } from '@/lib/types';

const databases = { clearReadCacheForCollection: jest.fn() };
const viewer = { $id: 'tl', name: 'Team Lead', role: 'team_lead', department: 'sales' } as User;
const request: LinkedinRequest = { $id: 'request', agentId: 'agent', accountId: 'sudo', teamLeadId: 'tl', company: 'Company',
  targetUrl: 'https://www.linkedin.com/in/jane-doe', dateSent: '2026-11-01T00:00:00.000Z', acceptedAt: '2026-11-12T18:00:00.000Z',
  conversationId: 'attempt', status: 'accepted' };
const today = { start: '2026-11-12', end: '2026-11-12' };
const list = jest.mocked(listAllDocuments);

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(getAuthenticatedUserDoc).mockResolvedValue(viewer);
  jest.mocked(createAdminClient).mockResolvedValue({ databases } as never);
  list.mockResolvedValue([]);
});

it('uses the requested day and event date for both lists, without loading names or transcripts for an empty day', async () => {
  await expect(listLinkedinConversationsAction({ ...today, mode: 'sent' })).resolves.toEqual([]);
  await expect(listLinkedinConversationsAction({ ...today, mode: 'accepted' })).resolves.toEqual([]);
  expect(list.mock.calls).toHaveLength(4);
  expect(list.mock.calls.map(([options]) => options.queries.slice(-5).join(' '))).toEqual([
    expect.stringContaining('dateSent>=2026-11-12T00:00:00.000Z dateSent<2026-11-13T00:00:00.000Z'),
    expect.stringContaining('dateSent>=2026-11-12T00:00:00.000Z dateSent<2026-11-13T00:00:00.000Z'),
    expect.stringContaining('acceptedAt>=2026-11-12T05:00:00.000Z acceptedAt<2026-11-13T05:00:00.000Z'),
    expect.stringContaining('acceptedAt>=2026-11-12T05:00:00.000Z acceptedAt<2026-11-13T05:00:00.000Z'),
  ]);
});

it.each(['JANE DOE', 'https://linkedin.com/in/jane-doe/?trk=search', 'Alex Sender'])('searches scoped accepted results by %s', async search => {
  list.mockResolvedValueOnce([request, { ...request, $id: 'other', agentId: 'other', teamLeadId: 'different-team' }])
    .mockResolvedValueOnce([]).mockResolvedValueOnce([{ $id: 'agent', name: 'Alex Sender' }]);
  await expect(listLinkedinConversationsAction({ ...today, mode: 'accepted', search })).resolves.toEqual([
    expect.objectContaining({ id: 'attempt', agent: 'Alex Sender', dateSent: request.dateSent }),
  ]);
});

it('limits the latest accepted list across live requests and archives and denies agents', async () => {
  list.mockResolvedValueOnce(Array.from({ length: 10 }, (_, index) => ({ ...request, $id: `live-${index}`, conversationId: `attempt-${index}` })))
    .mockResolvedValueOnce([{ payload: JSON.stringify({ ...request, $id: 'archived', conversationId: 'archived-attempt',
      acceptedAt: '2026-11-12T19:00:00.000Z', status: 'withdrawn' }) }])
    .mockResolvedValueOnce([{ $id: 'agent', name: 'Alex Sender' }]);
  const recent = await listRecentLinkedinConnectionsAction();
  expect(recent).toHaveLength(10);
  expect(recent[0]).toMatchObject({ id: 'archived-attempt', status: 'withdrawn' });
  expect(list.mock.calls[0][0]).toMatchObject({ take: 10, pageLimit: 10, queries: expect.arrayContaining([
    'notNull:acceptedAt', 'desc:acceptedAt', 'or(agentId="tl",teamLeadId="tl")',
  ]) });
  jest.mocked(getAuthenticatedUserDoc).mockResolvedValue({ ...viewer, role: 'agent' });
  await expect(listRecentLinkedinConnectionsAction()).rejects.toThrow('Only team leads and admins');
  expect(list).toHaveBeenCalledTimes(3);
});

it('exports both the used sudo account and its main account with the invitation and messages', async () => {
  list.mockImplementation(async options => {
    if (options.collectionId === COLLECTIONS.LINKEDIN_REQUESTS) return [request];
    if (options.collectionId === COLLECTIONS.USERS) return [{ $id: 'agent', name: 'Alex Sender' }];
    if (options.collectionId === COLLECTIONS.LINKEDIN_ACCOUNTS) return options.queries.includes('$id=["sudo"]')
      ? [{ $id: 'sudo', idName: 'Sudo ID', mainAccountId: 'main', accountType: 'sudo' }]
      : [{ $id: 'main', idName: 'Main ID' }];
    return options.queries.includes('kind="archive"') ? [] : [
      { kind: 'invitation', conversationId: 'attempt', payload: 'Initial text' },
      { kind: 'message', conversationId: 'attempt', payload: '{"text":"Follow-up","date":"2026-11-12"}' },
    ];
  });
  await expect(exportLinkedinConversationsAction({ ...today, mode: 'accepted' }, ['attempt'])).resolves.toEqual([
    expect.objectContaining({ agent: 'Alex Sender', mainAccount: 'Main ID', mainAccountId: 'main',
      sudoAccount: 'Sudo ID', sudoAccountId: 'sudo', initialText: 'Initial text', messages: [expect.objectContaining({ text: 'Follow-up' })] }),
  ]);
});
