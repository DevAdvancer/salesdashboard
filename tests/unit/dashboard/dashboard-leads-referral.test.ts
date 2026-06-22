import { splitLeadsByReferral } from "@/lib/utils/dashboard-referral";
import type { Lead } from "@/lib/types";

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

  it("prefers bonusAmount over leadAmount for referral leads", () => {
    const result = splitLeadsByReferral([
      makeLead({
        $id: "r1",
        data: JSON.stringify({ source: "Referral", leadAmount: 5000, bonusAmount: 250 }),
      }),
    ]);
    expect(result.referral.totalAmount).toBeCloseTo(250);
  });

  it("falls back to leadAmount when referral bonus is missing/zero", () => {
    const result = splitLeadsByReferral([
      makeLead({
        $id: "r1",
        data: JSON.stringify({ source: "Referral", leadAmount: 4000 }),
      }),
    ]);
    expect(result.referral.totalAmount).toBeCloseTo(4000);
  });

  it("falls back to amount when bonus is 0 and leadAmount/totalAmount missing", () => {
    const result = splitLeadsByReferral([
      makeLead({
        $id: "r1",
        data: JSON.stringify({ source: "Referral", amount: 1500, bonusAmount: 0 }),
      }),
    ]);
    // bonusAmount is 0, so it should fall back to amount (1500)
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

  it("uses paid amount from paidByLeadId when available", () => {
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
    // Referral: bonusAmount 200 > 0, so bonus wins over paid 250.
    expect(result.referral.totalAmount).toBeCloseTo(200);
  });

  it("falls back to lead amount when paidByLeadId has no entry for the lead", () => {
    const paid = new Map<string, number>([["other", 999]]);
    const result = splitLeadsByReferral(
      [makeLead({ $id: "a", isClosed: true, data: JSON.stringify({ leadAmount: 150 }) })],
      paid,
    );
    expect(result.nonReferral.totalAmount).toBeCloseTo(150);
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
      nonReferral: { count: 0, totalAmount: 0 },
      referral: { count: 0, totalAmount: 0 },
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
    // referral r1 has bonusAmount=0 so uses leadAmount=3000; r2 has bonusAmount=200
    expect(result.referral.totalAmount).toBeCloseTo(3200);
  });
});
