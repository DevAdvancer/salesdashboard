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

  it("expands a YYYY-MM-DD date to local midnight as an ISO string", () => {
    const result = expandIsoDateToStart("2026-06-22");
    expect(result).not.toBe("2026-06-22");
    // The result should be a valid ISO string that sorts BEFORE
    // any timestamp in the same local day but AFTER the prior day.
    const resultDate = new Date(result);
    expect(Number.isNaN(resultDate.getTime())).toBe(false);
    // Must be midnight local (the helpers use new Date(y, m-1, d, 0,0,0,0))
    expect(resultDate.getHours()).toBe(0);
    expect(resultDate.getMinutes()).toBe(0);
    expect(resultDate.getSeconds()).toBe(0);
    expect(resultDate.getMilliseconds()).toBe(0);
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

  it("expands a YYYY-MM-DD date to local 23:59:59.999 as an ISO string", () => {
    const result = expandIsoDateToEnd("2026-06-22");
    const resultDate = new Date(result);
    expect(Number.isNaN(resultDate.getTime())).toBe(false);
    // Must be end-of-day local.
    expect(resultDate.getHours()).toBe(23);
    expect(resultDate.getMinutes()).toBe(59);
    expect(resultDate.getSeconds()).toBe(59);
    expect(resultDate.getMilliseconds()).toBe(999);
  });

  it("end-of-day is strictly after start-of-day for the same date", () => {
    const start = new Date(expandIsoDateToStart("2026-06-22"));
    const end = new Date(expandIsoDateToEnd("2026-06-22"));
    expect(end.getTime()).toBeGreaterThan(start.getTime());
  });
});
