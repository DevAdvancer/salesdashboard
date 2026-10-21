import { COLLECTIONS } from '@/lib/constants/appwrite';
const mockListAll = jest.fn();
const mockActor = jest.fn();
const mockAssert = jest.fn();
const mockFacts = jest.fn();
jest.mock('node-appwrite', () => ({ Query: {
  select: jest.fn(), equal: jest.fn(), limit: jest.fn(), orderAsc: jest.fn(),
  greaterThanEqual: jest.fn(), lessThanEqual: jest.fn(),
} }));
jest.mock('@/lib/server/current-user', () => ({ assertAuthenticatedUserId: (...args: unknown[]) => mockAssert(...args) }));
jest.mock('@/lib/server/appwrite', () => ({ createAdminClient: async () => ({ databases: {
  getDocument: () => mockActor(), listDocuments: async () => ({ documents: [] }),
} }) }));
jest.mock('@/lib/server/appwrite-pagination', () => ({ listAllDocuments: (...args: unknown[]) => mockListAll(...args) }));
jest.mock('@/app/actions/technical-payments', () => ({ getTechnicalPaymentTotalsByUserAction: async () => ({}) }));
jest.mock('@/lib/server/stats-aggregator', () => ({ computeAgentStatsForDate: async () => [{
  dateKey: '2026-10-21', agentId: 'agent', leadsGenerated: 1,
}] }));
jest.mock('@/lib/utils/eastern-date', () => ({ getCurrentEasternIsoDate: () => '2026-10-21' }));
jest.mock('@/lib/server/weekly-lead-source-report', () => ({
  ...jest.requireActual('@/lib/server/weekly-lead-source-report'),
  loadWeeklyLeadSourceFacts: (...args: unknown[]) => mockFacts(...args),
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockAssert.mockResolvedValue(undefined);
  mockActor.mockResolvedValue({ $id: 'agent', name: 'Agent', role: 'agent', department: 'sales', isActive: true });
  mockListAll.mockImplementation(async ({ collectionId }) => collectionId === COLLECTIONS.AGENT_DAILY_STATS ? [
    { agentId: 'agent', dateKey: '2026-07-15', leadsGenerated: 3 },
    { agentId: 'agent', dateKey: '2026-10-21', leadsGenerated: 999, notInterestedMarked: 999 },
  ] : []);
  mockFacts.mockResolvedValue({ linkedin: [
    { leadId: 'a', agentId: 'agent', generated: true },
    { leadId: 'b', agentId: 'agent', generated: true },
    { leadId: 'a', agentId: 'agent', notInterested: true },
    { leadId: 'private', agentId: 'other-agent', generated: true },
  ], notInterested: [{ leadId: 'a', agentId: 'agent' }] });
});

test('Weekly Report exposes historical LinkedIn totals and live not-interested counts without doubling saved today stats', async () => {
  const { getWeeklyReportAction } = await import('@/app/actions/weekly-report');
  const result = await getWeeklyReportAction({ actorId: 'agent', from: '2026-07-01T00:00:00.000Z', to: '2026-10-21T23:59:59.999Z' });
  expect(result.teams[0].totals).toMatchObject({ leads: 4, linkedinLeads: 2, linkedinNotInterested: 1, notInterested: 1 });
  expect(result.teams[0].members).toHaveLength(1);
  expect(mockFacts).toHaveBeenCalledWith(expect.objectContaining({ startDate: '2026-07-01', endDate: '2026-10-21' }));
});

test('rejects an impersonated actor before loading report data', async () => {
  mockAssert.mockRejectedValueOnce(new Error('Unauthorized'));
  const { getWeeklyReportAction } = await import('@/app/actions/weekly-report');
  await expect(getWeeklyReportAction({ actorId: 'other-agent', from: '2026-07-01', to: '2026-10-21' })).rejects.toThrow('Unauthorized');
  expect(mockFacts).not.toHaveBeenCalled();
});
