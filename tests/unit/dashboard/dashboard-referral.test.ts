import { splitLeadRequestsByReferral } from "@/lib/utils/dashboard-referral";
import type { LeadRequest } from "@/lib/types";

const makeRequest = (overrides: Partial<LeadRequest>): LeadRequest => ({
  $id: "req-1",
  name: "John Doe",
  email: "john@example.com",
  phone: "555-1234",
  linkedinProfileUrl: "https://linkedin.com/in/john",
  city: "NYC",
  interestedService: "Resume",
  referrerName: "",
  notes: "",
  referrerCompany: undefined,
  bonusAmount: undefined,
  paymentDate: undefined,
  paymentMode: undefined,
  salesPerson: undefined,
  data: "{}",
  status: "pending",
  createdAt: "2026-06-15T10:00:00.000Z",
  updatedAt: "2026-06-15T10:00:00.000Z",
  ...overrides,
});

describe("splitLeadRequestsByReferral", () => {
  it("classifies a request with no referrer fields as non-referral", () => {
    const result = splitLeadRequestsByReferral([
      makeRequest({
        $id: "r1",
        data: JSON.stringify({ leadAmount: 5000 }),
      }),
    ]);
    expect(result.nonReferral.count).toBe(1);
    expect(result.nonReferral.totalAmount).toBe(5000);
    expect(result.referral.count).toBe(0);
    expect(result.referral.totalBonus).toBe(0);
  });

  it("classifies a request with both referrer fields as referral", () => {
    const result = splitLeadRequestsByReferral([
      makeRequest({
        $id: "r2",
        referrerName: "Alice Smith",
        referrerCompany: "Acme Corp",
        bonusAmount: "250",
      }),
    ]);
    expect(result.referral.count).toBe(1);
    expect(result.referral.totalBonus).toBe(250);
    expect(result.nonReferral.count).toBe(0);
  });

  it("falls back to totalAmount when leadAmount is missing", () => {
    const result = splitLeadRequestsByReferral([
      makeRequest({ data: JSON.stringify({ totalAmount: 3000 }) }),
    ]);
    expect(result.nonReferral.totalAmount).toBe(3000);
  });

  it("falls back to amount when leadAmount and totalAmount are missing", () => {
    const result = splitLeadRequestsByReferral([
      makeRequest({ data: JSON.stringify({ amount: 1500 }) }),
    ]);
    expect(result.nonReferral.totalAmount).toBe(1500);
  });

  it("excludes requests with only one referrer field (malformed)", () => {
    const result = splitLeadRequestsByReferral([
      makeRequest({ referrerName: "Alice" }), // no company
      makeRequest({ $id: "r3", referrerCompany: "Acme" }), // no name
    ]);
    expect(result.nonReferral.count).toBe(0);
    expect(result.referral.count).toBe(0);
  });

  it("treats whitespace-only referrer fields as empty (excluded as partial)", () => {
    const result = splitLeadRequestsByReferral([
      makeRequest({
        referrerName: "   ",
        referrerCompany: "Acme",
      }),
    ]);
    // Only one of the two fields has content -> treated as malformed, excluded
    expect(result.nonReferral.count).toBe(0);
    expect(result.referral.count).toBe(0);
  });

  it("sums multiple non-referral and referral amounts correctly", () => {
    const result = splitLeadRequestsByReferral([
      makeRequest({
        $id: "n1",
        data: JSON.stringify({ leadAmount: 1000 }),
      }),
      makeRequest({
        $id: "n2",
        data: JSON.stringify({ leadAmount: 2500 }),
      }),
      makeRequest({
        $id: "r1",
        referrerName: "Alice",
        referrerCompany: "Acme",
        bonusAmount: "100",
      }),
      makeRequest({
        $id: "r2",
        referrerName: "Bob",
        referrerCompany: "Globex",
        bonusAmount: "200",
      }),
    ]);
    expect(result.nonReferral.count).toBe(2);
    expect(result.nonReferral.totalAmount).toBe(3500);
    expect(result.referral.count).toBe(2);
    expect(result.referral.totalBonus).toBe(300);
  });

  it("returns zeros for an empty list", () => {
    const result = splitLeadRequestsByReferral([]);
    expect(result).toEqual({
      nonReferral: { count: 0, totalAmount: 0 },
      referral: { count: 0, totalBonus: 0 },
    });
  });

  it("does not crash on malformed data JSON", () => {
    const result = splitLeadRequestsByReferral([
      makeRequest({ data: "not json" }),
    ]);
    expect(result.nonReferral.count).toBe(1);
    expect(result.nonReferral.totalAmount).toBe(0);
  });
});
