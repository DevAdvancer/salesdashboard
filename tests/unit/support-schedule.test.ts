import {
  getMinimumAssessmentDeadline,
  getMinimumSupportDateTime,
  isFutureSupportDateTime,
} from "@/lib/utils/support-schedule";

describe("support scheduling in Eastern time", () => {
  it("rejects an earlier time on the same date and permits the next minute", () => {
    const now = new Date("2026-09-12T16:00:20.000Z"); // 12:00:20 PM EDT

    expect(getMinimumSupportDateTime(now)).toBe("2026-09-12T12:01");
    expect(isFutureSupportDateTime("2026-09-12T10:00", now)).toBe(false);
    expect(isFutureSupportDateTime("2026-09-12T12:00", now)).toBe(false);
    expect(isFutureSupportDateTime("2026-09-12T12:01", now)).toBe(true);
    expect(isFutureSupportDateTime("2026-09-13T09:00", now)).toBe(true);
  });

  it("rolls over to the next Eastern day", () => {
    const now = new Date("2026-09-13T03:59:30.000Z"); // 11:59:30 PM EDT

    expect(getMinimumSupportDateTime(now)).toBe("2026-09-13T00:00");
    expect(isFutureSupportDateTime("2026-09-12T23:59", now)).toBe(false);
    expect(isFutureSupportDateTime("2026-09-13T00:00", now)).toBe(true);
  });

  it("rejects malformed dates and keeps the deadline after the received time", () => {
    const now = new Date("2026-09-12T16:00:20.000Z");

    expect(isFutureSupportDateTime("2026-09-31T13:00", now)).toBe(false);
    expect(isFutureSupportDateTime("2026-09-12T25:00", now)).toBe(false);
    expect(getMinimumAssessmentDeadline("2026-09-12T14:00", now)).toBe("2026-09-12T14:01");
    expect(getMinimumAssessmentDeadline("2026-09-12T10:00", now)).toBe("2026-09-12T12:01");
  });
});
