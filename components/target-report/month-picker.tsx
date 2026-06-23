"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatMonthKey } from "@/lib/utils/month-key";

export interface MonthPickerProps {
  monthKey: string;
  onChange: (next: string) => void;
}

/**
 * Lightweight YYYY-MM picker — a label with prev/next buttons. No
 * native picker; keeps the page consistent across browsers.
 *
 * The label is rendered via `formatMonthKey` so it always reads in
 * UTC and matches the section title's underlying `monthKey` string.
 */
export function MonthPicker({ monthKey, onChange }: MonthPickerProps) {
  const [yearStr, monthStr] = monthKey.split("-");
  const year = Number(yearStr);
  const month = Number(monthStr);
  const label = formatMonthKey(monthKey);

  const shift = (delta: number) => {
    if (!Number.isFinite(year) || !Number.isFinite(month)) return;
    const next = new Date(Date.UTC(year, month - 1 + delta, 1));
    const nextKey = `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}`;
    onChange(nextKey);
  };

  return (
    <div className="inline-flex items-center gap-1 rounded-md border bg-card px-2 py-1 text-sm">
      <Button
        type="button"
        size="icon"
        variant="ghost"
        className="h-7 w-7"
        aria-label="Previous month"
        onClick={() => shift(-1)}>
        <ChevronLeft className="h-4 w-4" />
      </Button>
      <div className="min-w-[140px] text-center font-medium tabular-nums">{label}</div>
      <Button
        type="button"
        size="icon"
        variant="ghost"
        className="h-7 w-7"
        aria-label="Next month"
        onClick={() => shift(1)}>
        <ChevronRight className="h-4 w-4" />
      </Button>
    </div>
  );
}
