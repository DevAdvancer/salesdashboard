import { listLeads } from '@/lib/services/lead/queries';
import { databases } from '@/lib/appwrite';
import { getUserById } from '@/lib/services/user-service';
import { Query } from 'appwrite';

jest.mock('@/lib/appwrite', () => ({
  databases: {
    listDocuments: jest.fn(),
  },
  DATABASE_ID: 'test-database',
  COLLECTIONS: {
    LEADS: 'test-leads-collection',
    USERS: 'test-users-collection',
  },
}));

jest.mock('@/lib/services/user-service', () => ({
  getUserById: jest.fn(),
}));

jest.mock('appwrite', () => ({
  Query: {
    equal: jest.fn((key, value) => `equal("${key}", ${JSON.stringify(value)})`),
    notEqual: jest.fn((key, value) => `notEqual("${key}", ${JSON.stringify(value)})`),
    contains: jest.fn((key, value) => `contains("${key}", ${JSON.stringify(value)})`),
    or: jest.fn((conditions) => `or(${conditions.join(',')})`),
    orderDesc: jest.fn((key) => `orderDesc("${key}")`),
    limit: jest.fn((limit) => `limit(${limit})`),
  },
  Permission: {
    read: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
  Role: {
    user: jest.fn(),
  },
  ID: {
    unique: jest.fn(),
  },
}));

describe('special branch lead access', () => {
  const alishaUserId = '698cf7a3002db144acbd';
  const ncrBranchId = '698baf2643ccaf6ce902';

  beforeEach(() => {
    jest.clearAllMocks();
    (databases.listDocuments as jest.Mock).mockResolvedValue({ documents: [] });
  });

  it('keeps Alisha current team lead access and adds all NCR branch leads', async () => {
    (getUserById as jest.Mock).mockResolvedValue({
      $id: alishaUserId,
      email: 'Alisha.dsouza@silverspaceinc.com',
      role: 'team_lead',
      branchIds: ['698baf2f28cb7f1dccaf', ncrBranchId],
    });

    await listLeads({}, alishaUserId, 'team_lead', ['698baf2f28cb7f1dccaf', ncrBranchId]);

    const leadListCall = (databases.listDocuments as jest.Mock).mock.calls.at(-1);
    const queries = leadListCall[2];

    expect(Query.equal).toHaveBeenCalledWith('branchId', ncrBranchId);
    expect(Query.equal).toHaveBeenCalledWith('ownerId', [alishaUserId]);
    expect(Query.equal).toHaveBeenCalledWith('assignedToId', [alishaUserId]);
    expect(queries).toContain(
      `or(equal("ownerId", ["${alishaUserId}"]),equal("assignedToId", ["${alishaUserId}"]),equal("branchId", "${ncrBranchId}"))`
    );
  });

  it('adds all special branch leads for an agent', async () => {
    (getUserById as jest.Mock).mockResolvedValue({
      $id: 'agent-123',
      email: 'Alisha.dsouza@silverspaceinc.com',
      role: 'agent',
      branchIds: ['other-branch'],
    });

    await listLeads({}, 'agent-123', 'agent', ['other-branch']);

    const leadListCall = (databases.listDocuments as jest.Mock).mock.calls.at(-1);
    const queries = leadListCall[2];

    expect(Query.or).toHaveBeenCalled();
    expect(queries).toContain(
      `or(equal("assignedToId", "agent-123"),equal("ownerId", "agent-123"),equal("branchId", "${ncrBranchId}"))`
    );
  });
});
