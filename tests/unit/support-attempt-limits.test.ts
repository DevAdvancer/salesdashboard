let mockDatabases: {
  getDocument: jest.Mock;
  listDocuments: jest.Mock;
  createDocument: jest.Mock;
};

jest.mock('@/lib/server/current-user', () => ({
  assertAuthenticatedUserId: jest.fn().mockResolvedValue(undefined),
  getAuthenticatedAccount: jest.fn().mockResolvedValue({ $id: 'user-3' }),
}));

jest.mock('@/lib/server/appwrite', () => ({
  createAdminClient: jest.fn(async () => ({ databases: mockDatabases })),
}));

jest.mock('@/lib/server/appwrite-pagination', () => ({
  listAllDocuments: jest.fn(),
}));

jest.mock('@/app/actions/lead', () => ({
  listLeadsAction: jest.fn(),
}));

jest.mock('node-appwrite', () => ({
  ID: {
    unique: jest.fn(() => 'generated-id'),
  },
  Query: {
    equal: jest.fn((field, value) => ({ method: 'equal', field, value })),
    limit: jest.fn((limit) => ({ method: 'limit', limit })),
    greaterThanEqual: jest.fn((field, value) => ({ method: 'greaterThanEqual', field, value })),
    lessThanEqual: jest.fn((field, value) => ({ method: 'lessThanEqual', field, value })),
  },
}));

const { reserveAssessmentAttempt, countAssessmentEmailsSentInRange } = require('@/app/actions/assessment');
const { reserveInterviewAttempt, countInterviewEmailsSentInRange } = require('@/app/actions/interview');
const { countMockEmailsSentInRange } = require('@/app/actions/mock');
const { listAllDocuments } = require('@/lib/server/appwrite-pagination');
const { listLeadsAction } = require('@/app/actions/lead');

describe('support attempt limits', () => {
  beforeEach(() => {
    mockDatabases = {
      getDocument: jest.fn(),
      listDocuments: jest.fn(),
      createDocument: jest.fn(),
    };
    jest.clearAllMocks();
    mockDatabases.getDocument.mockResolvedValue({ name: 'Agent User', role: 'agent' });
    mockDatabases.createDocument.mockImplementation(
      async (_databaseId, _collectionId, documentId, data) => ({
        $id: documentId,
        ...data,
      })
    );
  });

  it('does not cap assessment support attempts at two', async () => {
    mockDatabases.listDocuments.mockResolvedValueOnce({
      documents: [
        {
          $id: 'attempt-1',
          leadId: 'lead-1',
          userId: 'user-1',
          attemptCount: 1,
          lastAttemptAt: '2026-05-18T10:00:00.000Z',
          sentSubjects: ['Assessment subject one'],
        },
        {
          $id: 'attempt-2',
          leadId: 'lead-1',
          userId: 'user-2',
          attemptCount: 1,
          lastAttemptAt: '2026-05-18T11:00:00.000Z',
          sentSubjects: ['Assessment subject two'],
        },
      ],
    });

    await expect(
      reserveAssessmentAttempt('user-3', 'lead-1', 'Assessment subject three')
    ).resolves.toMatchObject({
      leadId: 'lead-1',
      userId: 'user-3',
      attemptCount: 3,
    });
    expect(mockDatabases.createDocument).toHaveBeenCalled();
  });

  it('does not cap interview support attempts at two', async () => {
    mockDatabases.listDocuments.mockResolvedValueOnce({
      documents: [
        {
          $id: 'attempt-1',
          leadId: 'lead-1',
          userId: 'user-1',
          attemptCount: 1,
          lastAttemptAt: '2026-05-18T10:00:00.000Z',
          sentSubjects: ['Interview subject one'],
        },
        {
          $id: 'attempt-2',
          leadId: 'lead-1',
          userId: 'user-2',
          attemptCount: 1,
          lastAttemptAt: '2026-05-18T11:00:00.000Z',
          sentSubjects: ['Interview subject two'],
        },
      ],
    });

    await expect(
      reserveInterviewAttempt('user-3', 'lead-1', 'Interview subject three')
    ).resolves.toMatchObject({
      leadId: 'lead-1',
      userId: 'user-3',
      attemptCount: 3,
    });
    expect(mockDatabases.createDocument).toHaveBeenCalled();
  });
});

