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
    (databases.listDocuments as jest.Mock)
      .mockResolvedValueOnce({
        documents: [
          { $id: 'tl-1', role: 'team_lead', teamLeadIds: ['mgr-1'] },
          { $id: 'agent-1', role: 'agent', teamLeadId: 'tl-1' },
        ],
      })
      .mockResolvedValueOnce({ documents: [] });

    await listLeads({}, 'mgr-1', 'team_lead', []);

    expect(Query.equal).toHaveBeenCalledWith('ownerId', ['mgr-1', 'tl-1', 'agent-1']);
    expect(Query.equal).toHaveBeenCalledWith('assignedToId', ['mgr-1', 'tl-1', 'agent-1']);
  });
});
