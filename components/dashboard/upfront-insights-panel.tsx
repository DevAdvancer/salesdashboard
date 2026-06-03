"use client";

import { useMemo } from "react";
import {
  ArrowRight,
  Building2,
  CalendarDays,
  CheckCircle2,
  DollarSign,
  TrendingUp,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { PaymentInsightRecord } from "@/app/actions/client-payments";

const currencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

interface UpfrontInsightsPanelProps {
  records: PaymentInsightRecord[];
  isLoading: boolean;
}

function SectionSkeleton() {
  return (
    <div className="space-y-2">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="flex items-center justify-between border border-border bg-[var(--soft-cloud)] px-3 py-2">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-4 w-20" />
        </div>
      ))}
    </div>
  );
}

export function UpfrontInsightsPanel({
  records,
  isLoading,
}: UpfrontInsightsPanelProps) {
  const derived = useMemo(() => {
    // --- Per company ---
    const byCompany = new Map<string, number>();
    for (const r of records) {
      if (r.upfrontAmount > 0) {
        byCompany.set(r.company, (byCompany.get(r.company) ?? 0) + r.upfrontAmount);
      }
    }
    const companyRows = Array.from(byCompany.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8);

    // --- Per plan months ---
    const byMonths = new Map<number, { total: number; count: number }>();
    for (const r of records) {
      if (r.upfrontAmount > 0 && r.months > 0) {
        const existing = byMonths.get(r.months) ?? { total: 0, count: 0 };
        byMonths.set(r.months, {
          total: existing.total + r.upfrontAmount,
          count: existing.count + 1,
        });
      }
    }
    const monthsRows = Array.from(byMonths.entries())
      .sort((a, b) => a[0] - b[0]);

    // --- Full-time (fully paid) upfront ---
    const fullyPaidUpfront = records
      .filter((r) => r.status === "fully_paid")
      .reduce((sum, r) => sum + r.upfrontAmount, 0);

    const fullyPaidCount = records.filter((r) => r.status === "fully_paid").length;

    // --- Partially paid → Fully paid transitions ---
    const partialToFullCount = records.filter((r) => r.wasPartiallyPaid).length;
    const partialToFullUpfront = records
      .filter((r) => r.wasPartiallyPaid)
      .reduce((sum, r) => sum + r.upfrontAmount, 0);

    // Current partially paid
    const currentPartialCount = records.filter((r) => r.status === "partially_paid").length;
    const currentPartialUpfront = records
      .filter((r) => r.status === "partially_paid")
      .reduce((sum, r) => sum + r.upfrontAmount, 0);

    return {
      companyRows,
      monthsRows,
      fullyPaidUpfront,
      fullyPaidCount,
      partialToFullCount,
      partialToFullUpfront,
      currentPartialCount,
      currentPartialUpfront,
    };
  }, [records]);

  return (
    <Card id="tour-upfront-insights">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <DollarSign className="h-4 w-4" />
          Upfront Cost Insights
        </CardTitle>
        <CardDescription>
          Breakdown of client upfront payments — by company, plan duration, and
          payment progression.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {/* Summary row */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
          {/* Fully paid upfront */}
          <div className="flex flex-col gap-1 border bg-[var(--soft-cloud)] p-4">
            <span className="text-xs font-medium text-muted-foreground flex items-center gap-1">
              <CheckCircle2 className="h-3.5 w-3.5 text-[var(--success)]" />
              Fully Paid Upfront
            </span>
            {isLoading ? (
              <Skeleton className="h-7 w-24" />
            ) : (
              <span className="text-xl font-bold text-[var(--success)]">
                {currencyFormatter.format(derived.fullyPaidUpfront)}
              </span>
            )}
            {!isLoading && (
              <span className="text-xs text-muted-foreground">
                {derived.fullyPaidCount} client{derived.fullyPaidCount !== 1 ? "s" : ""} fully paid
              </span>
            )}
          </div>

          {/* Partially paid currently */}
          <div className="flex flex-col gap-1 border bg-[var(--soft-cloud)] p-4">
            <span className="text-xs font-medium text-muted-foreground flex items-center gap-1">
              <TrendingUp className="h-3.5 w-3.5" />
              Partially Paid (Active)
            </span>
            {isLoading ? (
              <Skeleton className="h-7 w-24" />
            ) : (
              <span className="text-xl font-bold">
                {currencyFormatter.format(derived.currentPartialUpfront)}
              </span>
            )}
            {!isLoading && (
              <span className="text-xs text-muted-foreground">
                {derived.currentPartialCount} client{derived.currentPartialCount !== 1 ? "s" : ""} partially paid
              </span>
            )}
          </div>

          {/* Partial → Full transitions */}
          <div className="flex flex-col gap-1 border bg-[var(--soft-cloud)] p-4">
            <span className="text-xs font-medium text-muted-foreground flex items-center gap-1">
              <ArrowRight className="h-3.5 w-3.5 text-[var(--success)]" />
              Partial → Fully Paid
            </span>
            {isLoading ? (
              <Skeleton className="h-7 w-24" />
            ) : (
              <span className="text-xl font-bold">
                {derived.partialToFullCount}
              </span>
            )}
            {!isLoading && (
              <span className="text-xs text-muted-foreground">
                {currencyFormatter.format(derived.partialToFullUpfront)} total upfront collected
              </span>
            )}
          </div>
        </div>

        {/* Per-company and per-months side by side */}
        <div className="grid gap-6 xl:grid-cols-2">
          {/* By Company */}
          <div>
            <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
              <Building2 className="h-4 w-4 text-muted-foreground" />
              Upfront by Company
            </h3>
            {isLoading ? (
              <SectionSkeleton />
            ) : derived.companyRows.length === 0 ? (
              <p className="text-sm text-muted-foreground">No upfront data available yet.</p>
            ) : (
              <div className="space-y-2">
                {derived.companyRows.map(([company, total]) => (
                  <div
                    key={company}
                    className="flex items-center justify-between border border-border bg-[var(--soft-cloud)] px-3 py-2"
                  >
                    <span className="text-sm truncate max-w-[60%]">{company}</span>
                    <span className="text-sm font-semibold tabular-nums">
                      {currencyFormatter.format(total)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* By Plan Duration (months) */}
          <div>
            <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
              <CalendarDays className="h-4 w-4 text-muted-foreground" />
              Upfront by Plan Duration
            </h3>
            {isLoading ? (
              <SectionSkeleton />
            ) : derived.monthsRows.length === 0 ? (
              <p className="text-sm text-muted-foreground">No upfront data available yet.</p>
            ) : (
              <div className="space-y-2">
                {derived.monthsRows.map(([months, { total, count }]) => (
                  <div
                    key={months}
                    className="flex items-center justify-between border border-border bg-[var(--soft-cloud)] px-3 py-2"
                  >
                    <span className="text-sm">
                      {months} month{months !== 1 ? "s" : ""}
                      <span className="ml-2 text-xs text-muted-foreground">
                        ({count} client{count !== 1 ? "s" : ""})
                      </span>
                    </span>
                    <span className="text-sm font-semibold tabular-nums">
                      {currencyFormatter.format(total)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
