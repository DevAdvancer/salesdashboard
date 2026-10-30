import fc from 'fast-check';
import { COLLECTIONS } from '@/lib/constants/appwrite';
import { listPreviousFollowupsPaymentsAction, createPreviousFollowupsPaymentAction } from '@/app/actions/previous-followups-payments';

let mockActor: any;
let mockRows: any[] = [];
const mockCreate = jest.fn(async (_db, _collection, id, data) => ({ $id: id, ...data }));
const mockQueries: any[] = [];
jest.mock('@/lib/server/current-user', () => ({ assertAuthenticatedUserId: jest.fn() }));
jest.mock('@/app/actions/client-payments/shared', () => ({ canActorAccessLead: jest.fn(async () => true) }));
jest.mock('@/lib/services/user-service', () => ({
  getAgentsByTeamLead: async () => [{ $id: 'team-agent' }],
  getAllActiveUsers: async () => [],
}));
jest.mock('node-appwrite', () => ({
  ID: { unique: () => 'id' },
  Query: Object.fromEntries(['equal', 'or', 'orderDesc', 'greaterThanEqual', 'lessThanEqual', 'select'].map(method =>
    [method, (field: unknown, value?: unknown) => JSON.stringify({ method, field, value })])),
}));
jest.mock('@/lib/server/appwrite', () => ({ createAdminClient: async () => ({ databases: {
  getDocument: async () => mockActor, createDocument: (...args: any[]) => mockCreate(...args),
} }) }));
jest.mock('@/lib/server/appwrite-pagination', () => ({ listAllDocuments: async ({ queries, collectionId }: any) => {
  if (collectionId === COLLECTIONS.USERS) return [];
  expect(collectionId).toBe(COLLECTIONS.PREVIOUS_FOLLOWUPS_PAYMENTS);
  const filters = queries.map(JSON.parse);
  mockQueries.push(...filters);
  const matches = (row: any, filter: any): boolean => filter.method === 'equal'
    ? (Array.isArray(filter.value) ? filter.value : [filter.value]).includes(row[filter.field])
    : filter.method === 'or' ? filter.field.some((part: string) => matches(row, JSON.parse(part))) : true;
  return mockRows.filter(row => filters.every((filter: any) => matches(row, filter)));
} }));

beforeEach(() => { mockQueries.length = 0; mockCreate.mockClear(); });

test('agents and team leads can find old credited history without seeing unrelated profiles', async () => {
  await fc.assert(fc.asyncProperty(fc.constantFrom('agent', 'lead_generation', 'team_lead'),
    fc.integer({ min: 2000, max: 2025 }), async (role, year) => {
      mockActor = { $id: 'actor', name: 'Actor', role, department: 'sales' };
      mockRows = [
        { $id: 'own', leadId: 'manual_followup:bgc:own', amount: 100, date: `${year}-08-15`, creditedAgentId: 'actor', createdById: 'admin' },
        { $id: 'team', leadId: 'manual_followup:bgc:team', amount: 200, date: `${year}-08-15`, creditedAgentId: 'team-agent', createdById: 'admin' },
        { $id: 'private', leadId: 'manual_followup:bgc:private', amount: 300, date: `${year}-08-15`, creditedAgentId: 'unrelated', createdById: 'admin' },
      ];
      const rows = await listPreviousFollowupsPaymentsAction({ actorId: 'actor' });
      expect(rows.map(row => row.$id)).toEqual(role === 'team_lead' ? ['own', 'team'] : ['own']);
      expect(mockQueries.some(query => query.method === 'greaterThanEqual' && query.field === 'date')).toBe(false);
    }), { numRuns: 30 });
});

test('ordinary agents cannot assign independent BGC revenue to an arbitrary profile', async () => {
  await fc.assert(fc.asyncProperty(fc.constantFrom('agent', 'lead_generation'),
    fc.stringMatching(/^[a-z]{2,12}$/).filter(id => id !== 'actor'), async (role, creditedAgentId) => {
      mockActor = { $id: 'actor', name: 'Actor', role, department: 'sales' };
      await expect(createPreviousFollowupsPaymentAction({ actorId: 'actor', category: 'bgc', company: 'Silverspace INC',
        candidateName: 'Profile', amount: 100, date: '2026-08-15', creditedAgentId })).rejects.toThrow('Not authorized');
      expect(mockCreate).not.toHaveBeenCalled();
    }), { numRuns: 20 });
});
