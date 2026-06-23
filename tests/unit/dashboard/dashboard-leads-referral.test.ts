import type { Lead } from "@/lib/types";
import {
  filterClosedLeadsInDateRange,
  splitLeadsByReferral,
  splitPaymentInsightsByReferral,
} from "@/lib/utils/dashboard-referral";

const makeLead = (overrides: Partial<Lead>): Lead => ({
  $id: "lead-1",
  $createdAt: "2026-06-15T10:00:00.000Z",
  $updatedAt: "2026-06-15T10:00:00.000Z",
  name: "John Doe",
  email: "john@example.com",
  phone: "555-1234",
  source: "",
  status: "active",
  // Default to closed — the dashboard referral section only counts
  // closed leads, so most tests are exercising closed leads.
  isClosed: true,
  ownerId: "user-1",
  assignedToId: undefined,
  branchId: "branch-1",
  data: "{}",
  ...overrides,
});

describe("splitLeadsByReferral", () => {
  it("classifies a lead with source='Referral' as referral", () => {
    const result = splitLeadsByReferral([
      makeLead({
        $id: "l1",
        data: JSON.stringify({ source: "Referral", leadAmount: 5000 }),
      }),
    ]);
    expect(result.referral.count).toBe(1);
    expect(result.nonReferral.count).toBe(0);
  });

  it("normalizes source to lowercase stripped of non-alphanumeric characters", () => {
    // "REFERRAL" -> "referral" (match). "Referral Form" -> "referralform" (no match).
    const result = splitLeadsByReferral([
      makeLead({ $id: "a", data: JSON.stringify({ source: "REFERRAL", leadAmount: 100 }) }),
      makeLead({ $id: "b", data: JSON.stringify({ source: "Referral Form", leadAmount: 200 }) }),
      makeLead({ $id: "c", data: JSON.stringify({ source: "  Referral  ", leadAmount: 300 }) }),
    ]);
    expect(result.referral.count).toBe(2); // a and c
    expect(result.nonReferral.count).toBe(1); // b
    expect(result.referral.totalAmount).toBeCloseTo(400); // 100 + 300
    expect(result.nonReferral.totalAmount).toBeCloseTo(200);
  });

  it("classifies non-referral sources and missing source as non-referral", () => {
    const result = splitLeadsByReferral([
      makeLead({ $id: "a", data: JSON.stringify({ source: "Walk-in", leadAmount: 1000 }) }),
      makeLead({ $id: "b", data: JSON.stringify({ leadAmount: 2000 }) }),
      makeLead({ $id: "c", data: "{}" }),
    ]);
    expect(result.nonReferral.count).toBe(3);
    expect(result.nonReferral.totalAmount).toBeCloseTo(3000);
    expect(result.referral.count).toBe(0);
  });

  it("falls back to totalAmount and amount when leadAmount is missing", () => {
    const result = splitLeadsByReferral([
      makeLead({ $id: "a", data: JSON.stringify({ totalAmount: 750 }) }),
      makeLead({ $id: "b", data: JSON.stringify({ amount: 250 }) }),
    ]);
    expect(result.nonReferral.totalAmount).toBeCloseTo(1000);
  });

  it("uses the lead amount for referral leads even when bonusAmount exists", () => {
    const result = splitLeadsByReferral([
      makeLead({
        $id: "r1",
        data: JSON.stringify({ source: "Referral", leadAmount: 5000, bonusAmount: 250 }),
      }),
    ]);
    expect(result.referral.totalAmount).toBeCloseTo(5000);
  });

  it("falls back to leadAmount when payment data is unavailable", () => {
    const result = splitLeadsByReferral([
      makeLead({
        $id: "r1",
        data: JSON.stringify({ source: "Referral", leadAmount: 4000 }),
      }),
    ]);
    expect(result.referral.totalAmount).toBeCloseTo(4000);
  });

  it("falls back to amount when leadAmount/totalAmount are missing", () => {
    const result = splitLeadsByReferral([
      makeLead({
        $id: "r1",
        data: JSON.stringify({ source: "Referral", amount: 1500, bonusAmount: 0 }),
      }),
    ]);
    expect(result.referral.totalAmount).toBeCloseTo(1500);
  });

  it("only counts closed leads (open leads are excluded from both buckets)", () => {
    const result = splitLeadsByReferral([
      makeLead({ $id: "a", isClosed: true, data: JSON.stringify({ leadAmount: 100 }) }),
      makeLead({ $id: "b", isClosed: false, data: JSON.stringify({ leadAmount: 200 }) }),
    ]);
    expect(result.nonReferral.count).toBe(1);
    expect(result.nonReferral.totalAmount).toBeCloseTo(100);
    expect(result.referral.count).toBe(0);
  });

  it("excludes Backed Out and Not Interested leads from the client/referral split", () => {
    const result = splitLeadsByReferral([
      makeLead({ $id: "a", isClosed: true, status: "Backed Out", data: JSON.stringify({ leadAmount: 100 }) }),
      makeLead({ $id: "b", isClosed: true, status: "Not Interested", data: JSON.stringify({ source: "Referral", leadAmount: 200 }) }),
      makeLead({ $id: "c", isClosed: true, status: "Signed/Closure", data: JSON.stringify({ source: "Referral", leadAmount: 300 }) }),
    ]);

    expect(result).toEqual({
      nonReferral: {
        count: 0,
        totalAmount: 0,
        fullyPaidAmount: 0,
        partiallyPaidAmount: 0,
      },
      referral: {
        count: 1,
        totalAmount: 300,
        fullyPaidAmount: 0,
        partiallyPaidAmount: 300,
      },
    });
  });

  it("uses paid amount when upfront data is unavailable", () => {
    const paid = new Map<string, number>([
      ["a", 999],
      ["r1", 250],
    ]);
    const result = splitLeadsByReferral(
      [
        makeLead({ $id: "a", isClosed: true, data: JSON.stringify({ leadAmount: 100 }) }),
        makeLead({ $id: "r1", isClosed: true, data: JSON.stringify({ source: "Referral", leadAmount: 500, bonusAmount: 200 }) }),
      ],
      paid,
    );
    // Non-referral: paid 999 overrides planned leadAmount 100.
    expect(result.nonReferral.totalAmount).toBeCloseTo(999);
    // Referral: paid amount is used when there is no upfront amount.
    expect(result.referral.totalAmount).toBeCloseTo(250);
  });

  it("falls back to lead amount when paidByLeadId has no entry for the lead", () => {
    const paid = new Map<string, number>([["other", 999]]);
    const result = splitLeadsByReferral(
      [makeLead({ $id: "a", isClosed: true, data: JSON.stringify({ leadAmount: 150 }) })],
      paid,
    );
    expect(result.nonReferral.totalAmount).toBeCloseTo(150);
  });

  it("uses payment upfront amount before lead data", () => {
    const result = splitLeadsByReferral(
      [
        makeLead({
          $id: "a",
          isClosed: true,
          data: JSON.stringify({ leadAmount: 1500 }),
        }),
      ],
      new Map(),
      new Map([["a", 600]]),
    );
    expect(result.nonReferral.totalAmount).toBeCloseTo(600);
  });

  it("prefers payment upfront amount over paid totals for the referral split", () => {
    const result = splitLeadsByReferral(
      [
        makeLead({
          $id: "a",
          isClosed: true,
          data: JSON.stringify({ source: "Referral", leadAmount: 1500 }),
        }),
      ],
      new Map([["a", 400]]),
      new Map([["a", 900]]),
      new Map([["a", "fully_paid"]]),
    );

    expect(result.referral.totalAmount).toBeCloseTo(900);
    expect(result.referral.fullyPaidAmount).toBeCloseTo(900);
    expect(result.referral.partiallyPaidAmount).toBeCloseTo(0);
  });

  it("tracks fully paid and partially paid amounts separately", () => {
    const result = splitLeadsByReferral(
      [
        makeLead({
          $id: "full",
          data: JSON.stringify({ source: "Referral", leadAmount: 1000 }),
        }),
        makeLead({
          $id: "partial",
          data: JSON.stringify({ source: "Referral", leadAmount: 800 }),
        }),
      ],
      new Map([
        ["full", 700],
        ["partial", 250],
      ]),
      new Map([
        ["full", 1000],
        ["partial", 800],
      ]),
      new Map([
        ["full", "fully_paid"],
        ["partial", "partially_paid"],
      ]),
    );

    expect(result.referral.totalAmount).toBeCloseTo(1800);
    expect(result.referral.fullyPaidAmount).toBeCloseTo(1000);
    expect(result.referral.partiallyPaidAmount).toBeCloseTo(800);
  });

  it("does not crash on malformed data JSON", () => {
    const result = splitLeadsByReferral([
      makeLead({ data: "not json" }),
    ]);
    expect(result.nonReferral.count).toBe(1);
    expect(result.nonReferral.totalAmount).toBe(0);
  });

  it("returns zeros for an empty list", () => {
    expect(splitLeadsByReferral([])).toEqual({
      nonReferral: {
        count: 0,
        totalAmount: 0,
        fullyPaidAmount: 0,
        partiallyPaidAmount: 0,
      },
      referral: {
        count: 0,
        totalAmount: 0,
        fullyPaidAmount: 0,
        partiallyPaidAmount: 0,
      },
    });
  });

  it("sums multiple non-referral and referral amounts correctly", () => {
    const result = splitLeadsByReferral([
      makeLead({ $id: "n1", data: JSON.stringify({ leadAmount: 1000 }) }),
      makeLead({ $id: "n2", data: JSON.stringify({ leadAmount: 2500 }) }),
      makeLead({ $id: "r1", data: JSON.stringify({ source: "Referral", leadAmount: 3000 }) }),
      makeLead({ $id: "r2", data: JSON.stringify({ source: "Referral", bonusAmount: 200 }) }),
    ]);
    expect(result.nonReferral.count).toBe(2);
    expect(result.nonReferral.totalAmount).toBeCloseTo(3500);
    expect(result.referral.count).toBe(2);
    // r2 contributes 0 because bonusAmount is not revenue for the split.
    expect(result.referral.totalAmount).toBeCloseTo(3000);
  });
});

