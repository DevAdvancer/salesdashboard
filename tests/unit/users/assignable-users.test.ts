const mockListDocuments = jest.fn();

jest.mock("@/lib/appwrite", () => ({
  databases: {
    listDocuments: (...args: unknown[]) => mockListDocuments(...args),
  },
  DATABASE_ID: "database",
}));

jest.mock("appwrite", () => ({
  Query: {
    contains: jest.fn((key, values) => ({ type: "contains", key, values })),
    equal: jest.fn((key, value) => ({ type: "equal", key, value })),
    limit: jest.fn((limit) => ({ type: "limit", limit })),
  },
}));

describe("getAssignableUsers", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockListDocuments.mockResolvedValue({ documents: [] });
  });

  it("does not include Lead Generation users in assign-to options", async () => {
    const { getAssignableUsers } = await import("@/lib/services/user-service");
    const { Query } = await import("appwrite");

    await getAssignableUsers("admin", [], "admin-1");
    await getAssignableUsers("assistant_manager", ["branch-1"], "am-1");
    await getAssignableUsers("team_lead", ["branch-1"], "tl-1");

    expect(Query.equal).toHaveBeenCalledWith("role", expect.arrayContaining(["agent"]));
    expect(Query.equal).not.toHaveBeenCalledWith(
      "role",
      expect.arrayContaining(["lead_generation"]),
    );
  });
});
