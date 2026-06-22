import { buildLeadTargetProgress, isSingleDay, workingDaysInRange } from "@/lib/utils/dashboard-kpi";
import type { Lead, User } from "@/lib/types";

const makeLead = (id: string, ownerId: string): Lead => ({
  $id: id,
  data: "{}",
  status: "New",
  ownerId,
  assignedToId: null,
  branchId: null,
  isClosed: false,
  closedAt: null,
});

const makeUser = (id: string, name: string, role: User["role"] = "agent"): User => ({
  $id: id,
  name,
  email: `${name.toLowerCase()}@test.com`,
  role,
  department: "sales",
  teamLeadId: null,
  branchIds: [],
});

describe("isSingleDay", () => {
  it("returns true when from and to match", () => {
    expect(isSingleDay({ from: "2026-06-22", to: "2026-06-22" })).toBe(true);
  });

  it("returns false when they differ", () => {
    expect(isSingleDay({ from: "2026-06-01", to: "2026-06-30" })).toBe(false);
  });

  it("returns false when only one bound is set", () => {
    expect(isSingleDay({ from: "2026-06-22" })).toBe(false);
    expect(isSingleDay({ to: "2026-06-22" })).toBe(false);
  });
});

describe("workingDaysInRange", () => {
  it("counts Monday-Friday only for a multi-day range", () => {
    // Mon 2026-06-22 → Fri 2026-06-26 is 5 working days.
    expect(workingDaysInRange("2026-06-22", "2026-06-26")).toBe(5);
  });

  it("returns 1 for a single weekday", () => {
    expect(workingDaysInRange("2026-06-22", "2026-06-22")).toBe(1);
  });

  it("returns 0 for a single weekend day", () => {
    // 2026-06-20 is a Saturday.
    expect(workingDaysInRange("2026-06-20", "2026-06-20")).toBe(0);
  });

  it("returns 22 working days for June 2026 (31 calendar days)", () => {
    expect(workingDaysInRange("2026-06-01", "2026-06-30")).toBe(22);
  });

  it("returns 21 working days for May 2026 (31 calendar days)", () => {
    expect(workingDaysInRange("2026-05-01", "2026-05-31")).toBe(21);
  });

  it("returns 20 working days for a 28-day February in 2025", () => {
    // 2025 is not a leap year; Feb 1 is a Saturday.
    // Working days: 3,4,5,6,7 (5), 10-14 (5), 17-21 (5), 24-28 (5) = 20
    expect(workingDaysInRange("2025-02-01", "2025-02-28")).toBe(20);
  });

  it("returns 21 working days for a 29-day February in 2024", () => {
    // 2024 is a leap year; Feb 1 is a Thursday.
    // Working days: 1,2 (Thu,Fri) = 2, 5-9 (5), 12-16 (5), 19-23 (5), 26-29 (Thu,Fri) = 4 → 21
    expect(workingDaysInRange("2024-02-01", "2024-02-29")).toBe(21);
  });

  it("handles a range that spans two months", () => {
    // 2026-04-15 (Wed) → 2026-05-10 (Sun)
    // April 15-30: 15-17 (3), 20-24 (5), 27-30 (4) = 12
    // May 1-10: 1 (Fri), 4-8 (5) = 6
    // Total = 18
    expect(workingDaysInRange("2026-04-15", "2026-05-10")).toBe(18);
  });

  it("returns 0 when to is before from", () => {
    expect(workingDaysInRange("2026-06-10", "2026-06-01")).toBe(0);
  });
});

