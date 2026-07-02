import { buildMonthlyPaymentsChartData } from "@/components/dashboard/payments-section";

describe("buildMonthlyPaymentsChartData", () => {
  it("groups paid amounts by client closedAt instead of payment record createdAt", () => {
    const result = buildMonthlyPaymentsChartData([
      {
        closedAt: "2026-05-28T12:00:00.000Z",
        totalPaid: 1200,
        status: "partially_paid" as const,
        upfrontAmount: 2500,
        pendingTotal: null,
      },
      {
        closedAt: "2026-06-02T12:00:00.000Z",
        totalPaid: null,
        status: "fully_paid" as const,
        upfrontAmount: 1800,
        pendingTotal: null,
      },
    ]);

    expect(result).toEqual([
      { name: "May 2026", Total: 1200, Net: 0 },
      { name: "Jun 2026", Total: 1800, Net: 0 },
    ]);
  });

  it("adds pending amounts to the monthly chart total", () => {
    const result = buildMonthlyPaymentsChartData([
      {
        closedAt: "2026-05-28T12:00:00.000Z",
        totalPaid: 1200,
        status: "partially_paid" as const,
        upfrontAmount: 2500,
        pendingTotal: 1000,
      },
    ]);

    expect(result).toEqual([
      { name: "May 2026", Total: 2200, Net: 0 },
    ]);
  });

  it("skips records that do not have a client closing date", () => {
    const result = buildMonthlyPaymentsChartData([
      {
        closedAt: null,
        totalPaid: 900,
        status: "partially_paid" as const,
        upfrontAmount: 2000,
        pendingTotal: null,
      },
    ]);

    expect(result).toEqual([]);
  });
});
