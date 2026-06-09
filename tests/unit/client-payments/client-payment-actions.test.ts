export {};

const mockAssertAuthenticatedUserId = jest.fn();
const mockCreateAdminClient = jest.fn();
const mockGetDocument = jest.fn();
const mockListDocuments = jest.fn();
const mockCreateDocument = jest.fn();
const mockUpdateDocument = jest.fn();

jest.mock("@/lib/server/current-user", () => ({
  assertAuthenticatedUserId: (...args: unknown[]) =>
    mockAssertAuthenticatedUserId(...args),
}));

jest.mock("@/lib/server/appwrite", () => ({
  createAdminClient: () => mockCreateAdminClient(),
}));

jest.mock("@/lib/constants/special-lead-access", () => ({
  getSpecialBranchLeadAccess: jest.fn(() => null),
}));

jest.mock("node-appwrite", () => ({
  ID: {
    unique: jest.fn(() => "unique-id"),
  },
  Query: {
    equal: jest.fn((key, value) => `equal:${key}:${JSON.stringify(value)}`),
    limit: jest.fn((limit) => `limit:${limit}`),
    or: jest.fn((conditions) => `or:${conditions.join("|")}`),
  },
}));

describe("client payment action authorization", () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    mockGetDocument.mockReset();
    mockListDocuments.mockReset();
    mockCreateDocument.mockReset();
    mockUpdateDocument.mockReset();
    mockCreateAdminClient.mockReset();
    mockAssertAuthenticatedUserId.mockReset();
    process.env.NEXT_PUBLIC_APPWRITE_DATABASE_ID = "database";
    process.env.NEXT_PUBLIC_APPWRITE_USERS_COLLECTION_ID = "users";
    process.env.NEXT_PUBLIC_APPWRITE_LEADS_COLLECTION_ID = "leads";
    process.env.NEXT_PUBLIC_APPWRITE_CLIENT_PAYMENTS_COLLECTION_ID = "payments";

    mockAssertAuthenticatedUserId.mockResolvedValue({ $id: "monitor-1" });
    mockCreateAdminClient.mockResolvedValue({
      databases: {
        getDocument: mockGetDocument,
        listDocuments: mockListDocuments,
        createDocument: mockCreateDocument,
        updateDocument: mockUpdateDocument,
      },
    });
  });

  it("allows monitor to read any client payment record", async () => {
    mockGetDocument
      .mockResolvedValueOnce({
        $id: "monitor-1",
        name: "Monitor",
        email: "monitor@example.com",
        role: "monitor",
        branchIds: [],
      })
      .mockResolvedValueOnce({
        $id: "lead-1",
        ownerId: "owner-1",
        assignedToId: "agent-1",
        branchId: "branch-9",
      });
    mockListDocuments.mockResolvedValueOnce({
      documents: [
        {
          $id: "payment-1",
          leadId: "lead-1",
          personalDetails: "{}",
          paymentPlan: JSON.stringify({
            percent: 20,
            months: 4,
            upfrontAmount: 1000,
          }),
          updates: "[]",
          status: "partially_paid",
          createdAt: "2026-06-01T00:00:00.000Z",
        },
      ],
    });

    const { getClientPaymentRecordAction } = await import(
      "@/app/actions/client-payments"
    );

    await expect(
      getClientPaymentRecordAction("monitor-1", "lead-1"),
    ).resolves.toMatchObject({
      $id: "payment-1",
      leadId: "lead-1",
      status: "partially_paid",
    });
  });

  it("rejects monitor client payment mutations", async () => {
    mockGetDocument
      .mockResolvedValueOnce({
        $id: "monitor-1",
        name: "Monitor",
        email: "monitor@example.com",
        role: "monitor",
        branchIds: [],
      })
      .mockResolvedValueOnce({
        $id: "lead-1",
        ownerId: "owner-1",
        assignedToId: "agent-1",
        branchId: "branch-9",
      });

    const { addClientPaymentUpdateAction } = await import(
      "@/app/actions/client-payments"
    );

    await expect(
      addClientPaymentUpdateAction({
        actorId: "monitor-1",
        leadId: "lead-1",
        status: "fully_paid",
        note: "Paid",
      }),
    ).rejects.toThrow("Not authorized");

    expect(mockUpdateDocument).not.toHaveBeenCalled();
    expect(mockCreateDocument).not.toHaveBeenCalled();
  });

  it("allows operations to read any client payment record", async () => {
    mockGetDocument
      .mockResolvedValueOnce({
        $id: "operations-1",
        name: "Operations",
        email: "operations@example.com",
        role: "operations",
        branchIds: [],
      })
      .mockResolvedValueOnce({
        $id: "lead-1",
        ownerId: "owner-1",
        assignedToId: "agent-1",
        branchId: "branch-9",
      });
    mockListDocuments.mockResolvedValueOnce({
      documents: [
        {
          $id: "payment-1",
          leadId: "lead-1",
          personalDetails: "{}",
          paymentPlan: JSON.stringify({
            percent: 20,
            months: 4,
            upfrontAmount: 1000,
          }),
          updates: "[]",
          status: "partially_paid",
          createdAt: "2026-06-01T00:00:00.000Z",
        },
      ],
    });

    const { getClientPaymentRecordAction } = await import(
      "@/app/actions/client-payments"
    );

    await expect(
      getClientPaymentRecordAction("operations-1", "lead-1"),
    ).resolves.toMatchObject({
      $id: "payment-1",
      leadId: "lead-1",
      status: "partially_paid",
    });
  });

  it("rejects operations client payment mutations", async () => {
    mockGetDocument
      .mockResolvedValueOnce({
        $id: "operations-1",
        name: "Operations",
        email: "operations@example.com",
        role: "operations",
        branchIds: [],
      })
      .mockResolvedValueOnce({
        $id: "lead-1",
        ownerId: "owner-1",
        assignedToId: "agent-1",
        branchId: "branch-9",
      });

    const { addClientPaymentUpdateAction } = await import(
      "@/app/actions/client-payments"
    );

    await expect(
      addClientPaymentUpdateAction({
        actorId: "operations-1",
        leadId: "lead-1",
        status: "fully_paid",
        note: "Paid",
      }),
    ).rejects.toThrow("Not authorized");

    expect(mockUpdateDocument).not.toHaveBeenCalled();
    expect(mockCreateDocument).not.toHaveBeenCalled();
  });
});
