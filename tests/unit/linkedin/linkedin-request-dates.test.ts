import { daysSinceLinkedinRequestDate, daysSinceLinkedinRequestEvent, formatLinkedinRequestSentDate, getLinkedinRequestDateFilterValue } from "@/lib/utils/linkedin-request-dates";

describe("Linkedin request date filters", () => {
  it("keeps UTC midnight request dates on the same selected calendar day", () => {
    expect(getLinkedinRequestDateFilterValue("2026-06-08T00:00:00.000Z")).toBe(
      "2026-06-08",
    );
  });

  it("returns an empty filter value for invalid dates", () => {
    expect(getLinkedinRequestDateFilterValue("not-a-date")).toBe("");
  });

  it("shows October 13 for an October 13 request stored at UTC midnight", () => {
    const stored = "2026-10-13T00:00:00.000Z";
    expect(formatLinkedinRequestSentDate(stored)).toBe("10/13/2026");
    expect(daysSinceLinkedinRequestDate(stored, new Date("2026-10-13T16:00:00.000Z"))).toBe(0);
  });

  it("counts request days in Eastern time across UTC midnight and daylight saving changes", () => {
    expect(daysSinceLinkedinRequestDate("2026-10-12T00:00:00.000Z",
      new Date("2026-10-13T02:00:00.000Z"))).toBe(0);
    expect(daysSinceLinkedinRequestDate("2026-03-07T00:00:00.000Z",
      new Date("2026-03-09T16:00:00.000Z"))).toBe(2);
    expect(daysSinceLinkedinRequestEvent("2026-10-13T01:00:00.000Z",
      new Date("2026-10-13T16:00:00.000Z"))).toBe(1);
  });
});
