"use client";

import { DateRangePicker } from "@/components/ui/date-picker";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { isSingleDay } from "@/lib/utils/dashboard-kpi";
import type { DateRange } from "@/lib/utils/dashboard-kpi";
import { getTodayEst, getMonthStartEst } from "@/lib/utils/est-date";

interface DashboardDateRangeProps {
  value: DateRange;
  onChange: (value: DateRange) => void;
  className?: string;
}

export function DashboardDateRange({
  value,
  onChange,
  className,
}: DashboardDateRangeProps) {
  const today = getTodayEst();
  const monthFirst = getMonthStartEst();

  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      <DateRangePicker value={value} onChange={onChange} className="w-72" />
      <Button
        variant="secondary"
        size="sm"
        onClick={() => onChange({ from: today, to: today })}
        className={cn(value.from === today && isSingleDay(value) && "ring-1 ring-[var(--ink)]")}
      >
        Today
      </Button>
      <Button
        variant="secondary"
        size="sm"
        onClick={() => onChange({ from: monthFirst, to: today })}
        className={cn(
          value.from === monthFirst && value.to === today && !isSingleDay(value) && "ring-1 ring-[var(--ink)]",
        )}
      >
        This month
      </Button>
    </div>
  );
}
