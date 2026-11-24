import { createLeadNoteAction, listLeadNotesAction } from '@/app/actions/sop';
import { getLeadAction } from '@/app/actions/lead/queries';
import { COLLECTIONS, DATABASE_ID } from '@/lib/constants/appwrite';

const mockCreateDocument = jest.fn();
const mockListDocuments = jest.fn();

jest.mock('node-appwrite', () => ({
  ID: { unique: () => 'new-note' },
  Query: {
    equal: jest.fn(), or: jest.fn(), orderDesc: jest.fn(), limit: jest.fn(),
  },
}));
jest.mock('@/app/actions/lead/queries', () => ({ getLeadAction: jest.fn() }));
jest.mock('@/app/actions/lead/visibility', () => ({ assertLeadUpdateAllowed: jest.fn() }));
jest.mock('@/lib/server/current-user', () => ({ assertAuthenticatedUserId: jest.fn() }));
jest.mock('@/lib/server/notifications', () => ({ createNotificationsForRecipients: jest.fn() }));
jest.mock('@/lib/server/payment-reminder-notifications', () => ({ filterResolvedPaymentReminders: jest.fn() }));
jest.mock('@/lib/server/appwrite', () => ({
  createAdminClient: async () => ({
    databases: {
      getDocument: async () => ({ $id: 'agent', name: 'Casey', role: 'agent' }),
      createDocument: mockCreateDocument,
      uncachedReads: { listDocuments: mockListDocuments },
    },
  }),
}));

beforeEach(() => {
  jest.clearAllMocks();
});

it('saves a dated note using the deployed fields and returns it on the next read', async () => {
  jest.mocked(getLeadAction).mockResolvedValue({ status: 'Interested' } as Awaited<ReturnType<typeof getLeadAction>>);
  mockCreateDocument.mockImplementation(async (_database, _collection, $id, fields) => {
    if ('updatedAt' in fields) throw new Error('Unknown attribute: updatedAt');
    return { $id, ...fields };
  });
  const note = await createLeadNoteAction({
    actorId: 'agent', leadId: 'lead', body: '  Call on Monday.  ', visibility: 'team',
  });
  mockListDocuments.mockResolvedValue({ documents: [note] });

  expect(mockCreateDocument).toHaveBeenCalledWith(DATABASE_ID, COLLECTIONS.LEAD_NOTES, expect.any(String), {
    leadId: 'lead', authorId: 'agent', authorName: 'Casey',
    body: 'Call on Monday.', visibility: 'team', createdAt: expect.any(String),
  });
  expect(new Date(note.createdAt).toISOString()).toBe(note.createdAt);
  await expect(listLeadNotesAction('agent', 'lead')).resolves.toEqual([note]);
});

it('checks access to the lead before reading or writing notes', async () => {
  jest.mocked(getLeadAction).mockRejectedValue(new Error('Permission denied'));
  await expect(listLeadNotesAction('agent', 'other-team')).rejects.toThrow('Permission denied');
  await expect(createLeadNoteAction({
    actorId: 'agent', leadId: 'other-team', body: 'A note', visibility: 'team',
  })).rejects.toThrow('Permission denied');
  expect(mockListDocuments).not.toHaveBeenCalled();
  expect(mockCreateDocument).not.toHaveBeenCalled();
});