type StubQuery = { method: string; field?: string; value?: unknown };

describe('support emails sent in range', () => {
  // Three emails sent this month + one sent last month against the same leads.
  // The dashboard tile asks for "this month" and must count every send whose
  // lastAttemptAt lands inside the window, and only those.
  const buildDocs = () => [
    { $id: 'a1', leadId: 'lead-1', userId: 'u1', attemptCount: '1', lastAttemptAt: '2026-07-02T10:00:00.000Z', sentSubjects: ['one'] },
    { $id: 'a2', leadId: 'lead-1', userId: 'u2', attemptCount: '1', lastAttemptAt: '2026-07-05T10:00:00.000Z', sentSubjects: ['two'] },
    { $id: 'a3', leadId: 'lead-2', userId: 'u1', attemptCount: '1', lastAttemptAt: '2026-07-09T10:00:00.000Z', sentSubjects: ['three'] },
    { $id: 'a4', leadId: 'lead-2', userId: 'u2', attemptCount: '1', lastAttemptAt: '2026-06-28T10:00:00.000Z', sentSubjects: ['four'] },
  ];

  const RANGE_FROM = '2026-07-01T00:00:00.000Z';
  const RANGE_TO = '2026-07-31T23:59:59.999Z';
  const BRANCH_IDS = ['branch-1'];

  beforeEach(() => {
    mockDatabases = {
      getDocument: jest.fn(),
      listDocuments: jest.fn(),
      createDocument: jest.fn(),
    };
    jest.clearAllMocks();

    // Stand in for Appwrite by actually applying the queries the action builds.
    // That keeps the "counted by send date" assertion honest: if the action
    // ever filtered on the wrong attribute, these docs would not be returned.
    (listAllDocuments as jest.Mock).mockImplementation(
      async ({ queries }: { queries: StubQuery[] }) =>
        buildDocs().filter((doc) =>
          queries.every((query) => {
            if (!query.field) return true;
            const value = (doc as Record<string, unknown>)[query.field];
            if (query.method === 'greaterThanEqual') return String(value) >= String(query.value);
            if (query.method === 'lessThanEqual') return String(value) <= String(query.value);
            if (query.method === 'equal') return value === query.value;
            return true;
          })
        )
    );

    (listLeadsAction as jest.Mock).mockResolvedValue({
      leads: [{ $id: 'lead-1' }, { $id: 'lead-2' }],
      total: 2,
    });
  });

  it('counts interview emails by send date, not lead creation date', async () => {
    await expect(
      countInterviewEmailsSentInRange('user-3', 'admin', BRANCH_IDS, RANGE_FROM, RANGE_TO)
    ).resolves.toBe(3);
  });

  it('counts assessment emails by send date', async () => {
    await expect(
      countAssessmentEmailsSentInRange('user-3', 'admin', BRANCH_IDS, RANGE_FROM, RANGE_TO)
    ).resolves.toBe(3);
  });

  it('counts mock emails by send date', async () => {
    await expect(
      countMockEmailsSentInRange('user-3', 'admin', BRANCH_IDS, RANGE_FROM, RANGE_TO)
    ).resolves.toBe(3);
  });

  it('ignores attempts on leads the actor cannot see', async () => {
    (listLeadsAction as jest.Mock).mockResolvedValue({
      leads: [{ $id: 'lead-1' }],
      total: 1,
    });

    await expect(
      countInterviewEmailsSentInRange('user-3', 'agent', BRANCH_IDS, RANGE_FROM, RANGE_TO)
    ).resolves.toBe(2);
  });

  it('returns 0 without querying when the date range is missing', async () => {
    await expect(
      countInterviewEmailsSentInRange('user-3', 'admin', BRANCH_IDS, '', '')
    ).resolves.toBe(0);
    expect(listAllDocuments as jest.Mock).not.toHaveBeenCalled();
  });
});
