let mockDatabases: {
  getDocument: jest.Mock;
  listDocuments: jest.Mock;
  createDocument: jest.Mock;
};

jest.mock('@/lib/server/current-user', () => ({
  assertAuthenticatedUserId: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('@/lib/server/appwrite', () => ({
  createAdminClient: jest.fn(async () => ({ databases: mockDatabases })),
}));

jest.mock('node-appwrite', () => ({
  ID: {
    unique: jest.fn(() => 'generated-id'),
  },
  Query: {
    equal: jest.fn((field, value) => ({ field, value })),
    limit: jest.fn((limit) => ({ limit })),
  },
}));

const { reserveAssessmentAttempt, countAssessmentEmailsSentInRange } = require('@/app/actions/assessment');
const { reserveInterviewAttempt, countInterviewEmailsSentInRange } = require('@/app/actions/interview');
const { countMockEmailsSentInRange } = require('@/app/actions/mock');

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

describe('support emails sent in range', () => {
  beforeEach(() => {
    mockDatabases = {
      getDocument: jest.fn(),
      listDocuments: jest.fn(),
      createDocument: jest.fn(),
    };
    jest.clearAllMocks();
  });

  // Two emails sent this month + two sent last month against the same leads.
  // The dashboard tile asks for "this month" and must count all four sends
  // whose lastAttemptAt lands inside the window — not just the two whose
  // lead happened to be created in the window.
  const buildDocs = () => [
    { $id: 'a1', leadId: 'lead-1', userId: 'u1', attemptCount: '1', lastAttemptAt: '2026-07-02T10:00:00.000Z', sentSubjects: ['one'] },
    { $id: 'a2', leadId: 'lead-1', userId: 'u2', attemptCount: '1', lastAttemptAt: '2026-07-05T10:00:00.000Z', sentSubjects: ['two'] },
    { $id: 'a3', leadId: 'lead-2', userId: 'u1', attemptCount: '1', lastAttemptAt: '2026-07-09T10:00:00.000Z', sentSubjects: ['three'] },
    { $id: 'a4', leadId: 'lead-2', userId: 'u2', attemptCount: '1', lastAttemptAt: '2026-06-28T10:00:00.000Z', sentSubjects: ['four'] },
  ];

  const RANGE_FROM = '2026-07-01T00:00:00.000Z';
  const RANGE_TO = '2026-07-31T23:59:59.999Z';

  it('counts interview emails by send date, not lead creation date', async () => {
    mockDatabases.listDocuments.mockResolvedValueOnce({ documents: buildDocs() });
    await expect(
      countInterviewEmailsSentInRange('user-3', ['lead-1', 'lead-2'], RANGE_FROM, RANGE_TO)
    ).resolves.toBe(3);
  });

  it('counts assessment emails by send date', async () => {
    mockDatabases.listDocuments.mockResolvedValueOnce({ documents: buildDocs() });
    await expect(
      countAssessmentEmailsSentInRange('user-3', ['lead-1', 'lead-2'], RANGE_FROM, RANGE_TO)
    ).resolves.toBe(3);
  });

  it('counts mock emails by send date', async () => {
    mockDatabases.listDocuments.mockResolvedValueOnce({ documents: buildDocs() });
    await expect(
      countMockEmailsSentInRange('user-3', ['lead-1', 'lead-2'], RANGE_FROM, RANGE_TO)
    ).resolves.toBe(3);
  });

  it('returns 0 when no lead IDs are provided', async () => {
    await expect(
      countInterviewEmailsSentInRange('user-3', [], RANGE_FROM, RANGE_TO)
    ).resolves.toBe(0);
    expect(mockDatabases.listDocuments).not.toHaveBeenCalled();
  });
});
