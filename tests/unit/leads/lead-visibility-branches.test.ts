import { listLeads } from '@/lib/services/lead-service';
import { databases } from '@/lib/appwrite';
import { Query } from 'appwrite';

// Mock Appwrite
jest.mock('@/lib/appwrite', () => ({
  databases: {
    listDocuments: jest.fn(),
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
    orderDesc: jest.fn((key) => `orderDesc("${key}")`),
    greaterThanEqual: jest.fn(),
    lessThanEqual: jest.fn(),
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

describe('Lead Visibility - Multi-Branch Manager', () => {
  const mockManagerId = 'manager-1';
  const branchA = 'branch-a';
  const branchB = 'branch-b';

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should query leads for all assigned branches', async () => {
    const branchIds = [branchA, branchB];

    (databases.listDocuments as jest.Mock).mockResolvedValue({
      documents: [],
    });

    await listLeads({}, mockManagerId, 'manager', branchIds);

    const callArgs = (databases.listDocuments as jest.Mock).mock.calls[0];
    const queries = callArgs[2];

    // Expect Query.equal to have been called with 'branchId' and the array of branches
    expect(Query.equal).toHaveBeenCalledWith('branchId', branchIds);

    // Expect the queries array to contain the result of Query.equal
    expect(queries).toContain(`equal("branchId", ["${branchA}","${branchB}"])`);
  });

  it('should query leads for single assigned branch', async () => {
    const branchIds = [branchA];

    (databases.listDocuments as jest.Mock).mockResolvedValue({
      documents: [],
    });

    await listLeads({}, mockManagerId, 'manager', branchIds);

    const callArgs = (databases.listDocuments as jest.Mock).mock.calls[0];
    const queries = callArgs[2];

    expect(Query.equal).toHaveBeenCalledWith('branchId', branchIds);
    expect(queries).toContain(`equal("branchId", ["${branchA}"])`);
  });
});
