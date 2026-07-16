"use client";

import { useMemo, useState } from "react";
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
import { isClientExcludedStatus } from "@/lib/utils/client-history";



const currencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

/**
 * Every payment amount in this system is entered in whole dollars. When a
 * stray record carries a fractional value (e.g. a contract amount stored as
 * 23999.99 instead of 24000), it drags the company Total off by cents and
 * shows up as "$23,999.99". Round each amount to the nearest dollar as it is
 * summed so one bad record can't corrupt the aggregate.
 */
function toWholeDollars(value: number): number {
  return Math.round(Number.isFinite(value) ? value : 0);
}

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
  total: number; // leadAmount - full contract amount from lead
  upfront: number; // upfrontAmount - portion paid upfront
  pending: number; // collected via followup payments shown under company summary
  remaining: number; // total - upfront - pending
  count: number;
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

export function PaymentsSection({
  records,
  isLoading,
  rangeLabel,
  dateFilter,
  technicalPaymentsTotal = 0,
}: PaymentsSectionProps) {
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
        const recordDate =
          toComparableIsoDate(r.closedAt) || toComparableIsoDate(r.createdAt);
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
        upfront: 0,
        pending: 0,
        remaining: 0,
        count: 0,
      };
      const followupsCollected = Math.max(0, r.followupsTotal ?? 0);

      ex.pending += followupsCollected;

      if (r.isFollowupOnly) {
        map.set(key, ex);
        continue;
      }

      // Exclude records whose lead was marked backout or not-interested —
      // those aren't genuine clients and their amounts shouldn't inflate the
      // company totals. Note: we no longer require `isClosed === true` here
      // because a record in the client_payments collection is by definition a
      // real client engagement, even if the lead's isClosed flag wasn't set.
      if (isClientExcludedStatus(r.leadStatus)) {
        map.set(key, ex);
        continue;
      }

      // Every legitimate amount in this system is whole-dollar. A stray
      // record carrying cents (e.g. a leadAmount of 23999.99) would drag the
      // aggregate off a clean total and show a spurious ".99". Round each
      // amount to the nearest dollar as it is summed so one fractional record
      // can't corrupt the company total.
      const leadAmount = Math.round(r.leadAmount ?? 0);
      const upfront = Math.round(r.upfrontAmount ?? 0);
      // Remaining = contract total - upfront - followup collections.
      const remaining = Math.max(0, leadAmount - upfront - followupsCollected);
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
          pending: acc.pending + row.pending,
          remaining: acc.remaining + row.remaining,
          count: acc.count + row.count,
        }),
        {
          total: 0,
          upfront: 0,
          pending: 0,
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
              {rangeLabel
                ? `${rangeLabel} — by company`
                : "All-time by company + per-month received"}
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
                    <th className="py-2 px-4 font-medium text-right">
                      Upfront
                    </th>
                    <th className="py-2 px-4 font-medium text-right">
                      Pending
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
                      className={`border-b border-[var(--hairline-soft)] last:border-0 ${row.company === "Technical payments" ? "italic text-muted-foreground" : ""}`}>
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
                      <td className="py-2 px-4 text-right tabular-nums text-blue-700">
                        {currencyFormatter.format(row.pending)}
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
                    <td className="py-2 px-4 text-right tabular-nums text-blue-700">
                      {currencyFormatter.format(grandTotals.pending)}
                    </td>
                    <td className="py-2 pl-4 text-right tabular-nums text-amber-700">
                      {currencyFormatter.format(grandTotals.remaining)}
                    </td>
                  </tr>
                  <tr className="border-t border-[var(--hairline-soft)] font-semibold text-blue-700">
                    <td colSpan={3} className="py-2 pr-4">
                      Technical paid (Assessments & Interviews)
                    </td>
                    <td className="py-2 px-4 text-right tabular-nums">
                      {currencyFormatter.format(technicalPaymentsTotal)}
                    </td>
                    <td colSpan={2}></td>
                  </tr>
                  <tr className="border-t-2 border-[var(--hairline)] font-bold text-emerald-700">
                    <td colSpan={3} className="py-2 pr-4">
                      Total Revenue (Upfront + Pending + Technical)
                    </td>
                    <td className="py-2 px-4 text-right tabular-nums">
                      {currencyFormatter.format(
                        grandTotals.upfront + technicalPaymentsTotal,
                      )}
                    </td>
                    <td className="py-2 px-4 text-right tabular-nums">
                      {currencyFormatter.format(grandTotals.pending)}
                    </td>
                    <td className="py-2 pl-4 text-right tabular-nums">
                      {currencyFormatter.format(
                        grandTotals.upfront +
                          grandTotals.pending +
                          technicalPaymentsTotal,
                      )}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
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
