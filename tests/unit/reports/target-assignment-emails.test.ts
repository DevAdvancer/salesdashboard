import { COLLECTIONS } from '@/lib/constants/appwrite';
import { upsertMonthlyTeamTargetAction, replaceMonthlyTargetAssignmentsAction } from '@/app/actions/monthly-targets';

const mockEmail = jest.fn();
const mockExisting = jest.fn();
const mockAssignments = jest.fn();
const mockWrite = jest.fn();
jest.mock('node-appwrite', () => ({ ID: { unique: () => 'new' }, Query: {
  equal: jest.fn(), limit: jest.fn(),
} }));
const tl = { $id: 'tl', name: 'Team Lead', email: 'tl@example.com', role: 'team_lead', department: 'sales' };
const agent = { $id: 'agent', name: 'Agent', email: 'agent@example.com', role: 'agent', department: 'sales' };
jest.mock('@/lib/server/target-assignment-email', () => ({ sendTargetAssignmentEmail: (...args: unknown[]) => mockEmail(...args) }));
jest.mock('@/lib/server/current-user', () => ({ assertAuthenticatedUserId: async () => undefined }));
jest.mock('@/lib/services/user-service', () => ({
  getUserByIdOrNull: async () => tl, getAgentsByTeamLead: async () => [agent],
}));
jest.mock('@/lib/server/appwrite-pagination', () => ({ listAllDocuments: () => mockAssignments() }));
jest.mock('@/lib/server/appwrite', () => ({ createAdminClient: async () => ({ databases: {
  getDocument: async (_db: string, collection: string) => collection === COLLECTIONS.USERS
    ? { $id: 'admin', name: 'Admin', role: 'admin' }
    : { $id: 'target', teamLeadId: 'tl', monthKey: '2026-11' },
  listDocuments: async () => ({ documents: mockExisting() }),
  updateDocument: (...args: unknown[]) => mockWrite(...args),
  createDocument: (...args: unknown[]) => mockWrite(...args),
  deleteDocument: jest.fn(),
} }) }));

beforeEach(() => {
  jest.clearAllMocks();
  mockExisting.mockReturnValue([]);
  mockAssignments.mockResolvedValue([]);
  mockWrite.mockImplementation(async (_db, _col, id, payload) => ({ $id: id, ...payload }));
});

test('emails the team lead after saving a team target and skips unchanged saves', async () => {
  const input = { actorId: 'admin', teamLeadId: 'tl', monthKey: '2026-11', totalAmount: 5000 };
  await upsertMonthlyTeamTargetAction(input);
  expect(mockEmail).toHaveBeenCalledWith({ email: tl.email, name: tl.name, monthKey: '2026-11', amount: 5000, scope: 'team' });
  expect(mockWrite.mock.invocationCallOrder[0]).toBeLessThan(mockEmail.mock.invocationCallOrder[0]);
  mockEmail.mockClear();
  mockExisting.mockReturnValue([{ $id: 'target', totalAmount: 5000 }]);
  await upsertMonthlyTeamTargetAction(input);
  expect(mockEmail).not.toHaveBeenCalled();
});

test('emails new and changed personal assignments, including a TL assigned by an admin', async () => {
  mockAssignments.mockResolvedValue([{ $id: 'old', agentId: 'agent', amount: 100 }]);
  await replaceMonthlyTargetAssignmentsAction({ actorId: 'admin', monthlyTargetId: 'target', assignments: [
    { agentId: 'agent', amount: 150 }, { agentId: 'tl', amount: 200 },
  ] });
  expect(mockEmail).toHaveBeenCalledTimes(2);
  expect(mockEmail).toHaveBeenCalledWith({ email: tl.email, name: tl.name, monthKey: '2026-11', amount: 200, scope: 'personal' });
  expect(mockEmail).toHaveBeenCalledWith({ email: agent.email, name: agent.name, monthKey: '2026-11', amount: 150, scope: 'personal' });
});

test('does not email unchanged or removed personal assignments', async () => {
  mockAssignments.mockResolvedValue([{ $id: 'old', agentId: 'agent', amount: 100 }, { $id: 'removed', agentId: 'tl', amount: 50 }]);
  await replaceMonthlyTargetAssignmentsAction({ actorId: 'admin', monthlyTargetId: 'target', assignments: [{ agentId: 'agent', amount: 100 }] });
  expect(mockEmail).not.toHaveBeenCalled();
});
