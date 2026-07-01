"use client";

import { useMemo, useState } from "react";
import dynamic from "next/dynamic";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { PaymentInsightRecord } from "@/app/actions/client-payments";
import type { PaymentStatus } from "@/lib/types";

const FinancialInsightsChart = dynamic(
  () =>
    import("@/components/dashboard/financial-insights-chart").then(
      (m) => m.FinancialInsightsChart,
    ),
  { loading: () => <Skeleton className="h-[300px] w-full" />, ssr: false },
);

const currencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

const STATUS_FILTERS: { value: "all" | PaymentStatus; label: string }[] = [
  { value: "all", label: "All" },
  { value: "fully_paid", label: "Fully paid" },
  { value: "partially_paid", label: "Partially paid" },
  { value: "not_paid", label: "Not paid" },
];

/** Known company values that the dashboard should offer as filter chips. */
const KNOWN_COMPANIES = [
  "Silverspace INC",
  "Vizva INC",
  "Flawless-ED",
] as const;
type KnownCompany = (typeof KNOWN_COMPANIES)[number];

type CompanyFilter = "all" | KnownCompany;

function normalizeCompanyKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ");
}

function canonicalCompanyName(value: string): string {
  const normalized = normalizeCompanyKey(value);
  const known = KNOWN_COMPANIES.find(
    (company) => normalizeCompanyKey(company) === normalized,
  );
  return known ?? value.trim();
}

function matchesCompany(recordCompany: string, filter: CompanyFilter): boolean {
  if (filter === "all") return true;
  return (
    normalizeCompanyKey(recordCompany ?? "") === normalizeCompanyKey(filter)
  );
}

interface PaymentsSectionProps {
  records: PaymentInsightRecord[];
  isLoading: boolean;
  rangeLabel?: string;
}

interface CompanyRow {
  company: string;
  total: number;
  paid: number;
  remaining: number;
  count: number;
}

function toMonthKey(iso: string): {
  key: string;
  monthStart: number;
  sortKey: string;
} {
  const d = new Date(iso);
  const key = d.toLocaleString("en-US", { month: "short", year: "numeric" });
  const monthStart = new Date(d.getFullYear(), d.getMonth(), 1).getTime();
  const sortKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  return { key, monthStart, sortKey };
}

function resolvePaidAmount(
  record: Pick<PaymentInsightRecord, "totalPaid" | "status" | "upfrontAmount">,
): number {
  return (
    record.totalPaid ??
    (record.status === "fully_paid" ? record.upfrontAmount : 0)
  );
}

export function buildMonthlyPaymentsChartData(
  records: Array<
    Pick<
      PaymentInsightRecord,
      "closedAt" | "totalPaid" | "status" | "upfrontAmount"
    >
  >,
): Array<{ name: string; Total: number; Net: number }> {
  const map = new Map<
    string,
    { total: number; monthStart: number; sortKey: string }
  >();

  for (const record of records) {
    if (!record.closedAt) continue;
    const { key, monthStart, sortKey } = toMonthKey(record.closedAt);
    const ex = map.get(key) ?? { total: 0, monthStart, sortKey };
    ex.total += resolvePaidAmount(record);
    map.set(key, ex);
  }

  return Array.from(map.entries())
    .sort((a, b) => a[1].sortKey.localeCompare(b[1].sortKey))
    .slice(-12)
    .map(([name, d]) => ({ name, Total: d.total, Net: 0 }));
}

function statusVariant(status: PaymentStatus) {
  if (status === "fully_paid") return "active" as const;
  if (status === "partially_paid") return "default" as const;
  return "inactive" as const;
}

