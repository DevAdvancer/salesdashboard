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

const { reserveAssessmentAttempt } = require('@/app/actions/assessment');
const { reserveInterviewAttempt } = require('@/app/actions/interview');

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
