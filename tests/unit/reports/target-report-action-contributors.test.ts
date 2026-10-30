import { COLLECTIONS } from '@/lib/constants/appwrite';
const mockActor = jest.fn();
const mockAssert = jest.fn();
const mockListAll = jest.fn();
let mockFinancialRows: any[] | null = null;
let mockFollowupRows: any[] = [];
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
  mockFinancialRows = null;
  mockFollowupRows = [];
  mockListAll.mockImplementation(async ({ collectionId, queries }: any) => {
    const filters = queries.map((query: string) => JSON.parse(query));
    if (collectionId === COLLECTIONS.USERS) {
      const role = filters.find((filter: any) => filter.method === 'equal' && filter.field === 'role');
      const ids = filters.find((filter: any) => filter.method === 'equal' && filter.field === '$id');
      return people.filter(person => (!role || role.value.includes(person.role)) && (!ids || ids.value.includes(person.$id)));
    }
    if (collectionId === COLLECTIONS.LEADS) return [{ $id: 'lead', ownerId: 'agent', data: '{}', closedAt: '2026-10-05T12:00:00Z' }];
    if (collectionId === COLLECTIONS.PREVIOUS_FOLLOWUPS_PAYMENTS) return mockFollowupRows.filter(row => filters.every((filter: any) =>
      filter.method === 'greaterThanEqual' ? row[filter.field] >= filter.value : filter.method === 'lessThanEqual' ? row[filter.field] <= filter.value : true));
    if (collectionId === COLLECTIONS.CLIENT_PAYMENTS) return mockFinancialRows ?? [{ leadId: 'lead', paymentPlan: '{}', updates: JSON.stringify([
      { actorId: 'admin', status: 'partially_paid', createdAt: '2026-10-10T12:00:00Z', amount: 100 },
      { actorId: 'monitor', status: 'partially_paid', createdAt: '2026-10-11T12:00:00Z', amount: 200 },
      { actorId: 'agent', status: 'partially_paid', createdAt: '2026-10-12T12:00:00Z', amount: 50 },
    ]) }];
    if (collectionId === COLLECTIONS.TECHNICAL_PAYMENTS) {
      const id = filters.find((filter: any) => filter.method === 'equal' && filter.field === 'userId')?.value;
      return [{ userId: id, leadId: 'lead', amount: id === 'admin' ? 25 : id === 'monitor' ? 15 : 0 }];
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

test('an August refund entered in September stays in August in both target views', async () => {
  mockFinancialRows = [{ leadId: 'lead', paymentPlan: JSON.stringify({ closure: { ownerId: 'agent', closedAt: '2026-08-01' } }),
    updatedAt: '2026-10-20T12:00:00Z', updates: JSON.stringify([
      { status: 'fully_paid', amount: 500, createdAt: '2026-08-10T12:00:00Z', actorId: 'agent' },
      { status: 'refunded', amount: -100, sourceFollowupId: 'refund', createdAt: '2026-09-10T12:00:00Z', actorId: 'viewer' },
    ]) }];
  mockFollowupRows = [{ $id: 'refund', leadId: 'lead', amount: 100, status: 'refunded', date: '2026-08-20',
    creditedAgentId: 'agent', createdById: 'viewer', createdAt: '2026-09-10T12:00:00Z' }];
  const { getTargetReportAction } = await import('@/app/actions/target-report');
  const { getAgentPaymentDetailsAction } = await import('@/app/actions/agent-payment-details');
  for (const [monthKey, expected] of [['2026-08', 400], ['2026-09', 0]] as const) {
    const { result } = await getTargetReportAction({ actorId: 'viewer', monthKey });
    const row = result.rows.flatMap(team => team.agents).find(agent => agent.userId === 'agent');
    expect(row?.achieved).toBe(expected);
    expect((await getAgentPaymentDetailsAction({ actorId: 'viewer', agentId: 'agent', monthKey })).totalAmount).toBe(expected);
  }
  // A later edit must not exclude the earlier payment history at the database layer.
  const queries = mockListAll.mock.calls.filter(([arg]) => arg.collectionId === COLLECTIONS.CLIENT_PAYMENTS)
    .flatMap(([arg]) => arg.queries.map(JSON.parse));
  expect(queries.some(query => query.field === 'updatedAt')).toBe(false);
});

test('independent BGC is included once and appears in its own target detail category', async () => {
  mockFinancialRows = [];
  mockFollowupRows = [{ $id: 'bgc', leadId: 'manual_followup:bgc:profile', candidateName: 'BGC Profile', amount: 300,
    date: '2026-10-15', status: 'paid', creditedAgentId: 'agent', createdById: 'viewer' }];
  const { getTargetReportAction } = await import('@/app/actions/target-report');
  const { getAgentPaymentDetailsAction } = await import('@/app/actions/agent-payment-details');
  const { result } = await getTargetReportAction({ actorId: 'viewer', monthKey: '2026-10' });
  expect(result.rows.flatMap(team => team.agents).find(agent => agent.userId === 'agent')).toMatchObject({ achieved: 300, bgcAmount: 300 });
  const detail = await getAgentPaymentDetailsAction({ actorId: 'viewer', agentId: 'agent', monthKey: '2026-10' });
  expect(detail.bgc).toEqual([expect.objectContaining({ category: 'bgc', candidateName: 'BGC Profile', amount: 300 })]);
  expect(detail.bgcTotal).toBe(300);
  expect(detail.upfrontTotal).toBe(0);
});

test('an unlinked July followup recorded by Admin in September belongs only to the assigned profile in July', async () => {
  mockFinancialRows = [{ leadId: 'lead', paymentPlan: '{}', updates: JSON.stringify([
    { id: 'legacy', actorId: 'admin', status: 'fully_paid', amount: 800,
      note: 'Followup payment added', createdAt: '2026-09-15T14:12:00Z' },
  ]) }];
  mockFollowupRows = [{ $id: 'followup', leadId: 'lead', amount: 800, status: 'paid', date: '2026-07-10',
    createdAt: '2026-09-15T14:12:00Z', createdById: 'admin' }];
  const { getTargetReportAction } = await import('@/app/actions/target-report');
  const { getAgentPaymentDetailsAction } = await import('@/app/actions/agent-payment-details');
  for (const [monthKey, expected] of [['2026-07', 800], ['2026-09', 0]] as const) {
    const { result } = await getTargetReportAction({ actorId: 'viewer', monthKey });
    const agent = result.rows.flatMap(team => team.agents).find(row => row.userId === 'agent');
    expect(agent?.achieved).toBe(expected);
    expect((await getAgentPaymentDetailsAction({ actorId: 'viewer', agentId: 'agent', monthKey })).totalAmount).toBe(expected);
    const admin = await getAgentPaymentDetailsAction({ actorId: 'viewer', agentId: 'admin', monthKey });
    expect(admin.upfrontTotal).toBe(0);
  }
});

test('manually typed followups appear without any matching lead or client payment', async () => {
  mockFinancialRows = [];
  mockFollowupRows = [{ $id: 'manual', leadId: 'manual_followup:profile', candidateName: 'Typed Profile', amount: 500,
    date: '2026-10-06', status: 'paid', creditedAgentId: 'agent', createdById: 'admin' }];
  const { getTargetReportAction } = await import('@/app/actions/target-report');
  const { getAgentPaymentDetailsAction } = await import('@/app/actions/agent-payment-details');
  const { result } = await getTargetReportAction({ actorId: 'viewer', monthKey: '2026-10' });
  expect(result.rows.flatMap(team => team.agents).find(agent => agent.userId === 'agent')).toMatchObject({ achieved: 500, followupsAmount: 500 });
  const detail = await getAgentPaymentDetailsAction({ actorId: 'viewer', agentId: 'agent', monthKey: '2026-10' });
  expect(detail.technicalAndFollowups).toEqual([expect.objectContaining({ candidateName: 'Typed Profile', amount: 500, category: 'followup' })]);
  const leadQueries = mockListAll.mock.calls.filter(([arg]) => arg.collectionId === COLLECTIONS.LEADS).flatMap(([arg]) => arg.queries.map(JSON.parse));
  expect(leadQueries.some(query => (JSON.stringify(query.value) || '').includes('manual_followup:profile'))).toBe(false);
});

test('legacy manual payments without a credited profile are visible as unassigned to leadership', async () => {
  mockFinancialRows = [];
  mockFollowupRows = [{ $id: 'manual', leadId: 'manual_followup:legacy', candidateName: 'Legacy Profile', amount: 750,
    date: '2026-10-06', status: 'paid' }];
  const { getTargetReportAction } = await import('@/app/actions/target-report');
  const { getAgentPaymentDetailsAction } = await import('@/app/actions/agent-payment-details');
  const { result } = await getTargetReportAction({ actorId: 'viewer', monthKey: '2026-10' });
  expect(result.rows.find(row => row.teamLeadId === 'unassigned-followups')).toMatchObject({ achieved: 750, target: 0 });
  const detail = await getAgentPaymentDetailsAction({ actorId: 'viewer', agentId: 'unassigned-followups', monthKey: '2026-10' });
  expect(detail.technicalAndFollowups).toEqual([expect.objectContaining({ candidateName: 'Legacy Profile', amount: 750 })]);
  mockActor.mockResolvedValue(people.find(person => person.$id === 'tl'));
  const limited = await getTargetReportAction({ actorId: 'viewer', monthKey: '2026-10' });
  expect(limited.result.rows.some(row => row.teamLeadId === 'unassigned-followups')).toBe(false);
  await expect(getAgentPaymentDetailsAction({ actorId: 'viewer', agentId: 'unassigned-followups', monthKey: '2026-10' })).rejects.toThrow('Not authorized');
});
