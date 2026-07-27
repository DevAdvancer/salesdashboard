import { listLeads } from '@/lib/services/lead/queries';
import { databases } from '@/lib/appwrite';
import { Query } from 'appwrite';

// Mock Appwrite
jest.mock('@/lib/appwrite', () => ({
  databases: {
    listDocuments: jest.fn(),
    getDocument: jest.fn(),
  },
  DATABASE_ID: 'test-database',
  COLLECTIONS: {
    LEADS: 'test-leads-collection',
  },
}));

// Mock Query to inspect calls
jest.mock('appwrite', () => ({
  Query: {
    equal: jest.fn((key, value) => `equal("${key}", ${JSON.stringify(value)})`),
    notEqual: jest.fn((key, value) => `notEqual("${key}", ${JSON.stringify(value)})`),
    contains: jest.fn((key, value) => `contains("${key}", ${JSON.stringify(value)})`),
    orderDesc: jest.fn((key) => `orderDesc("${key}")`),
    greaterThanEqual: jest.fn(),
    lessThanEqual: jest.fn(),
    limit: jest.fn((limit) => `limit(${limit})`),
    or: jest.fn((conditions) => `or(${conditions.join('|')})`),
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
  }
}));

describe('Lead Visibility - Multi-Branch TeamLead', () => {
  const mockManagerId = 'teamLead-1';
  const branchA = 'branch-a';
  const branchB = 'branch-b';

  beforeEach(() => {
    jest.clearAllMocks();
    // The listLeads service calls getUserById(actorId) → getDocument
    // to load the viewer's role and branchIds for visibility scoping.
    // We mock it to return a teamLead with both branch IDs.
    (databases.getDocument as jest.Mock).mockResolvedValue({
      $id: mockManagerId,
      name: 'Test TeamLead',
      email: 'teamLead@example.com',
      role: 'team_lead',
      branchIds: [branchA, branchB],
    });
  });

  // Branch-wide lead visibility belonged to the removed `manager` role. Team
  // leads are now scoped to their own hierarchy (their agents own the leads,
  // their lead-generation users only become visible once a lead is assigned),
  // see getTeamLeadLeadVisibilityScope in lib/services/lead-service.ts. The
  // viewer's branchIds must therefore never widen the query to every lead in
  // those branches.
  it('does not widen a multi-branch team lead to every lead in their branches', async () => {
    const branchIds = [branchA, branchB];

    (databases.listDocuments as jest.Mock)
      .mockResolvedValueOnce({
        documents: [{ $id: 'agent-1', role: 'agent', teamLeadId: mockManagerId }],
      })
      .mockResolvedValueOnce({ documents: [] });

    await listLeads({}, mockManagerId, 'team_lead', branchIds);

    // The first listDocuments call is the team lookup, the second is the
    // actual lead query.
    const callArgs = (databases.listDocuments as jest.Mock).mock.calls[1];
    const queries = callArgs[2];

    expect(Query.equal).not.toHaveBeenCalledWith('branchId', branchIds);
    expect(Query.equal).not.toHaveBeenCalledWith('branchId', branchA);
    expect(Query.equal).not.toHaveBeenCalledWith('branchId', branchB);
    expect(Query.contains).not.toHaveBeenCalledWith('branchIds', branchIds);

    expect(queries).toContain(
      `or(equal("ownerId", ["${mockManagerId}","agent-1"])|equal("assignedToId", ["${mockManagerId}","agent-1"]))`
    );
  });

  it('scopes a single-branch team lead to their own hierarchy', async () => {
    const branchIds = [branchA];

    (databases.listDocuments as jest.Mock)
      .mockResolvedValueOnce({
        documents: [{ $id: 'agent-1', role: 'agent', teamLeadId: mockManagerId }],
      })
      .mockResolvedValueOnce({ documents: [] });

    await listLeads({}, mockManagerId, 'team_lead', branchIds);

    const callArgs = (databases.listDocuments as jest.Mock).mock.calls[1];
    const queries = callArgs[2];

    expect(Query.equal).not.toHaveBeenCalledWith('branchId', branchIds);
    expect(Query.equal).not.toHaveBeenCalledWith('branchId', branchA);

    expect(queries).toContain(
      `or(equal("ownerId", ["${mockManagerId}","agent-1"])|equal("assignedToId", ["${mockManagerId}","agent-1"]))`
    );
  });
});
