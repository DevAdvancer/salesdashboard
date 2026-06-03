"use client";

import { useMemo, useState } from "react";
import dynamic from "next/dynamic";
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

const FinancialInsightsChart = dynamic(
  () =>
    import("@/components/dashboard/financial-insights-chart").then(
      (m) => m.FinancialInsightsChart
    ),
  { loading: () => <Skeleton className="h-[260px] w-full" /> }
);

const fmt = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

/** "All months" sentinel */
const ALL_MONTHS = "__all__";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toMonthKey(iso: string): { key: string; monthStart: number } {
  const d = new Date(iso);
  const key = d.toLocaleString("default", { month: "short", year: "numeric" });
  const monthStart = new Date(d.getFullYear(), d.getMonth(), 1).getTime();
  return { key, monthStart };
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function StatBox({
  label,
  value,
  sub,
  icon: Icon,
  loading,
  highlight,
}: {
  label: string;
  value: string;
  sub?: string;
  icon: React.ElementType;
  loading: boolean;
  highlight?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1 border border-border bg-[var(--soft-cloud)] p-4">
      <span className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </span>
      {loading ? (
        <Skeleton className="h-7 w-28 mt-1" />
      ) : (
        <span
          className={`text-xl font-bold tabular-nums ${highlight ? "text-[var(--success)]" : ""}`}
        >
          {value}
        </span>
      )}
      {sub && !loading && (
        <span className="text-xs text-muted-foreground">{sub}</span>
      )}
    </div>
  );
}

function RowList({
  rows,
  loading,
  emptyText,
}: {
  rows: { label: string; value: number }[];
  loading: boolean;
  emptyText: string;
}) {
  if (loading) {
    return (
      <div className="space-y-2">
        {[...Array(4)].map((_, i) => (
          <div
            key={i}
            className="flex items-center justify-between border border-border bg-[var(--soft-cloud)] px-3 py-2"
          >
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-4 w-20" />
          </div>
        ))}
      </div>
    );
  }
  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground py-2">{emptyText}</p>;
  }
  return (
    <div className="space-y-2">
      {rows.map(({ label, value }) => (
        <div
          key={label}
          className="flex items-center justify-between border border-border bg-[var(--soft-cloud)] px-3 py-2"
        >
          <span className="text-sm truncate max-w-[60%]">{label}</span>
          <span className="text-sm font-semibold tabular-nums">{fmt.format(value)}</span>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

interface FinancialInsightsSectionProps {
  paymentRecords: PaymentInsightRecord[];
  isLoading: boolean;
}

export function FinancialInsightsSection({
  paymentRecords,
  isLoading,
}: FinancialInsightsSectionProps) {
  const [selectedMonth, setSelectedMonth] = useState<string>(ALL_MONTHS);

  // ── Build sorted month list from payment records ──────────────────────────
  const monthOptions = useMemo(() => {
    const map = new Map<string, number>(); // key -> monthStart
    for (const r of paymentRecords) {
      const { key, monthStart } = toMonthKey(r.createdAt);
      if (!map.has(key)) map.set(key, monthStart);
    }
    return Array.from(map.entries())
      .sort((a, b) => a[1] - b[1])
      .map(([name, monthStart]) => ({ name, monthStart }));
  }, [paymentRecords]);

  // ── Filter records by selected month ─────────────────────────────────────
  const isFiltered = selectedMonth !== ALL_MONTHS;

  const filtered = useMemo(() => {
    if (!isFiltered) return paymentRecords;
    return paymentRecords.filter(
      (r) => toMonthKey(r.createdAt).key === selectedMonth
    );
  }, [paymentRecords, isFiltered, selectedMonth]);

  // ── Chart data: upfront collected per month (all or single) ──────────────
  const chartData = useMemo(() => {
    if (isFiltered) {
      const total = filtered.reduce((s, r) => s + r.upfrontAmount, 0);
      const net = filtered
        .filter((r) => r.status === "fully_paid")
        .reduce((s, r) => s + r.upfrontAmount, 0);
      return [{ name: selectedMonth, Total: total, Net: net }];
    }

    const map = new Map<string, { total: number; net: number; monthStart: number }>();
    for (const r of paymentRecords) {
      const { key, monthStart } = toMonthKey(r.createdAt);
      const ex = map.get(key) ?? { total: 0, net: 0, monthStart };
      map.set(key, {
        total: ex.total + r.upfrontAmount,
        net: ex.net + (r.status === "fully_paid" ? r.upfrontAmount : 0),
        monthStart,
      });
    }
    return Array.from(map.entries())
      .sort((a, b) => a[1].monthStart - b[1].monthStart)
      .map(([name, d]) => ({ name, Total: d.total, Net: d.net }));
  }, [paymentRecords, filtered, isFiltered, selectedMonth]);

  // ── Summary stats (from filtered set) ────────────────────────────────────
  const totalUpfront = filtered.reduce((s, r) => s + r.upfrontAmount, 0);
  const fullyPaid = filtered.filter((r) => r.status === "fully_paid");
  const partiallyPaid = filtered.filter((r) => r.status === "partially_paid");
  const fullyPaidUpfront = fullyPaid.reduce((s, r) => s + r.upfrontAmount, 0);
  const partialUpfront = partiallyPaid.reduce((s, r) => s + r.upfrontAmount, 0);
  const partialToFull = filtered.filter((r) => r.wasPartiallyPaid);
  const partialToFullCount = partialToFull.length;
  const partialToFullUpfront = partialToFull.reduce((s, r) => s + r.upfrontAmount, 0);

  // ── Upfront by company (filtered, top 8) ─────────────────────────────────
  const upfrontByCompany = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of filtered) {
      if (r.upfrontAmount > 0)
        map.set(r.company, (map.get(r.company) ?? 0) + r.upfrontAmount);
    }
    return Array.from(map.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([label, value]) => ({ label, value }));
  }, [filtered]);

  // ── Upfront by plan months (filtered) ────────────────────────────────────
  const upfrontByPlan = useMemo(() => {
    const map = new Map<number, { total: number; count: number }>();
    for (const r of filtered) {
      if (r.upfrontAmount > 0 && r.months > 0) {
        const ex = map.get(r.months) ?? { total: 0, count: 0 };
        map.set(r.months, { total: ex.total + r.upfrontAmount, count: ex.count + 1 });
      }
    }
    return Array.from(map.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([months, { total, count }]) => ({
        label: `${months} month${months !== 1 ? "s" : ""} (${count})`,
        value: total,
      }));
  }, [filtered]);

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <Card id="tour-financial-insights">
      <CardHeader>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <DollarSign className="h-4 w-4" />
              Financial Insights
            </CardTitle>
            <CardDescription className="mt-1">
              Based on client upfront costs.{" "}
              {isFiltered
                ? `Showing ${selectedMonth}.`
                : "Showing all-time data."}
            </CardDescription>
          </div>

          {/* Month filter */}
          <div className="flex items-center gap-2 shrink-0">
            <CalendarDays className="h-4 w-4 text-muted-foreground" />
            <select
              id="fi-month-filter"
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(e.target.value)}
              disabled={isLoading || monthOptions.length === 0}
              className="flex h-9 rounded-md border border-border bg-background px-3 py-1 text-sm text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
            >
              <option value={ALL_MONTHS}>All months</option>
              {monthOptions.map((m) => (
                <option key={m.name} value={m.name}>
                  {m.name}
                </option>
              ))}
            </select>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-8">

        {/* ── Revenue summary stats ── */}
        <div>
          <h3 className="text-sm font-semibold mb-3 text-muted-foreground uppercase tracking-wide">
            Revenue Summary
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            <StatBox
              label="Total Upfront Collected"
              value={fmt.format(totalUpfront)}
              sub={`${filtered.length} client${filtered.length !== 1 ? "s" : ""} ${isFiltered ? `in ${selectedMonth}` : "all time"}`}
              icon={DollarSign}
              loading={isLoading}
            />
            <StatBox
              label="Fully Paid Upfront"
              value={fmt.format(fullyPaidUpfront)}
              sub={`${fullyPaid.length} client${fullyPaid.length !== 1 ? "s" : ""} fully paid`}
              icon={CheckCircle2}
              loading={isLoading}
              highlight
            />
            <StatBox
              label="Partially Paid (Active)"
              value={fmt.format(partialUpfront)}
              sub={`${partiallyPaid.length} client${partiallyPaid.length !== 1 ? "s" : ""} partially paid`}
              icon={TrendingUp}
              loading={isLoading}
            />
          </div>
        </div>

        {/* ── Partial → Fully Paid ── */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <StatBox
            label="Partial → Fully Paid"
            value={String(partialToFullCount)}
            sub={`${fmt.format(partialToFullUpfront)} total upfront collected`}
            icon={ArrowRight}
            loading={isLoading}
            highlight
          />
          <StatBox
            label="Collection Rate"
            value={
              totalUpfront > 0
                ? `${((fullyPaidUpfront / totalUpfront) * 100).toFixed(1)}%`
                : "—"
            }
            sub="Fully paid / total upfront"
            icon={ArrowRight}
            loading={isLoading}
          />
        </div>

        {/* ── Revenue trend chart ── */}
        <div>
          <h3 className="text-sm font-semibold mb-3 text-muted-foreground uppercase tracking-wide">
            Upfront Revenue Trend
          </h3>
          <p className="text-xs text-muted-foreground mb-3">
            Total bars = all upfront collected&nbsp;&nbsp;·&nbsp;&nbsp;Net bars = fully paid upfront only
          </p>
          {isLoading ? (
            <Skeleton className="h-[260px] w-full" />
          ) : (
            <FinancialInsightsChart data={chartData} />
          )}
        </div>

        {/* ── Upfront by company & plan duration ── */}
        <div className="grid gap-6 xl:grid-cols-2">
          <div>
            <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
              <Building2 className="h-4 w-4 text-muted-foreground" />
              Upfront by Company
            </h3>
            <RowList
              rows={upfrontByCompany}
              loading={isLoading}
              emptyText="No upfront data available."
            />
          </div>

          <div>
            <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
              <CalendarDays className="h-4 w-4 text-muted-foreground" />
              Upfront by Plan Duration
            </h3>
            <RowList
              rows={upfrontByPlan}
              loading={isLoading}
              emptyText="No plan duration data available."
            />
          </div>
        </div>

      </CardContent>
    </Card>
  );
}
