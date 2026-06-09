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
  Query: {
    equal: jest.fn((key, value) => `equal:${key}:${JSON.stringify(value)}`),
    greaterThanEqual: jest.fn((key, value) => `gte:${key}:${JSON.stringify(value)}`),
    lessThanEqual: jest.fn((key, value) => `lte:${key}:${JSON.stringify(value)}`),
    limit: jest.fn((limit) => `limit:${limit}`),
    orderAsc: jest.fn((key) => `orderAsc:${key}`),
    orderDesc: jest.fn((key) => `orderDesc:${key}`),
    cursorAfter: jest.fn((value) => `cursorAfter:${value}`),
  },
  ID: {
    unique: jest.fn(() => "unique-id"),
  },
  Permission: {
    read: jest.fn((role) => `read:${role}`),
    update: jest.fn((role) => `update:${role}`),
  },
  Role: {
    label: jest.fn((label) => `label:${label}`),
  },
}));

describe("Linkedin reports team lead scoping", () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    mockAssertAuthenticatedUserId.mockResolvedValue({ $id: "tl-1" });
    mockGetAuthenticatedUserDoc.mockResolvedValue({
      $id: "tl-1",
      name: "Team Lead",
      role: "team_lead",
    });
    mockCreateAdminClient.mockResolvedValue({
      databases: {
        listDocuments: mockListDocuments,
      },
    });
  });

  it("scopes weekly report queries to the current team lead when teamLeadId is null", async () => {
    mockListDocuments.mockResolvedValue({
      documents: [],
      total: 0,
    });

    const { getLinkedinWeeklyReportAction } = await import(
      "@/app/actions/linkedin"
    );

    await expect(
      getLinkedinWeeklyReportAction({
        currentUserId: "tl-1",
        teamLeadId: null,
        startDate: "2026-06-03",
        endDate: "2026-06-09",
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        rows: [],
      }),
    );

    expect(mockListDocuments).toHaveBeenCalledWith(
      expect.any(String),
      "linkedin_requests",
      expect.arrayContaining([`equal:teamLeadId:"tl-1"`]),
    );
  });

  it("scopes request list queries to the current team lead when teamLeadId is null", async () => {
    mockListDocuments.mockResolvedValue({
      documents: [],
      total: 0,
    });

    const { listLinkedinRequestsForAdminAction } = await import(
      "@/app/actions/linkedin"
    );

    await expect(
      listLinkedinRequestsForAdminAction({
        currentUserId: "tl-1",
        teamLeadId: null,
        startDate: "2026-06-03",
        endDate: "2026-06-09",
      }),
    ).resolves.toEqual([]);

    expect(mockListDocuments).toHaveBeenCalledWith(
      expect.any(String),
      "linkedin_requests",
      expect.arrayContaining([`equal:teamLeadId:"tl-1"`]),
    );
  });
});
