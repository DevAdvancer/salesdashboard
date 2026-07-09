"use client";

import { DateRangePicker } from "@/components/ui/date-picker";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { isSingleDay } from "@/lib/utils/dashboard-kpi";
import type { DateRange } from "@/lib/utils/dashboard-kpi";
import { getTodayEst, getMonthStartEst } from "@/lib/utils/est-date";
import {
  isWorkingDateKey,
  parseIsoDate,
  toIsoDateKey,
} from "@/lib/utils/holiday-calendar";

interface DashboardDateRangeProps {
  value: DateRange;
  onChange: (value: DateRange) => void;
  className?: string;
  disabledDates?: string[];
  disableHolidaySelection?: boolean;
}

function findNextSelectableDate(
  startIso: string,
  disabledDates: string[],
): string | null {
  const cursor = parseIsoDate(startIso);
  for (let i = 0; i < 370; i += 1) {
    const iso = toIsoDateKey(cursor);
    if (isWorkingDateKey(iso, disabledDates)) return iso;
    cursor.setDate(cursor.getDate() + 1);
  }
  return null;
}

function findPreviousSelectableDate(
  startIso: string,
  disabledDates: string[],
): string | null {
  const cursor = parseIsoDate(startIso);
  for (let i = 0; i < 370; i += 1) {
    const iso = toIsoDateKey(cursor);
    if (isWorkingDateKey(iso, disabledDates)) return iso;
    cursor.setDate(cursor.getDate() - 1);
  }
  return null;
}

export function DashboardDateRange({
  value,
  onChange,
  className,
  disabledDates = [],
  disableHolidaySelection = false,
}: DashboardDateRangeProps) {
  const today = getTodayEst();
  const monthFirst = getMonthStartEst();
  const selectableToday = disableHolidaySelection
    ? findPreviousSelectableDate(today, disabledDates)
    : today;
  const selectableMonthStart = disableHolidaySelection
    ? findNextSelectableDate(monthFirst, disabledDates)
    : monthFirst;

  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      <DateRangePicker
        value={value}
        onChange={onChange}
        className="w-72"
        disabledDates={disableHolidaySelection ? disabledDates : []}
      />
      <Button
        variant="secondary"
        size="sm"
        disabled={!selectableToday}
        onClick={() => {
          if (!selectableToday) return;
          onChange({ from: selectableToday, to: selectableToday });
        }}
        className={cn(value.from === selectableToday && isSingleDay(value) && "ring-1 ring-[var(--ink)]")}
      >
        Today
      </Button>
      <Button
        variant="secondary"
        size="sm"
        disabled={!selectableMonthStart || !selectableToday || selectableMonthStart > selectableToday}
        onClick={() => {
          if (!selectableMonthStart || !selectableToday || selectableMonthStart > selectableToday) return;
          onChange({ from: selectableMonthStart, to: selectableToday });
        }}
        className={cn(
          value.from === selectableMonthStart &&
            value.to === selectableToday &&
            !isSingleDay(value) &&
            "ring-1 ring-[var(--ink)]",
        )}
      >
        This month
      </Button>
    </div>
  );
}
