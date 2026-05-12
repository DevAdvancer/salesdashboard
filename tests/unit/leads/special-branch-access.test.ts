import { listLeads } from '@/lib/services/lead-service';
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
});