describe("buildLeadTargetProgress", () => {
  it("returns daily mode with target=1 for a single-day range", () => {
    const users = [makeUser("u1", "Alice"), makeUser("u2", "Bob")];
    const leads = [makeLead("l1", "u1")];
    const rows = buildLeadTargetProgress({
      leads,
      users,
      range: { from: "2026-06-22", to: "2026-06-22" },
    });
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.target).toBe(1);
      expect(row.mode).toBe("daily");
    }
    expect(rows.find((r) => r.userId === "u1")?.leadCount).toBe(1);
    expect(rows.find((r) => r.userId === "u2")?.leadCount).toBe(0);
  });

  it("returns monthly mode with working-days-in-range as the target", () => {
    // 2026-06-22 (Mon) → 2026-06-30 (Tue): 22,23,24,25,26,29,30 = 7 working days
    const users = [makeUser("u1", "Alice")];
    const rows = buildLeadTargetProgress({
      leads: [],
      users,
      range: { from: "2026-06-22", to: "2026-06-30" },
    });
    expect(rows[0].mode).toBe("monthly");
    expect(rows[0].target).toBe(7);
  });

  it("counts working days for a full-month range (June 2026 = 22)", () => {
    const users = [makeUser("u1", "Alice")];
    const rows = buildLeadTargetProgress({
      leads: [],
      users,
      range: { from: "2026-06-01", to: "2026-06-30" },
    });
    expect(rows[0].mode).toBe("monthly");
    expect(rows[0].target).toBe(22);
  });

  it("uses the working days within the multi-month range", () => {
    // 2026-04-15 → 2026-05-10 = 18 working days
    const users = [makeUser("u1", "Alice")];
    const rows = buildLeadTargetProgress({
      leads: [],
      users,
      range: { from: "2026-04-15", to: "2026-05-10" },
    });
    expect(rows[0].target).toBe(18);
  });

  it("handles February correctly (20 working days in 2025, 21 in 2024)", () => {
    const rows2025 = buildLeadTargetProgress({
      leads: [],
      users: [makeUser("u1", "Alice")],
      range: { from: "2025-02-01", to: "2025-02-28" },
    });
    expect(rows2025[0].target).toBe(20);

    const rows2024 = buildLeadTargetProgress({
      leads: [],
      users: [makeUser("u1", "Alice")],
      range: { from: "2024-02-01", to: "2024-02-29" },
    });
    expect(rows2024[0].target).toBe(21);
  });

  it("sorts underperformers first, then by largest gap", () => {
    const users = [
      makeUser("u1", "Alice"),
      makeUser("u2", "Bob"),
      makeUser("u3", "Carol"),
    ];
    // 3 leads for u1, 1 for u2, 0 for u3
    const leads = [
      makeLead("l1", "u1"),
      makeLead("l2", "u1"),
      makeLead("l3", "u1"),
      makeLead("l4", "u2"),
    ];
    const rows = buildLeadTargetProgress({
      leads,
      users,
      range: { from: "2026-06-01", to: "2026-06-30" },
    });
    // Sorted: underperformers first (u3 with 0, u2 with 1), then u1 with 3 met
    expect(rows.map((r) => r.userId)).toEqual(["u3", "u2", "u1"]);
  });

  it("ignores leads not owned by any user in the list", () => {
    const users = [makeUser("u1", "Alice")];
    const leads = [makeLead("l1", "u1"), makeLead("l2", "stranger")];
    const rows = buildLeadTargetProgress({
      leads,
      users,
      range: { from: "2026-06-22", to: "2026-06-22" },
    });
    expect(rows[0].leadCount).toBe(1);
  });

  it("includes team_lead users in the KPI roster and counts their leads", () => {
    // resolveScopeUsers now returns both agents and team leads; verify
    // buildLeadTargetProgress handles a mixed roster without dropping
    // the TL or their leads.
    const users = [makeUser("u1", "Alice", "agent"), makeUser("u2", "Bob", "team_lead")];
    const leads = [
      makeLead("l1", "u1"),
      makeLead("l2", "u2"),
      makeLead("l3", "u2"),
    ];
    const rows = buildLeadTargetProgress({
      leads,
      users,
      range: { from: "2026-06-22", to: "2026-06-22" },
    });
    expect(rows).toHaveLength(2);
    const alice = rows.find((r) => r.userId === "u1");
    const bob = rows.find((r) => r.userId === "u2");
    expect(alice?.userRole).toBe("agent");
    expect(alice?.leadCount).toBe(1);
    expect(bob?.userRole).toBe("team_lead");
    expect(bob?.leadCount).toBe(2);
  });

  it("counts closed leads toward the daily KPI", () => {
    // Closed leads are still work done in the day, so they should be
    // counted by buildLeadTargetProgress. The dashboard's lead query
    // is responsible for including both open and closed leads.
    const users = [makeUser("u1", "Alice")];
    const leads = [
      { ...makeLead("l1", "u1"), isClosed: false },
      { ...makeLead("l2", "u1"), isClosed: true },
      { ...makeLead("l3", "u1"), isClosed: true },
    ];
    const rows = buildLeadTargetProgress({
      leads,
      users,
      range: { from: "2026-06-22", to: "2026-06-22" },
    });
    expect(rows[0].leadCount).toBe(3);
  });
});
