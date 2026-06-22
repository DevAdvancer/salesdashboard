import { expandIsoDateToEnd, expandIsoDateToStart } from "@/lib/utils/iso-date-range";
import { buildWorkingDayKpi, eachWorkingDateInRange } from "@/lib/utils/report-kpi";

describe("eachWorkingDateInRange", () => {
  it("keeps the same local date when the range comes from date-only inputs", () => {
    const dates = eachWorkingDateInRange(
      expandIsoDateToStart("2026-06-22"),
      expandIsoDateToEnd("2026-06-22"),
    );

    expect(dates).toEqual(["2026-06-22"]);
  });

  it("excludes weekends from a full-week range", () => {
    const dates = eachWorkingDateInRange(
      expandIsoDateToStart("2026-06-22"),
      expandIsoDateToEnd("2026-06-28"),
    );

    expect(dates).toEqual([
      "2026-06-22",
      "2026-06-23",
      "2026-06-24",
      "2026-06-25",
      "2026-06-26",
    ]);
  });
});

describe("buildWorkingDayKpi", () => {
  it("counts only working days in a monthly range", () => {
    const kpi = buildWorkingDayKpi(
      {
        from: expandIsoDateToStart("2026-06-01"),
        to: expandIsoDateToEnd("2026-06-30"),
      },
      new Set(["2026-06-02", "2026-06-05", "2026-06-29"]),
    );

    expect(kpi.totalDays).toBe(22);
    expect(kpi.daysMet).toBe(3);
    expect(kpi.daysMissed).toBe(19);
    expect(kpi.daily.some((day) => day.date === "2026-06-06")).toBe(false);
    expect(kpi.daily.some((day) => day.date === "2026-06-07")).toBe(false);
  });

  it("returns an empty KPI when the range contains only weekend days", () => {
    const kpi = buildWorkingDayKpi(
      {
        from: expandIsoDateToStart("2026-06-20"),
        to: expandIsoDateToEnd("2026-06-21"),
      },
      new Set(["2026-06-20"]),
    );

    expect(kpi).toEqual({
      daily: [],
      daysMet: 0,
      daysMissed: 0,
      totalDays: 0,
    });
  });
});