describe("splitPaymentInsightsByReferral", () => {
  it("uses upfront amounts from payment records for the monthly split", () => {
    const result = splitPaymentInsightsByReferral(
      [
        {
          leadId: "ref-1",
          source: "Referral",
          leadStatus: "Signed/Closure",
          isClosed: true,
          closedAt: "2026-06-10T12:00:00.000Z",
          upfrontAmount: 2500,
          createdAt: "2026-06-01T09:00:00.000Z",
          totalPaid: 700,
          status: "partially_paid",
        },
        {
          leadId: "non-1",
          source: "Walk-in",
          leadStatus: "Signed/Closure",
          isClosed: true,
          closedAt: "2026-06-11T12:00:00.000Z",
          upfrontAmount: 1800,
          createdAt: "2026-06-02T09:00:00.000Z",
          totalPaid: null,
          status: "fully_paid",
        },
      ],
      "2026-06-01",
      "2026-06-30",
    );

    expect(result).toEqual({
      referral: {
        count: 1,
        totalAmount: 700,
        fullyPaidAmount: 0,
        partiallyPaidAmount: 700,
      },
      nonReferral: {
        count: 1,
        totalAmount: 1800,
        fullyPaidAmount: 1800,
        partiallyPaidAmount: 0,
      },
    });
  });

  it("counts payment records even when lead metadata would otherwise exclude them", () => {
    const result = splitPaymentInsightsByReferral(
      [
        {
          leadId: "backed-out",
          source: "Referral",
          leadStatus: "Backed Out",
          isClosed: false,
          closedAt: null,
          upfrontAmount: 2500,
          createdAt: "2026-06-10T12:00:00.000Z",
          totalPaid: 1200,
          status: "partially_paid",
        },
        {
          leadId: "not-interested",
          source: "Referral",
          leadStatus: "Not-Interested",
          isClosed: false,
          closedAt: null,
          upfrontAmount: 1800,
          createdAt: "2026-06-11T12:00:00.000Z",
          totalPaid: null,
          status: "fully_paid",
        },
        {
          leadId: "prev-month",
          source: "Referral",
          leadStatus: "Signed/Closure",
          isClosed: true,
          closedAt: "2026-05-30T12:00:00.000Z",
          upfrontAmount: 3200,
          createdAt: "2026-05-30T12:00:00.000Z",
          totalPaid: 3200,
          status: "fully_paid",
        },
      ],
      "2026-06-01",
      "2026-06-30",
    );

    expect(result).toEqual({
      referral: {
        count: 2,
        totalAmount: 3000,
        fullyPaidAmount: 1800,
        partiallyPaidAmount: 1200,
      },
      nonReferral: {
        count: 0,
        totalAmount: 0,
        fullyPaidAmount: 0,
        partiallyPaidAmount: 0,
      },
    });
  });

  it("falls back to payment createdAt when closedAt is missing", () => {
    const result = splitPaymentInsightsByReferral(
      [
        {
          leadId: "ref-1",
          source: "Referral",
          leadStatus: "",
          isClosed: false,
          closedAt: null,
          upfrontAmount: 999,
          createdAt: "2026-06-12T12:00:00.000Z",
          totalPaid: 450,
          status: "partially_paid",
        },
      ],
      "2026-06-01",
      "2026-06-30",
    );

    expect(result).toEqual({
      referral: {
        count: 1,
        totalAmount: 450,
        fullyPaidAmount: 0,
        partiallyPaidAmount: 450,
      },
      nonReferral: {
        count: 0,
        totalAmount: 0,
        fullyPaidAmount: 0,
        partiallyPaidAmount: 0,
      },
    });
  });

  it("uses zero paid amount when a payment record has no paid updates yet", () => {
    const result = splitPaymentInsightsByReferral(
      [
        {
          leadId: "non-1",
          source: "Walk-in",
          leadStatus: "",
          isClosed: false,
          closedAt: null,
          upfrontAmount: 1800,
          createdAt: "2026-06-12T12:00:00.000Z",
          totalPaid: null,
          status: "not_paid",
        },
      ],
      "2026-06-01",
      "2026-06-30",
    );

    expect(result).toEqual({
      referral: {
        count: 0,
        totalAmount: 0,
        fullyPaidAmount: 0,
        partiallyPaidAmount: 0,
      },
      nonReferral: {
        count: 1,
        totalAmount: 0,
        fullyPaidAmount: 0,
        partiallyPaidAmount: 0,
      },
    });
  });

  it("treats fully paid records without amount updates as paid by upfront amount", () => {
    const result = splitPaymentInsightsByReferral(
      [
        {
          leadId: "ref-1",
          source: "Referral",
          leadStatus: "",
          isClosed: false,
          closedAt: null,
          upfrontAmount: 2400,
          createdAt: "2026-06-15T12:00:00.000Z",
          totalPaid: null,
          status: "fully_paid",
        },
      ],
      "2026-06-01",
      "2026-06-30",
    );

    expect(result).toEqual({
      referral: {
        count: 1,
        totalAmount: 2400,
        fullyPaidAmount: 2400,
        partiallyPaidAmount: 0,
      },
      nonReferral: {
        count: 0,
        totalAmount: 0,
        fullyPaidAmount: 0,
        partiallyPaidAmount: 0,
      },
    });
  });
});

describe("filterClosedLeadsInDateRange", () => {
  it("keeps only leads closed inside the requested date window", () => {
    const result = filterClosedLeadsInDateRange(
      [
        makeLead({
          $id: "june-closed",
          $createdAt: "2026-05-28T10:00:00.000Z",
          closedAt: "2026-06-03T12:00:00.000Z",
        }),
        makeLead({
          $id: "may-closed",
          $createdAt: "2026-06-01T10:00:00.000Z",
          closedAt: "2026-05-31T23:00:00.000Z",
        }),
        makeLead({
          $id: "open",
          isClosed: false,
          closedAt: null,
        }),
      ],
      "2026-06-01",
      "2026-06-30",
    );

    expect(result.map((lead) => lead.$id)).toEqual(["june-closed"]);
  });

  it("accepts ISO timestamps for the range bounds", () => {
    const result = filterClosedLeadsInDateRange(
      [
        makeLead({
          $id: "match",
          closedAt: "2026-06-15T12:00:00.000Z",
        }),
      ],
      "2026-06-01T00:00:00.000Z",
      "2026-06-30T23:59:59.999Z",
    );

    expect(result.map((lead) => lead.$id)).toEqual(["match"]);
  });
});
