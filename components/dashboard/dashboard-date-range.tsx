"use client";

import { DateRangePicker } from "@/components/ui/date-picker";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { isSingleDay } from "@/lib/utils/dashboard-kpi";
import type { DateRange } from "@/lib/utils/dashboard-kpi";

function toIso(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function monthStart(date: Date): string {
  return toIso(new Date(date.getFullYear(), date.getMonth(), 1));
}

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
  const today = toIso(new Date());
  const monthFirst = monthStart(new Date());

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
