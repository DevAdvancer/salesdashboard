export {};

const mockAssertAuthenticatedUserId = jest.fn();
const mockGetAuthenticatedUserDoc = jest.fn();
const mockCreateAdminClient = jest.fn();
const mockListDocuments = jest.fn();

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
    orderDesc: jest.fn((key) => `orderDesc:${key}`),
  },
  Role: {
    label: jest.fn((label) => `label:${label}`),
  },
}));

describe("Linkedin request history", () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    mockAssertAuthenticatedUserId.mockResolvedValue({ $id: "agent-1" });
    mockGetAuthenticatedUserDoc.mockResolvedValue({
      $id: "agent-1",
      name: "Agent",
      role: "agent",
    });
    mockCreateAdminClient.mockResolvedValue({
      databases: {
        listDocuments: mockListDocuments,
      },
    });
  });

  it("loads the agent's request history without requiring a selected active account", async () => {
    const inactiveOldRequest = {
      $id: "request-old",
      agentId: "agent-1",
      accountId: "old-account",
      targetUrl: "https://linkedin.com/in/old",
      status: "withdrawn",
      isActive: false,
    };

    mockListDocuments
      .mockResolvedValueOnce({ documents: [], total: 0 })
      .mockResolvedValueOnce({ documents: [inactiveOldRequest], total: 1 });

    const { listMyLinkedinRequestsAction } = await import(
      "@/app/actions/linkedin"
    );

    const result = await listMyLinkedinRequestsAction({
      currentUserId: "agent-1",
      limit: 500,
    });

    expect(result).toEqual([inactiveOldRequest]);
    expect(mockListDocuments).toHaveBeenNthCalledWith(
      2,
      expect.any(String),
      expect.any(String),
      expect.arrayContaining([
        'equal:agentId:["agent-1"]',
        "orderDesc:dateSent",
        "orderDesc:$createdAt",
        "limit:500",
      ]),
    );
  });

  it("includes delegated source users in the history query for the day", async () => {
    mockListDocuments
      .mockResolvedValueOnce({
        documents: [{ userId: "source-agent-1" }, { userId: "source-agent-1" }],
        total: 2,
      })
      .mockResolvedValueOnce({ documents: [], total: 0 });

    const { listMyLinkedinRequestsAction } = await import(
      "@/app/actions/linkedin"
    );

    await listMyLinkedinRequestsAction({
      currentUserId: "agent-1",
      limit: 200,
    });

    expect(mockListDocuments).toHaveBeenNthCalledWith(
      2,
      expect.any(String),
      expect.any(String),
      expect.arrayContaining([
        'equal:agentId:["agent-1","source-agent-1"]',
      ]),
    );
  });
});
