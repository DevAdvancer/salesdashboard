import fc from 'fast-check';
import { closeLeadAction } from '@/lib/actions/lead/status';
import { COLLECTIONS } from '@/lib/constants/appwrite';
const mockWrite = jest.fn();
const mockAccess = jest.fn();
let mockBranches = ['ncr', 'ahm'];
let mockActive = true;
let mockLeadOwner = 'agent';
let mockActorRole = 'agent';
let mockPhone: unknown = '5551234567';
jest.mock('@/lib/server/current-user', () => ({ assertAuthenticatedUserId: jest.fn() }));
jest.mock('@/lib/server/notifications', () => ({ createNotificationsForRecipients: jest.fn() }));
jest.mock('@/lib/server/lead-request-release', () => ({ withdrawLeadRequests: jest.fn() }));
jest.mock('@/lib/actions/lead/visibility', () => ({ assertLeadAccessAllowed: (...args: unknown[]) => mockAccess(...args), getHierarchyPermissionsServer: async () => [] }));
jest.mock('node-appwrite', () => ({ ID: { unique: () => 'event' }, Query: {}, Permission: { read: (id: string) => id, update: (id: string) => id, delete: (id: string) => id }, Role: { user: (id: string) => id } }));
jest.mock('@/lib/server/appwrite', () => ({ createAdminClient: async () => ({ databases: {
  getDocument: async (_db: string, collection: string, id: string) => collection === COLLECTIONS.USERS
    ? { $id: id, name: 'Agent', role: id === 'agent' ? mockActorRole : 'agent', department: 'sales', branchIds: id === 'agent' ? mockBranches : ['owner-ahm'], primaryBranchId: id === 'agent' ? mockBranches[0] : 'owner-ahm' }
    : collection === COLLECTIONS.BRANCHES ? { $id: id, isActive: mockActive }
    : { $id: 'lead', ownerId: mockLeadOwner, assignedToId: null, branchId: 'ncr', isClosed: false, status: 'Interested', data: JSON.stringify({ phone: mockPhone }) },
  updateDocument: (...args: unknown[]) => mockWrite(...args), createDocument: async () => ({}),
} }) }));
beforeEach(() => { jest.clearAllMocks(); mockPhone = '5551234567'; mockBranches = ['ncr', 'ahm']; mockActive = true; mockLeadOwner = 'agent'; mockActorRole = 'agent';
  mockWrite.mockImplementation(async (_db, _col, id, data) => ({ $id: id, ...data })); });

test('saves exactly one assigned branch and uses the server role even when the client claims admin', async () => {
  await fc.assert(fc.asyncProperty(fc.uniqueArray(fc.uuid(), { minLength: 2, maxLength: 5 }), async branches => {
    mockBranches = branches; mockWrite.mockClear();
    const result = await closeLeadAction('lead', 'Won', 'agent', 'Agent', 'admin', branches[1]);
    expect(result.lead.branchId).toBe(branches[1]);
    expect(mockWrite).toHaveBeenCalledWith(expect.anything(), COLLECTIONS.LEADS, 'lead', expect.objectContaining({ branchId: branches[1], assignedToId: 'agent', isClosed: true }), expect.anything());
    expect(mockAccess).toHaveBeenCalled();
  }));
});
test('rejects omitted, unassigned and inactive branches before writing the closure', async () => {
  for (const selected of [undefined, '', 'foreign']) await expect(closeLeadAction('lead', 'Won', 'agent', 'Agent', 'admin', selected)).rejects.toThrow();
  mockActive = false;
  await expect(closeLeadAction('lead', 'Won', 'agent', 'Agent', 'agent', 'ncr')).rejects.toThrow('active assigned branch');
  expect(mockWrite).not.toHaveBeenCalled();
});
test('branch membership and a forged role never authorize closing another agent’s lead', async () => {
  await fc.assert(fc.asyncProperty(fc.uuid(), async owner => {
    mockLeadOwner = owner;
    await expect(closeLeadAction('lead', 'Won', 'agent', 'Agent', 'admin', 'ahm')).rejects.toThrow('Permission denied');
    expect(mockWrite).not.toHaveBeenCalled();
  }));
});

test('an administrator closing another owner lead uses the owner branch rather than administrator memberships', async () => {
  mockActorRole = 'admin';
  mockLeadOwner = 'other-owner';
  const result = await closeLeadAction('lead', 'Won', 'agent', 'Admin', 'admin', '');
  expect(result.lead.branchId).toBe('owner-ahm');
});

test('rejects closing without a phone for every closing role before writing', async () => {
  for (const role of ['agent', 'team_lead', 'senior_tl', 'monitor', 'admin', 'developer']) {
    mockActorRole = role;
    for (const phone of [undefined, null, '', '   ', 'N/A']) {
      mockPhone = phone;
      await expect(closeLeadAction('lead', 'Won', 'agent', 'Agent', role as any, 'ncr')).rejects.toThrow('Phone is required');
    }
  }
  expect(mockWrite).not.toHaveBeenCalled();
});
