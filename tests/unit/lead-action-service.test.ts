import {
  createLeadAction,
  listLeadsAction,
} from "@/app/actions/lead";
import { assignLeadAction, backoutLeadAction } from "@/lib/actions/lead-actions";
import {
  assignLead,
  backoutLead,
  clearLeadReadCache,
  createLead,
  listLeads,
} from "@/lib/services/lead-action-service";
import { clearClientReadCache } from "@/lib/utils/client-read-cache";

jest.mock("@/app/actions/lead", () => ({
  createLeadAction: jest.fn(),
  listLeadsAction: jest.fn(),
  reopenLeadAction: jest.fn(),
}));

jest.mock("@/lib/actions/lead-actions", () => ({
  assignLeadAction: jest.fn(),
  backoutLeadAction: jest.fn(),
}));

describe("lead action service", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    clearClientReadCache();
  });

  it("caches equivalent lead list reads behind one server action call", async () => {
    // listLeadsAction returns { leads, total, page, pageSize } — the
    // service unwraps the `leads` field, so the mock must return that
    // envelope shape, not the array directly.
    const leads = [{ $id: "lead-1" }];
    (listLeadsAction as jest.Mock).mockResolvedValue({
      leads,
      total: 1,
      page: 1,
      pageSize: 10000,
    });

    const first = await listLeads(
      { status: "New", isClosed: false },
      "user-1",
      "admin",
      ["branch-1"]
    );
    const second = await listLeads(
      { isClosed: false, status: "New" },
      "user-1",
      "admin",
      ["branch-1"]
    );

    expect(first).toBe(leads);
    expect(second).toBe(leads);
    expect(listLeadsAction).toHaveBeenCalledTimes(1);
  });

  it("clears cached lead reads after creating a lead", async () => {
    (listLeadsAction as jest.Mock)
      .mockResolvedValueOnce({
        leads: [{ $id: "old-lead" }],
        total: 1,
        page: 1,
        pageSize: 10000,
      })
      .mockResolvedValueOnce({
        leads: [{ $id: "new-lead" }],
        total: 1,
        page: 1,
        pageSize: 10000,
      });
    (createLeadAction as jest.Mock).mockResolvedValue({ $id: "new-lead" } as any);

    await listLeads({ isClosed: false }, "user-1", "admin", []);
    await createLead("user-1", { data: {}, status: "New" }, "user-1", "A");
    const refreshed = await listLeads({ isClosed: false }, "user-1", "admin", []);

    expect(refreshed).toEqual([{ $id: "new-lead" }]);
    expect(listLeadsAction).toHaveBeenCalledTimes(2);
  });

  it("clears cached lead reads after assignment and backout mutations", async () => {
    (listLeadsAction as jest.Mock)
      .mockResolvedValueOnce({
        leads: [{ $id: "before" }],
        total: 1,
        page: 1,
        pageSize: 10000,
      })
      .mockResolvedValueOnce({
        leads: [{ $id: "assigned" }],
        total: 1,
        page: 1,
        pageSize: 10000,
      })
      .mockResolvedValueOnce({
        leads: [{ $id: "backout" }],
        total: 1,
        page: 1,
        pageSize: 10000,
      });
    (assignLeadAction as jest.Mock).mockResolvedValue({
      success: true,
      lead: { $id: "assigned" },
    } as any);
    (backoutLeadAction as jest.Mock).mockResolvedValue({
      success: true,
      lead: { $id: "backout" },
    } as any);

    await listLeads({ isClosed: false }, "user-1", "admin", []);
    await assignLead("lead-1", "agent-1", "user-1", "A");
    await listLeads({ isClosed: false }, "user-1", "admin", []);
    await backoutLead("lead-1", "user-1", "A");
    await listLeads({ isClosed: false }, "user-1", "admin", []);

    expect(listLeadsAction).toHaveBeenCalledTimes(3);
  });

  it("allows direct lead cache invalidation", async () => {
    (listLeadsAction as jest.Mock)
      .mockResolvedValueOnce({
        leads: [{ $id: "before" }],
        total: 1,
        page: 1,
        pageSize: 10000,
      })
      .mockResolvedValueOnce({
        leads: [{ $id: "after" }],
        total: 1,
        page: 1,
        pageSize: 10000,
      });

    await listLeads({ isClosed: false }, "user-1", "admin", []);
    clearLeadReadCache();
    await listLeads({ isClosed: false }, "user-1", "admin", []);

    expect(listLeadsAction).toHaveBeenCalledTimes(2);
  });
});
