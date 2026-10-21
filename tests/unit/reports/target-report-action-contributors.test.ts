import { COLLECTIONS } from '@/lib/constants/appwrite';
const mockActor = jest.fn();
const mockAssert = jest.fn();
const mockListAll = jest.fn();
const people = [
  { $id: 'admin', name: 'Admin', role: 'admin', department: 'sales', branchIds: ['ncr'] },
  { $id: 'monitor', name: 'Monitor', role: 'monitor', department: 'sales', branchIds: ['ncr'] },
  { $id: 'tl', name: 'Team Lead', role: 'team_lead', department: 'sales', branchIds: ['ncr'] },
  { $id: 'agent', name: 'Agent', role: 'agent', department: 'sales', branchIds: ['ahm', 'ncr'], primaryBranchId: 'ncr' },
];
jest.mock('node-appwrite', () => ({ Query: Object.fromEntries(
  ['equal', 'select', 'greaterThanEqual', 'lessThanEqual', 'limit', 'orderAsc'].map(method => [method, (field: unknown, value: unknown) => JSON.stringify({ method, field, value })])) }));
jest.mock('@/lib/server/current-user', () => ({ assertAuthenticatedUserId: (...args: unknown[]) => mockAssert(...args) }));
jest.mock('@/lib/server/appwrite', () => ({ createAdminClient: async () => ({ databases: {
  getDocument: async (_db: string, _col: string, id: string) => id === 'viewer' ? mockActor() : people.find(person => person.$id === id),
  listDocuments: async () => ({ documents: [{ $id: 'ncr', name: 'NCR' }, { $id: 'ahm', name: 'AHM' }] }),
} }) }));
jest.mock('@/lib/server/appwrite-pagination', () => ({ listAllDocuments: (...args: unknown[]) => mockListAll(...args) }));
jest.mock('@/lib/services/user-service', () => ({
  getAssignableUsers: async () => people,
  getAgentsByTeamLead: async () => [people.find(person => person.$id === 'agent')],
}));
jest.mock('@/app/actions/monthly-targets', () => ({ listMonthlyTargetsWithAssignmentsAction: async () => ({
  targets: [{ $id: 't', teamLeadId: 'tl', teamLeadName: 'Team Lead', totalAmount: 1000 }],
  assignmentsByTargetId: { t: [{ agentId: 'agent', amount: 400 }] },
}) }));
jest.mock('@/app/actions/target-month-bounds', () => ({ getTargetMonthBound: async () => null }));
jest.mock('@/app/actions/technical-payments', () => ({ getTechnicalPaymentTotalsByUserAction: async () => ({ admin: 25, monitor: 15 }) }));
jest.mock('@/lib/server/stats-aggregator', () => ({ computeAgentStatsForDate: async () => [] }));

beforeEach(() => {
  jest.clearAllMocks();
  mockAssert.mockResolvedValue(undefined);
  mockActor.mockResolvedValue({ ...people[0], $id: 'viewer' });
  mockListAll.mockImplementation(async ({ collectionId, queries }: any) => {
    const filters = queries.map((query: string) => JSON.parse(query));
    if (collectionId === COLLECTIONS.USERS) {
      const role = filters.find((filter: any) => filter.method === 'equal' && filter.field === 'role');
      const ids = filters.find((filter: any) => filter.method === 'equal' && filter.field === '$id');
      return people.filter(person => (!role || role.value.includes(person.role)) && (!ids || ids.value.includes(person.$id)));
    }
    if (collectionId === COLLECTIONS.LEADS) return [{ $id: 'lead', ownerId: 'agent', data: '{}', closedAt: '2026-10-05T12:00:00Z' }];
    if (collectionId === COLLECTIONS.CLIENT_PAYMENTS) return [{ leadId: 'lead', paymentPlan: '{}', updates: JSON.stringify([
      { actorId: 'admin', status: 'partially_paid', createdAt: '2026-10-10T12:00:00Z', amount: 100 },
      { actorId: 'monitor', status: 'partially_paid', createdAt: '2026-10-11T12:00:00Z', amount: 200 },
      { actorId: 'agent', status: 'partially_paid', createdAt: '2026-10-12T12:00:00Z', amount: 50 },
    ]) }];
    if (collectionId === COLLECTIONS.TECHNICAL_PAYMENTS) {
      const id = filters.find((filter: any) => filter.method === 'equal' && filter.field === 'userId')?.value;
      return [{ userId: id, leadId: 'lead', amount: id === 'admin' ? 25 : 15 }];
    }
    return [];
  });
});

test('Target Report includes Admin and Monitor payments and their drill-down totals reconcile', async () => {
  const { getTargetReportAction } = await import('@/app/actions/target-report');
  const { getAgentPaymentDetailsAction } = await import('@/app/actions/agent-payment-details');
  const { result } = await getTargetReportAction({ actorId: 'viewer', monthKey: '2026-10' });
  expect(result.totals).toMatchObject({ target: 1340, achieved: 390 });
  for (const id of ['admin', 'monitor']) {
    const row = result.rows.find(row => row.teamLeadId === id)!;
    expect(row.target).toBe(row.achieved);
    const detail = await getAgentPaymentDetailsAction({ actorId: 'viewer', agentId: id, monthKey: '2026-10' });
    expect(detail.totalAmount).toBe(row.achieved);
  }
  const agent = result.rows.flatMap(row => row.agents).find(row => row.userId === 'agent')!;
  expect(agent.branchName).toBe('NCR');
  expect(agent.branches?.map(branch => branch.name)).toEqual(['NCR']);
});

test('team leads do not receive or expose Admin/Monitor payment rows', async () => {
  mockActor.mockResolvedValue(people.find(person => person.$id === 'tl'));
  const { getTargetReportAction } = await import('@/app/actions/target-report');
  const { result } = await getTargetReportAction({ actorId: 'viewer', monthKey: '2026-10' });
  expect(result.rows.map(row => row.teamLeadId)).toEqual(['tl']);
  expect(result.totals.achieved).toBe(50);
});
