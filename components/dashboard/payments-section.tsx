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
  dateFilter?: {
    from?: string;
    to?: string;
  };
  /** Total from assessment + interview technical payments for the selected period. */
  technicalPaymentsTotal?: number;
}

interface CompanyRow {
  company: string;
  total: number;    // leadAmount - full contract amount from lead
  upfront: number;  // upfrontAmount - portion paid upfront
  remaining: number; // total - upfront
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

export function buildMonthlyPaymentsChartData(
  records: Array<
    Pick<
      PaymentInsightRecord,
      "paidMonthlyAmounts" | "followupsMonthlyAmounts"
    >
  >,
): Array<{ name: string; Total: number; Net: number }> {
  const map = new Map<
    string,
    { total: number; monthStart: number; sortKey: string }
  >();

  for (const record of records) {
    // Sum all actual payments by the month they were received, not the month
    // the lead closed. This ensures revenue is attributed to the correct month.
    for (const [monthKey, amount] of Object.entries(record.paidMonthlyAmounts) as Array<[string, number]>) {
      if (!amount) continue;
      const { monthStart, sortKey } = toMonthKey(monthKey);
      const ex = map.get(monthKey) ?? { total: 0, monthStart, sortKey };
      ex.total += amount;
      map.set(monthKey, ex);
    }

    // Followup payments are attributed to the explicit followup payment date,
    // so they also contribute to the month they were actually received.
    for (const [monthKey, amount] of Object.entries(record.followupsMonthlyAmounts || {}) as Array<[string, number]>) {
      if (!amount) continue;
      const { monthStart, sortKey } = toMonthKey(monthKey);
      const ex = map.get(monthKey) ?? { total: 0, monthStart, sortKey };
      ex.total += amount;
      map.set(monthKey, ex);
    }
  }

  return Array.from(map.entries())
    .sort((a, b) => a[1].sortKey.localeCompare(b[1].sortKey))
    .slice(-12)
    .map(([name, d]) => ({ name, Total: d.total, Net: 0 }));
}

function toComparableIsoDate(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  // Handle YYYY-MM-DD date-only strings
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  // Handle ISO timestamps — extract the date portion
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

function formatMonthYear(monthKey: string): string {
  const year = monthKey.slice(0, 4);
  const month = monthKey.slice(5);
  return `${month}/${year}`;
}

function statusVariant(status: PaymentStatus) {
  if (status === "fully_paid") return "active" as const;
  if (status === "partially_paid") return "default" as const;
  return "inactive" as const;
}

function formatDate(dateString: string) {
  const date = new Date(dateString);
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function PaymentsSection({ records, isLoading, rangeLabel, dateFilter, technicalPaymentsTotal = 0 }: PaymentsSectionProps) {
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
    let recordsToFilter = companyFiltered;

    // Apply date range filter if provided
    if (dateFilter?.from || dateFilter?.to) {
      recordsToFilter = recordsToFilter.filter((r) => {
        const recordDate = toComparableIsoDate(r.closedAt) || toComparableIsoDate(r.createdAt);
        if (dateFilter.from) {
          if (recordDate && recordDate < dateFilter.from) return false;
        }
        if (dateFilter.to) {
          if (recordDate && recordDate > dateFilter.to) return false;
        }
        return true;
      });
    }

    if (statusFilter === "all") return recordsToFilter;
    return recordsToFilter.filter((r) => r.status === statusFilter);
  }, [companyFiltered, statusFilter, dateFilter]);

  // Per-month chart data is also scoped to the company filter (status filter
  // intentionally does not affect it — the chart shows total received,
  // grouped by the client closing month instead of payment entry date.
  const monthlyChartData = useMemo(() => {
    return buildMonthlyPaymentsChartData(companyFiltered);
  }, [companyFiltered]);

  // Group by company — all time
  const companyRows = useMemo<CompanyRow[]>(() => {
    const map = new Map<string, CompanyRow>();
    for (const r of filteredRecords.filter((record) => !record.isFollowupOnly)) {
      const displayCompany = r.company?.trim()
        ? canonicalCompanyName(r.company)
        : "Unspecified";
      const key = normalizeCompanyKey(displayCompany || "Unspecified");
      const ex = map.get(key) ?? {
        company: displayCompany || "Unspecified",
        total: 0,
        upfront: 0,
        remaining: 0,
        count: 0,
      };
      const leadAmount = r.leadAmount ?? 0;
      const upfront = r.upfrontAmount ?? 0;
      // Remaining = leadAmount - upfrontAmount. Follow-up payments cover this.
      const remaining = Math.max(0, leadAmount - upfront);
      ex.total += leadAmount;
      ex.upfront += upfront;
      ex.remaining += remaining;
      ex.count += 1;
      map.set(key, ex);
    }
    return Array.from(map.values()).sort((a, b) => b.total - a.total);
  }, [filteredRecords]);

  // Show only company rows in the main table
  const displayRows = companyRows;

  const grandTotals = useMemo(
    () =>
      displayRows.reduce(
        (acc, row) => ({
          total: acc.total + row.total,
          upfront: acc.upfront + row.upfront,
          remaining: acc.remaining + row.remaining,
          count: acc.count + row.count,
        }),
        {
          total: 0,
          upfront: 0,
          remaining: 0,
          count: 0,
        },
      ),
    [displayRows],
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
                    <th className="py-2 px-4 font-medium text-right">
                      Total
                    </th>
                    <th className="py-2 px-4 font-medium text-right">
                      Upfront
                    </th>
                    <th className="py-2 pl-4 font-medium text-right">
                      Remaining
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {displayRows.map((row) => (
                    <tr
                      key={row.company}
                      className={`border-b border-[var(--hairline-soft)] last:border-0 ${row.company === 'Technical payments' ? 'italic text-muted-foreground' : ''}`}>
                      <td className="py-2 pr-4 font-medium">{row.company}</td>
                      <td className="py-2 px-4 text-right tabular-nums">
                        {row.count}
                      </td>
                      <td className="py-2 px-4 text-right tabular-nums">
                        {currencyFormatter.format(row.total)}
                      </td>
                      <td className="py-2 px-4 text-right tabular-nums">
                        {currencyFormatter.format(row.upfront)}
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
                    <td className="py-2 px-4 text-right tabular-nums">
                      {currencyFormatter.format(grandTotals.upfront)}
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
            Per-month received (last 12 months)
          </h4>
          <p className="mb-2 text-xs text-muted-foreground">
            Revenue grouped by the month each payment was actually received.
          </p>
          {isLoading ? (
            <Skeleton className="h-[300px] w-full" />
          ) : (
            <FinancialInsightsChart data={monthlyChartData} />
          )}
        </div>

        {/* Payments by Person Table */}
        <div>
          <h4 className="mb-3 text-sm font-semibold">Payments by Person</h4>
          <p className="mb-2 text-xs text-muted-foreground">
            Shows what each person has paid: Technical Payments + Followups + Pending Amounts
          </p>
          {(() => {
            // Get all followup payment entries and add company info
            const allFollowups = records.flatMap(r =>
              (r.followupsPayments || []).map(fp => ({
                ...fp,
                company: fp.company || r.company,
              }))
            );

            // Group followups by person (userId) — we need to aggregate per user
            // Since we don't have userId in the followup records, show as a flat list for now
            if (allFollowups.length === 0 && !technicalPaymentsTotal) {
              return (
                <div className="flex h-24 items-center justify-center rounded-md border border-dashed border-[var(--hairline)] text-sm text-[var(--mute)]">
                  No payments by person to display
                </div>
              );
            }

            return (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[var(--hairline)] text-left text-xs uppercase tracking-wide text-muted-foreground">
                      <th className="py-2 pr-4 font-medium">Name</th>
                      <th className="py-2 px-4 font-medium">Type</th>
                      <th className="py-2 px-4 font-medium">Company</th>
                      <th className="py-2 px-4 font-medium">Candidate</th>
                      <th className="py-2 px-4 font-medium">Date</th>
                      <th className="py-2 px-4 font-medium">Remark</th>
                      <th className="py-2 pl-4 font-medium text-right">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {/* Technical payments row placeholder */}
                    {technicalPaymentsTotal ? (
                      <tr className="border-b border-[var(--hairline-soft)]">
                        <td className="py-2 pr-4 font-medium">Team</td>
                        <td className="py-2 px-4">
                          <Badge variant="default" className="bg-blue-100 text-blue-800">
                            Technical
                          </Badge>
                        </td>
                        <td className="py-2 px-4 text-muted-foreground">—</td>
                        <td className="py-2 px-4 text-muted-foreground">—</td>
                        <td className="py-2 px-4 text-muted-foreground">—</td>
                        <td className="py-2 px-4 text-muted-foreground">—</td>
                        <td className="py-2 pl-4 text-right font-mono font-medium">
                          {currencyFormatter.format(technicalPaymentsTotal)}
                        </td>
                      </tr>
                    ) : null}

                    {/* Followups payments rows */}
                    {allFollowups.map((fp, idx) => (
                      <tr
                        key={`followup-${fp.date}-${idx}`}
                        className="border-b border-[var(--hairline-soft)]"
                      >
                        <td className="py-2 pr-4 font-medium">
                          {/* TODO: Show person name when we have userId */}
                          —
                        </td>
                        <td className="py-2 px-4">
                          <Badge variant="default" className="bg-amber-100 text-amber-800">
                            Followup
                          </Badge>
                        </td>
                        <td className="py-2 px-4">{fp.company}</td>
                        <td className="py-2 px-4">{fp.candidateName}</td>
                        <td className="py-2 px-4 text-muted-foreground">
                          {fp.date ? formatDate(fp.date) : "—"}
                        </td>
                        <td className="py-2 px-4 text-muted-foreground truncate max-w-[200px]" title={fp.remark || ""}>
                          {fp.remark || "—"}
                        </td>
                        <td className="py-2 pl-4 text-right font-mono font-medium">
                          {currencyFormatter.format(fp.amount)}
                        </td>
                      </tr>
                    ))}

                    {/* Pending amounts per person */}
                    {records.filter(r => r.pendingTotal && r.pendingTotal > 0).map((record) => (
                      <tr
                        key={`pending-${record.leadId}`}
                        className="border-b border-[var(--hairline-soft)]"
                      >
                        <td className="py-2 pr-4 font-medium">—</td>
                        <td className="py-2 px-4">
                          <Badge variant="outline" className="bg-orange-100 text-orange-800">
                            Pending
                          </Badge>
                        </td>
                        <td className="py-2 px-4">{record.company}</td>
                        <td className="py-2 px-4 text-muted-foreground">
                          {record.latestPendingMonth ? formatMonthYear(record.latestPendingMonth) : "—"}
                        </td>
                        <td className="py-2 px-4 text-muted-foreground">—</td>
                        <td className="py-2 px-4 text-muted-foreground">
                          {record.paidMonthlyAmounts
                            ? (Object.entries(record.paidMonthlyAmounts) as Array<[string, number]>)
                                .map(([month, amt]) => `${formatMonthYear(month)}: ${currencyFormatter.format(amt)}`)
                                .join(', ')
                            : '—'}
                        </td>
                        <td className="py-2 pl-4 text-right font-mono font-medium text-amber-700">
                          {currencyFormatter.format(record.pendingTotal ?? 0)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          })()}
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
