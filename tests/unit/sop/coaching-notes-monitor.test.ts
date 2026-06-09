export {};

const mockAssertAuthenticatedUserId = jest.fn();
const mockCreateAdminClient = jest.fn();
const mockGetDocument = jest.fn();
const mockListDocuments = jest.fn();
const mockCreateDocument = jest.fn();

jest.mock("@/lib/server/current-user", () => ({
  assertAuthenticatedUserId: (...args: unknown[]) => mockAssertAuthenticatedUserId(...args),
}));

jest.mock("@/lib/server/appwrite", () => ({
  createAdminClient: () => mockCreateAdminClient(),
}));

jest.mock("@/lib/server/notifications", () => ({
  createNotificationsForRecipients: jest.fn(),
}));

jest.mock("@/app/actions/lead", () => ({
  listLeadsAction: jest.fn(),
}));

jest.mock("node-appwrite", () => ({
  ID: {
    unique: jest.fn(() => "unique-id"),
  },
  Query: {
    equal: jest.fn((key, value) => `equal:${key}:${JSON.stringify(value)}`),
    limit: jest.fn((limit) => `limit:${limit}`),
    orderDesc: jest.fn((key) => `orderDesc:${key}`),
  },
}));

describe("monitor coaching notes authorization", () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    process.env.NEXT_PUBLIC_APPWRITE_DATABASE_ID = "database";
    process.env.NEXT_PUBLIC_APPWRITE_USERS_COLLECTION_ID = "users";
    process.env.NEXT_PUBLIC_APPWRITE_COACHING_NOTES_COLLECTION_ID = "coaching-notes";

    mockAssertAuthenticatedUserId.mockResolvedValue({ $id: "monitor-1" });
    mockGetDocument.mockResolvedValue({
      $id: "monitor-1",
      name: "Monitor",
      email: "monitor@example.com",
      role: "monitor",
      branchIds: [],
    });
    mockListDocuments.mockResolvedValue({
      documents: [
        {
          $id: "note-1",
          targetUserId: "agent-1",
          targetUserName: "Agent",
          authorId: "admin-1",
          authorName: "Admin",
          note: "Existing note",
          visibility: "leadership",
          createdAt: "2026-06-01T00:00:00.000Z",
          updatedAt: null,
        },
      ],
    });
    mockCreateDocument.mockResolvedValue({
      $id: "note-2",
      targetUserId: "agent-1",
      targetUserName: "Agent",
      authorId: "monitor-1",
      authorName: "Monitor",
      note: "Monitor note",
      visibility: "leadership",
      createdAt: "2026-06-08T00:00:00.000Z",
      updatedAt: null,
    });
    mockCreateAdminClient.mockResolvedValue({
      databases: {
        getDocument: mockGetDocument,
        listDocuments: mockListDocuments,
        createDocument: mockCreateDocument,
      },
    });
  });

  it("allows monitors to list and create coaching notes", async () => {
    const { listCoachingNotesAction, createCoachingNoteAction } = await import("@/app/actions/sop");

    await expect(listCoachingNotesAction("monitor-1")).resolves.toHaveLength(1);
    await expect(
      createCoachingNoteAction({
        actorId: "monitor-1",
        targetUserId: "agent-1",
        targetUserName: "Agent",
        note: "Monitor note",
        visibility: "leadership",
      }),
    ).resolves.toMatchObject({
      authorId: "monitor-1",
      note: "Monitor note",
    });
  });

  it("allows operations to list coaching notes but rejects creating them", async () => {
    mockGetDocument.mockResolvedValue({
      $id: "operations-1",
      name: "Operations",
      email: "operations@example.com",
      role: "operations",
      branchIds: [],
    });

    const { listCoachingNotesAction, createCoachingNoteAction } = await import("@/app/actions/sop");

    await expect(listCoachingNotesAction("operations-1")).resolves.toHaveLength(1);
    await expect(
      createCoachingNoteAction({
        actorId: "operations-1",
        targetUserId: "agent-1",
        targetUserName: "Agent",
        note: "Operations note",
        visibility: "leadership",
      }),
    ).rejects.toThrow("Not authorized");
    expect(mockCreateDocument).not.toHaveBeenCalled();
  });
});
