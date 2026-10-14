const mockListAllDocuments = jest.fn();

jest.mock('node-appwrite', () => ({ Query: {
  greaterThanEqual: jest.fn((field, value) => `gte:${field}:${value}`),
  lessThan: jest.fn((field, value) => `lt:${field}:${value}`),
  select: jest.fn(() => 'select'), orderAsc: jest.fn(() => 'order'),
  equal: jest.fn((field, value) => `equal:${field}:${JSON.stringify(value)}`),
  limit: jest.fn(() => 'limit'),
} }));
jest.mock('@/lib/server/appwrite-pagination', () => ({
  listAllDocuments: (input: unknown) => mockListAllDocuments(input),
}));

const oldRequest = { $id: 'old-request', agentId: 'agent-1', accountId: 'account-1',
  teamLeadId: 'tl-1', status: 'accepted', $createdAt: '2026-09-29T14:00:00.000Z' };
const currentRequest = { $id: 'current-request', agentId: 'agent-1', accountId: 'account-1',
  teamLeadId: 'tl-1', leadId: 'direct-only', status: 'accepted', $createdAt: '2026-10-05T14:00:00.000Z' };
const leads = [
  { $id: 'signed-lead', $createdAt: '2026-10-05T14:00:00.000Z', closedAt: '2026-10-12T15:00:00.000Z',
    isClosed: true, status: 'Signed/Closure', data: JSON.stringify({ linkedinRequestId: 'old-request' }) },
  { $id: 'not-interested-lead', $createdAt: '2026-10-07T14:00:00.000Z',
    closedAt: '2026-10-07T16:00:00.000Z', isClosed: true, status: 'Not Interested',
    data: JSON.stringify({ linkedinRequestId: 'old-request' }) },
  { $id: 'direct-only', $createdAt: '2026-10-09T14:00:00.000Z',
    closedAt: null, isClosed: false, status: 'Generated', data: '{}' },
];
const earlierLeadClosedNow = { $id: 'earlier-lead', $createdAt: '2026-09-20T14:00:00.000Z',
  closedAt: '2026-10-13T15:00:00.000Z', isClosed: true, status: 'Signed/Closure',
  data: JSON.stringify({ linkedinRequestId: 'old-request' }) };

test('uses lead dates, reverse links, direct fallback and the signed closure status', async () => {
  mockListAllDocuments.mockImplementation(({ queries }: { queries: string[] }) =>
    Promise.resolve(queries.some(query => query.startsWith('gte:closedAt'))
      ? [...leads.slice(0, 2), earlierLeadClosedNow] : leads));
  const databases = { clearReadCacheForCollection: jest.fn(), listDocuments: jest.fn(
    async (_databaseId: string, _collectionId: string, queries: string[]) => ({
      documents: queries[0].startsWith('equal:$id') ? [oldRequest] : [currentRequest],
    })) };
  const { listLinkedinReportLeadActivity } = await import('@/lib/server/linkedin-report-leads');
  const activity = await listLinkedinReportLeadActivity({ databases: databases as never,
    startDate: '2026-10-01', endDate: '2026-10-14', teamLeadId: 'tl-1' });
  expect(activity).toHaveLength(4);
  expect(activity.filter(item => item.generated)).toHaveLength(3);
  expect(activity.filter(item => item.closure)).toHaveLength(2);
  expect(activity.find(item => item.leadId === 'signed-lead')?.request.$id).toBe('old-request');
  expect(activity.find(item => item.leadId === 'direct-only')?.request.$id).toBe('current-request');
  expect(activity.find(item => item.leadId === 'not-interested-lead')?.closure).toBe(false);
  expect(activity.find(item => item.leadId === 'earlier-lead')).toMatchObject({ generated: false, closure: true });
  expect(databases.clearReadCacheForCollection).toHaveBeenCalled();
});
