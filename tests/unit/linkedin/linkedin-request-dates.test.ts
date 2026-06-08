import { getLinkedinRequestDateFilterValue } from "@/lib/utils/linkedin-request-dates";

describe("Linkedin request date filters", () => {
  it("keeps UTC midnight request dates on the same selected calendar day", () => {
    expect(getLinkedinRequestDateFilterValue("2026-06-08T00:00:00.000Z")).toBe(
      "2026-06-08",
    );
  });

  it("returns an empty filter value for invalid dates", () => {
    expect(getLinkedinRequestDateFilterValue("not-a-date")).toBe("");
  });
});
