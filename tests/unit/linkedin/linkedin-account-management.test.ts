export {};

const mockAssertAuthenticatedUserId = jest.fn();
const mockGetAuthenticatedUserDoc = jest.fn();
const mockCreateAdminClient = jest.fn();
const mockListDocuments = jest.fn();
const mockGetDocument = jest.fn();
const mockCreateDocument = jest.fn();

jest.mock("@/lib/server/current-user", () => ({
  assertAuthenticatedUserId: (...args: unknown[]) =>
    mockAssertAuthenticatedUserId(...args),
  getAuthenticatedUserDoc: () => mockGetAuthenticatedUserDoc(),
}));

jest.mock("@/lib/server/appwrite", () => ({
  createAdminClient: () => mockCreateAdminClient(),
}));

jest.mock("node-appwrite", () => ({
  ID: {
    unique: jest.fn(() => "unique-id"),
  },
  Permission: {
    read: jest.fn((role) => `read:${role}`),
    update: jest.fn((role) => `update:${role}`),
  },
  Query: {
    equal: jest.fn((key, value) => `equal:${key}:${JSON.stringify(value)}`),
    limit: jest.fn((limit) => `limit:${limit}`),
    orderAsc: jest.fn((key) => `orderAsc:${key}`),
  },
  Role: {
    label: jest.fn((label) => `label:${label}`),
  },
}));

describe("Linkedin account management authorization", () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    mockAssertAuthenticatedUserId.mockResolvedValue({ $id: "tl-1" });
    mockCreateAdminClient.mockResolvedValue({
      databases: {
        listDocuments: mockListDocuments,
        getDocument: mockGetDocument,
        createDocument: mockCreateDocument,
        updateDocument: jest.fn(),
      },
    });
    mockListDocuments.mockResolvedValue({ documents: [], total: 0 });
    mockCreateDocument.mockResolvedValue({ $id: "account-1" });
  });

  it("rejects team leads from saving Linkedin account changes", async () => {
    mockGetAuthenticatedUserDoc.mockResolvedValue({
      $id: "tl-1",
      name: "Team Lead",
      role: "team_lead",
    });

    const { upsertLinkedinAccountAction } = await import(
      "@/app/actions/linkedin"
    );

    await expect(
      upsertLinkedinAccountAction({
        currentUserId: "tl-1",
        assignedUserId: "agent-1",
        company: "SilverSpace Inc.",
        idName: "Main",
        accountType: "main",
        licenseType: "Normal",
        connectionLimit: 20,
      }),
    ).rejects.toThrow("Unauthorized");
    expect(mockCreateAdminClient).not.toHaveBeenCalled();
  });

  it("allows admins to assign a Linkedin account directly to a team lead", async () => {
    mockAssertAuthenticatedUserId.mockResolvedValue({ $id: "admin-1" });
    mockGetAuthenticatedUserDoc.mockResolvedValue({
      $id: "admin-1",
      name: "Admin",
      role: "admin",
    });
    mockGetDocument.mockResolvedValue({
      $id: "tl-1",
      name: "Team Lead",
      role: "team_lead",
    });

    const { upsertLinkedinAccountAction } = await import(
      "@/app/actions/linkedin"
    );

    await upsertLinkedinAccountAction({
      currentUserId: "admin-1",
      assignedUserId: "tl-1",
      company: "SilverSpace Inc.",
      idName: "TL Main",
      accountType: "main",
      licenseType: "Normal",
      connectionLimit: 20,
    });

    expect(mockCreateDocument).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      expect.any(String),
      expect.objectContaining({
        assignedUserId: "tl-1",
        teamLeadId: "tl-1",
      }),
      expect.any(Array),
    );
  });
});
