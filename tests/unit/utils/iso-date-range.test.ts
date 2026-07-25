import {
  expandIsoDateToStart,
  expandIsoDateToEnd,
} from "@/lib/utils/iso-date-range";

describe("expandIsoDateToStart", () => {
  it("returns an empty string as-is", () => {
    expect(expandIsoDateToStart("")).toBe("");
  });

  it("passes through a full ISO datetime unchanged", () => {
    const iso = "2026-06-22T10:30:00.000Z";
    expect(expandIsoDateToStart(iso)).toBe(iso);
  });

  it("expands a YYYY-MM-DD date to UTC midnight as an ISO string", () => {
    const result = expandIsoDateToStart("2026-06-22");
    expect(result).not.toBe("2026-06-22");
    // The helper builds the boundary with Date.UTC, so the result is the
    // same string on every machine regardless of the local timezone. That
    // matters because these helpers run inside server actions, where the
    // host timezone is not something the app controls.
    expect(result).toBe("2026-06-22T00:00:00.000Z");
    const resultDate = new Date(result);
    expect(Number.isNaN(resultDate.getTime())).toBe(false);
    expect(resultDate.getUTCHours()).toBe(0);
    expect(resultDate.getUTCMinutes()).toBe(0);
    expect(resultDate.getUTCSeconds()).toBe(0);
    expect(resultDate.getUTCMilliseconds()).toBe(0);
  });

  it("handles invalid input by passing it through", () => {
    expect(expandIsoDateToStart("not-a-date")).toBe("not-a-date");
  });
});

describe("expandIsoDateToEnd", () => {
  it("returns an empty string as-is", () => {
    expect(expandIsoDateToEnd("")).toBe("");
  });

  it("passes through a full ISO datetime unchanged", () => {
    const iso = "2026-06-22T10:30:00.000Z";
    expect(expandIsoDateToEnd(iso)).toBe(iso);
  });

  it("expands a YYYY-MM-DD date to UTC 23:59:59.999 as an ISO string", () => {
    const result = expandIsoDateToEnd("2026-06-22");
    // Inclusive end of the UTC day, so a lessThanEqual filter keeps every
    // timestamp recorded on that date.
    expect(result).toBe("2026-06-22T23:59:59.999Z");
    const resultDate = new Date(result);
    expect(Number.isNaN(resultDate.getTime())).toBe(false);
    expect(resultDate.getUTCHours()).toBe(23);
    expect(resultDate.getUTCMinutes()).toBe(59);
    expect(resultDate.getUTCSeconds()).toBe(59);
    expect(resultDate.getUTCMilliseconds()).toBe(999);
  });

  it("end-of-day is strictly after start-of-day for the same date", () => {
    const start = new Date(expandIsoDateToStart("2026-06-22"));
    const end = new Date(expandIsoDateToEnd("2026-06-22"));
    expect(end.getTime()).toBeGreaterThan(start.getTime());
  });
});