export function PaymentsSection({ records, isLoading, rangeLabel }: PaymentsSectionProps) {
  const [statusFilter, setStatusFilter] = useState<"all" | PaymentStatus>(
    "all",
  );
  const [companyFilter, setCompanyFilter] = useState<CompanyFilter>("all");

  // Filter records by company first, then status.
  const companyFiltered = useMemo(
    () => records.filter((r) => matchesCompany(r.company, companyFilter)),
    [records, companyFilter],
  );

  const filteredRecords = useMemo(() => {
    if (statusFilter === "all") return companyFiltered;
    return companyFiltered.filter((r) => r.status === statusFilter);
  }, [companyFiltered, statusFilter]);

  // Per-month chart data is also scoped to the company filter (status filter
  // intentionally does not affect it — the chart shows total received,
  // grouped by the client closing month instead of payment entry date.
  const monthlyChartData = useMemo(() => {
    return buildMonthlyPaymentsChartData(companyFiltered);
  }, [companyFiltered]);

  // Group by company — all time
  const companyRows = useMemo<CompanyRow[]>(() => {
    const map = new Map<string, CompanyRow>();
    for (const r of filteredRecords) {
      const displayCompany = r.company?.trim()
        ? canonicalCompanyName(r.company)
        : "Unspecified";
      const key = normalizeCompanyKey(displayCompany || "Unspecified");
      const ex = map.get(key) ?? {
        company: displayCompany || "Unspecified",
        total: 0,
        paid: 0,
        remaining: 0,
        count: 0,
      };
      const upfront = r.upfrontAmount ?? 0;
      // Use the real amount actually collected when available; otherwise
      // treat the planned upfront as the contract value for the record.
      const paid = resolvePaidAmount(r);
      ex.total += upfront;
      ex.paid += paid;
      ex.remaining += Math.max(0, upfront - paid);
      ex.count += 1;
      map.set(key, ex);
    }
    return Array.from(map.values()).sort((a, b) => b.total - a.total);
  }, [filteredRecords]);

  const grandTotals = useMemo(
    () =>
      companyRows.reduce(
        (acc, row) => ({
          total: acc.total + row.total,
          paid: acc.paid + row.paid,
          remaining: acc.remaining + row.remaining,
          count: acc.count + row.count,
        }),
        { total: 0, paid: 0, remaining: 0, count: 0 },
      ),
    [companyRows],
  );

  // Per-month chart data is scoped to the company filter (status filter
  // intentionally does not affect it — the chart shows total received).

  return (
    <Card id="tour-payments-section">
      <CardHeader>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle className="text-base sm:text-lg">Payments</CardTitle>
            <CardDescription>
              {rangeLabel ? `${rangeLabel} — by company` : "All-time by company + per-month received"}
            </CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {/* Company dropdown */}
            <select
              value={companyFilter}
              onChange={(e) =>
                setCompanyFilter(e.target.value as CompanyFilter)
              }
              className="h-8 rounded-full border border-[var(--hairline)] bg-[var(--soft-cloud)] px-3 pr-7 text-xs font-medium leading-none transition-colors hover:border-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--ink)]/20"
              aria-label="Filter by company">
              <option value="all">All companies</option>
              {KNOWN_COMPANIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            {/* Status filter chips */}
            <div className="flex flex-wrap items-center gap-1 rounded-full border border-[var(--hairline)] bg-[var(--soft-cloud)] p-1">
              {STATUS_FILTERS.map((filter) => {
                const active = statusFilter === filter.value;
                return (
                  <button
                    key={filter.value}
                    type="button"
                    onClick={() => setStatusFilter(filter.value)}
                    className={cn(
                      "rounded-full px-3 py-1 text-xs font-medium transition-colors",
                      active
                        ? "bg-[var(--ink)] text-[var(--canvas)]"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                    aria-pressed={active}>
                    {filter.label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* All-time by-company table */}
        <div>
          <h4 className="mb-3 text-sm font-semibold">All-time by company</h4>
          {isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-9 w-full" />
              ))}
            </div>
          ) : companyRows.length === 0 ? (
            <div className="flex h-24 items-center justify-center rounded-md border border-dashed border-[var(--hairline)] text-sm text-[var(--mute)]">
              No payment records match this filter.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--hairline)] text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="py-2 pr-4 font-medium">Company</th>
                    <th className="py-2 px-4 font-medium text-right">
                      Records
                    </th>
                    <th className="py-2 px-4 font-medium text-right">Total</th>
                    <th className="py-2 px-4 font-medium text-right">Paid</th>
                    <th className="py-2 pl-4 font-medium text-right">
                      Remaining
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {companyRows.map((row) => (
                    <tr
                      key={row.company}
                      className="border-b border-[var(--hairline-soft)] last:border-0">
                      <td className="py-2 pr-4 font-medium">{row.company}</td>
                      <td className="py-2 px-4 text-right tabular-nums">
                        {row.count}
                      </td>
                      <td className="py-2 px-4 text-right tabular-nums">
                        {currencyFormatter.format(row.total)}
                      </td>
                      <td className="py-2 px-4 text-right tabular-nums text-emerald-700">
                        {currencyFormatter.format(row.paid)}
                      </td>
                      <td className="py-2 pl-4 text-right tabular-nums text-amber-700">
                        {currencyFormatter.format(row.remaining)}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-[var(--hairline)] font-semibold">
                    <td className="py-2 pr-4">Grand total</td>
                    <td className="py-2 px-4 text-right tabular-nums">
                      {grandTotals.count}
                    </td>
                    <td className="py-2 px-4 text-right tabular-nums">
                      {currencyFormatter.format(grandTotals.total)}
                    </td>
                    <td className="py-2 px-4 text-right tabular-nums text-emerald-700">
                      {currencyFormatter.format(grandTotals.paid)}
                    </td>
                    <td className="py-2 pl-4 text-right tabular-nums text-amber-700">
                      {currencyFormatter.format(grandTotals.remaining)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>

        {/* Per-month chart */}
        <div>
          <h4 className="mb-3 text-sm font-semibold">
            Per-month by client close date (last 12 months)
          </h4>
          <p className="mb-2 text-xs text-muted-foreground">
            Sums the paid amounts, grouped by the client closing month.
          </p>
          {isLoading ? (
            <Skeleton className="h-[300px] w-full" />
          ) : (
            <FinancialInsightsChart data={monthlyChartData} />
          )}
        </div>

        {/* Status mix badges */}
        {!isLoading && records.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span>Status mix:</span>
            {(
              ["fully_paid", "partially_paid", "not_paid"] as PaymentStatus[]
            ).map((status) => {
              const count = records.filter((r) => r.status === status).length;
              return (
                <Badge key={status} variant={statusVariant(status)}>
                  {status.replace("_", " ")}: {count}
                </Badge>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
