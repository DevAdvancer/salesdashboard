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
    select: jest.fn((attributes) => ({ type: "select", attributes })),
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

  it("filters admin-like assignable users by department scope", async () => {
    const { getAssignableUsers } = await import("@/lib/services/user-service");

    mockListDocuments.mockResolvedValue({
      documents: [
        {
          $id: "sales-tl",
          name: "Sales TL",
          email: "sales@example.com",
          role: "team_lead",
          department: "sales",
          branchIds: [],
          isActive: true,
        },
        {
          $id: "resume-tl",
          name: "Resume TL",
          email: "resume@example.com",
          role: "team_lead",
          department: "resume",
          branchIds: [],
          isActive: true,
        },
      ],
    });

    const users = await getAssignableUsers("admin", [], "admin-1", "sales");

    expect(users.map((user) => user.$id)).toEqual(["sales-tl"]);
  });
});
