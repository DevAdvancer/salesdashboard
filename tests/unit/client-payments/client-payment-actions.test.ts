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

describe("client payment amount persistence and report", () => {
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

    mockAssertAuthenticatedUserId.mockResolvedValue({ $id: "admin-1" });
    mockCreateAdminClient.mockResolvedValue({
      databases: {
        getDocument: mockGetDocument,
        listDocuments: mockListDocuments,
        createDocument: mockCreateDocument,
        updateDocument: mockUpdateDocument,
      },
    });
  });

  it("persists amount on addClientPaymentUpdateAction for admin", async () => {
    mockGetDocument
      .mockResolvedValueOnce({
        $id: "admin-1",
        name: "Admin",
        email: "admin@example.com",
        role: "admin",
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
    mockUpdateDocument.mockResolvedValueOnce({
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
    });

    const { addClientPaymentUpdateAction } = await import(
      "@/app/actions/client-payments"
    );

    await expect(
      addClientPaymentUpdateAction({
        actorId: "admin-1",
        leadId: "lead-1",
        status: "partially_paid",
        note: "Paid $500",
        amount: 500,
      }),
    ).resolves.toMatchObject({ $id: "payment-1" });

    expect(mockUpdateDocument).toHaveBeenCalledTimes(1);
    const updateCall = mockUpdateDocument.mock.calls[0];
    // The first call is the database, then collectionId, then documentId, then the data payload
    const payload = updateCall[updateCall.length - 1] as { updates?: string };
    expect(payload.updates).toBeDefined();
    const parsed = JSON.parse(payload.updates!);
    expect(parsed[0]).toMatchObject({ amount: 500, status: "partially_paid" });
  });

  it("sanitizes non-finite amount and persists null", async () => {
    mockGetDocument
      .mockResolvedValueOnce({
        $id: "admin-1",
        name: "Admin",
        email: "admin@example.com",
        role: "admin",
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
    mockUpdateDocument.mockResolvedValueOnce({
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
    });

    const { addClientPaymentUpdateAction } = await import(
      "@/app/actions/client-payments"
    );

    await addClientPaymentUpdateAction({
      actorId: "admin-1",
      leadId: "lead-1",
      status: "partially_paid",
      note: "Paid",
      amount: Number.NaN,
    });

    const updateCall = mockUpdateDocument.mock.calls[0];
    const payload = updateCall[updateCall.length - 1] as { updates?: string };
    const parsed = JSON.parse(payload.updates!);
    expect(parsed[0].amount).toBeNull();
  });

  it("returns report rows with lastUpdate from listPaymentsReportAction", async () => {
    mockGetDocument.mockResolvedValueOnce({
      $id: "admin-1",
      name: "Admin",
      email: "admin@example.com",
      role: "admin",
      branchIds: [],
    });
    // First listDocuments call: client_payments
    mockListDocuments
      .mockResolvedValueOnce({
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
            updates: JSON.stringify([
              {
                id: "u1",
                status: "partially_paid",
                note: "Paid $500",
                actorId: "admin-1",
                actorName: "Admin",
                createdAt: "2026-06-10T00:00:00.000Z",
                amount: 500,
              },
            ]),
            status: "partially_paid",
            $createdAt: "2026-06-01T00:00:00.000Z",
          },
          {
            $id: "payment-2",
            leadId: "lead-2",
            personalDetails: "{}",
            paymentPlan: JSON.stringify({
              percent: 10,
              months: 2,
              upfrontAmount: 200,
            }),
            updates: "[]",
            status: "not_paid",
            $createdAt: "2026-06-02T00:00:00.000Z",
          },
        ],
      })
      // Second listDocuments call: leads
      .mockResolvedValueOnce({
        documents: [
          {
            $id: "lead-1",
            data: JSON.stringify({ company: "Acme" }),
            closedAt: "2026-06-05T00:00:00.000Z",
          },
          {
            $id: "lead-2",
            data: JSON.stringify({ firstName: "Bob", lastName: "Jones" }),
            closedAt: "2026-05-29T00:00:00.000Z",
          },
        ],
      });

    const { listPaymentsReportAction } = await import(
      "@/app/actions/client-payments"
    );

    const rows = await listPaymentsReportAction({ actorId: "admin-1" });
    expect(rows).toHaveLength(2);

    const withUpdate = rows.find((r) => r.$id === "payment-1");
    expect(withUpdate).toBeDefined();
    expect(withUpdate!.company).toBe("Acme");
    expect(withUpdate!.lastUpdate).toMatchObject({
      id: "u1",
      amount: 500,
      note: "Paid $500",
      actorName: "Admin",
    });
    // `totalPaid` is the running sum of every update's `amount` — for this
    // record there's one update carrying 500, so the total is 500.
    expect(withUpdate!.totalPaid).toBe(500);
    expect(withUpdate!.paidUpdateCount).toBe(1);
    expect(withUpdate!.closedAt).toBe("2026-06-05T00:00:00.000Z");

    const withoutUpdate = rows.find((r) => r.$id === "payment-2");
    expect(withoutUpdate).toBeDefined();
    expect(withoutUpdate!.company).toBe("Bob Jones");
    expect(withoutUpdate!.lastUpdate).toBeNull();
    // No updates with amounts → totalPaid is null and count is 0.
    expect(withoutUpdate!.totalPaid).toBeNull();
    expect(withoutUpdate!.paidUpdateCount).toBe(0);
  });

  it("filters payment report rows by lead closedAt date range", async () => {
    mockGetDocument.mockResolvedValueOnce({
      $id: "admin-1",
      name: "Admin",
      email: "admin@example.com",
      role: "admin",
      branchIds: [],
    });

    mockListDocuments
      .mockResolvedValueOnce({
        documents: [
          {
            $id: "payment-1",
            leadId: "lead-1",
            personalDetails: "{}",
            paymentPlan: JSON.stringify({
              percent: 10,
              months: 2,
              upfrontAmount: 500,
            }),
            updates: "[]",
            status: "not_paid",
            $createdAt: "2026-06-10T00:00:00.000Z",
          },
          {
            $id: "payment-2",
            leadId: "lead-2",
            personalDetails: "{}",
            paymentPlan: JSON.stringify({
              percent: 10,
              months: 2,
              upfrontAmount: 300,
            }),
            updates: "[]",
            status: "not_paid",
            $createdAt: "2026-06-11T00:00:00.000Z",
          },
        ],
      })
      .mockResolvedValueOnce({
        documents: [
          {
            $id: "lead-1",
            data: JSON.stringify({ company: "Acme" }),
            closedAt: "2026-06-05T00:00:00.000Z",
          },
          {
            $id: "lead-2",
            data: JSON.stringify({ company: "Bravo" }),
            closedAt: "2026-05-31T00:00:00.000Z",
          },
        ],
      });

    const { listPaymentsReportAction } = await import(
      "@/app/actions/client-payments"
    );

    const rows = await listPaymentsReportAction({
      actorId: "admin-1",
      dateFrom: "2026-06-01",
      dateTo: "2026-06-30",
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]?.leadId).toBe("lead-1");
  });

  it("rejects non-admin read roles from listPaymentsReportAction", async () => {
    mockGetDocument.mockResolvedValueOnce({
      $id: "agent-1",
      name: "Agent",
      email: "agent@example.com",
      role: "agent",
      branchIds: [],
    });

    const { listPaymentsReportAction } = await import(
      "@/app/actions/client-payments"
    );

    await expect(listPaymentsReportAction({ actorId: "agent-1" })).rejects.toThrow(
      "Not authorized"
    );
    expect(mockListDocuments).not.toHaveBeenCalled();
  });
});
