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
}));

describe('lead hierarchy visibility', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (getUserById as jest.Mock).mockResolvedValue({
      $id: 'viewer-1',
      email: 'viewer@example.com',
      role: 'team_lead',
      branchIds: [],
    });
    (databases.listDocuments as jest.Mock).mockResolvedValue({ documents: [] });
  });

  it('shows TL-owned and agent-owned leads to the TL, but only shows lead-gen leads after assignment', async () => {
    (databases.listDocuments as jest.Mock)
      .mockResolvedValueOnce({
        documents: [
          { $id: 'agent-1', role: 'agent', teamLeadId: 'tl-1' },
          { $id: 'agent-2', role: 'agent', teamLeadId: 'tl-1' },
          { $id: 'lg-1', role: 'lead_generation', teamLeadId: 'tl-1' },
        ],
      })
      .mockResolvedValueOnce({ documents: [] });

    await listLeads({}, 'tl-1', 'team_lead', []);

    expect(Query.equal).toHaveBeenCalledWith('teamLeadId', 'tl-1');
    expect(Query.equal).toHaveBeenCalledWith('role', 'agent');
    expect(Query.equal).toHaveBeenCalledWith('role', 'lead_generation');
    expect(Query.equal).toHaveBeenCalledWith('ownerId', ['tl-1', 'agent-1', 'agent-2']);
    expect(Query.equal).toHaveBeenCalledWith('assignedToId', ['tl-1', 'agent-1', 'agent-2', 'lg-1']);
  });

  it('scopes teamLead leads to the teamLead and their hierarchy instead of all leads', async () => {
    // This case used to describe the removed `manager` role, which walked a
    // `managerIds` chain upwards. In the current role model (UserRole in
    // lib/types/index.ts has no `manager`) a team lead's scope is built from
    // the users whose `teamLeadId` points at them, so the interesting edge is
    // a team lead with no direct reports: the query must narrow to the viewer
    // alone and must never fall back to an unscoped "all leads" query.
    (databases.listDocuments as jest.Mock)
      .mockResolvedValueOnce({ documents: [] })
      .mockResolvedValueOnce({ documents: [] });

    await listLeads({}, 'mgr-1', 'team_lead', []);

    expect(Query.equal).toHaveBeenCalledWith('ownerId', ['mgr-1']);
    expect(Query.equal).toHaveBeenCalledWith('assignedToId', ['mgr-1']);

    // The second listDocuments call is the lead query itself; it must carry
    // the ownership/assignment scoping clause.
    const leadQueries = (databases.listDocuments as jest.Mock).mock.calls[1][2];
    expect(leadQueries).toContain(
      'or(equal("ownerId", ["mgr-1"]),equal("assignedToId", ["mgr-1"]))'
    );
  });
});
