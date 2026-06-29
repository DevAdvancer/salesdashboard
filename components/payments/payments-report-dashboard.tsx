"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw, Search } from "lucide-react";
import type { User } from "@/lib/types";
import type { PaymentsReportRow } from "@/app/actions/client-payments";
import { listPaymentsReport } from "@/lib/services/client-payment-service";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { DateRangePicker } from "@/components/ui/date-picker";
import { PaymentsReportSidebar } from "./payments-report-sidebar";

type StatusFilter = "all" | "partially_paid" | "fully_paid";

const FILTERS: { key: StatusFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "partially_paid", label: "Partially Paid" },
  { key: "fully_paid", label: "Fully Paid" },
];

const currency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

const dateFormatter = new Intl.DateTimeFormat(undefined, {
  year: "numeric",
  month: "short",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

function statusBadgeVariant(status: string) {
  if (status === "fully_paid") return "active" as const;
  if (status === "partially_paid") return "default" as const;
  return "inactive" as const;
}

function statusLabel(status: string) {
  if (status === "fully_paid") return "Fully Paid";
  if (status === "partially_paid") return "Partially Paid";
  return "Not Paid";
}

export function PaymentsReportDashboard({ user }: { user: User }) {
  const router = useRouter();
  const [rows, setRows] = useState<PaymentsReportRow[]>([]);
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [range, setRange] = useState<{ from?: string; to?: string }>(() => {
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, "0");
    const dd = String(today.getDate()).padStart(2, "0");
    const todayStr = `${yyyy}-${mm}-${dd}`;
    return { from: todayStr, to: todayStr };
  });
  const [companySearch, setCompanySearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await listPaymentsReport({
        actorId: user.$id,
        dateFrom: range.from,
        dateTo: range.to,
      });
      setRows(data);
    } catch (err) {
      console.error("Failed to load payments report:", err);
      setError(
        err instanceof Error ? err.message : "Failed to load payments report.",
      );
      setRows([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    queueMicrotask(() => {
      void load();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user.$id, range.from, range.to]);

  const sorted = useMemo(() => {
    return [...rows].sort((a, b) => {
      const aTime = a.lastUpdate?.createdAt ?? a.createdAt;
      const bTime = b.lastUpdate?.createdAt ?? b.createdAt;
      const timeDelta = new Date(bTime).getTime() - new Date(aTime).getTime();
      if (timeDelta !== 0) return timeDelta;
      return a.company.localeCompare(b.company);
    });
  }, [rows]);

  const filtered = useMemo(() => {
    let result = sorted;
    if (filter !== "all") {
      result = result.filter((r) => r.status === filter);
    }
    if (companySearch.trim()) {
      const search = companySearch.toLowerCase().trim();
      result = result.filter((r) =>
        (r.company || "").toLowerCase().includes(search)
      );
    }
    return result;
  }, [sorted, filter, companySearch]);

  const summary = useMemo(() => {
    let amountPaid = 0;
    let amountPaidCount = 0;
    let totalAmount = 0;
    for (const r of filtered) {
      // Compute the amount collected for this record. Priority:
      // 1) the running total of all update `amount` values;
      // 2) the last update's `amount` (legacy records);
      // 3) the planned `upfrontAmount` from the payment plan (covers
      //    records that have a plan but no amount logged yet — every
      //    record in the report has an upfront plan, so the card
      //    "Upfront (collected)" always reflects the full upfront value).
      let rowPaid = 0;
      let rowPaidCount = 0;
      if (typeof r.totalPaid === "number" && Number.isFinite(r.totalPaid)) {
        rowPaid = r.totalPaid;
        rowPaidCount = r.paidUpdateCount;
      } else if (r.lastUpdate?.amount != null) {
        rowPaid = r.lastUpdate.amount;
        rowPaidCount = 1;
      } else if (
        typeof r.paymentPlan?.upfrontAmount === "number" &&
        Number.isFinite(r.paymentPlan.upfrontAmount) &&
        r.paymentPlan.upfrontAmount > 0
      ) {
        rowPaid = r.paymentPlan.upfrontAmount;
        rowPaidCount = 1;
      }
      amountPaid += rowPaid;
      amountPaidCount += rowPaidCount;
      totalAmount += r.leadAmount;
    }
    return {
      count: filtered.length,
      amountPaid,
      amountPaidCount,
      totalAmount,
    };
  }, [filtered]);

  return (
    <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
      <PaymentsReportSidebar rows={rows} />
      <div className="space-y-6">
        <Card>
          <CardHeader className="space-y-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
                <div className="w-full sm:w-72">
                  <DateRangePicker value={range} onChange={setRange} />
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {FILTERS.map((f) => (
                    <Button
                      key={f.key}
                      type="button"
                      size="sm"
                      variant={filter === f.key ? "default" : "outline"}
                      aria-pressed={filter === f.key}
                      onClick={() => setFilter(f.key)}
                      disabled={loading}>
                      {f.label}
                    </Button>
                  ))}
                </div>
                <div className="relative min-w-[180px]">
                  <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Filter by company..."
                    value={companySearch}
                    onChange={(e) => setCompanySearch(e.target.value)}
                    className="pl-9"
                  />
                </div>
              </div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => void load()}
                disabled={loading}>
                <RefreshCw
                  className={
                    loading ? "mr-2 h-4 w-4 animate-spin" : "mr-2 h-4 w-4"
                  }
                />
                Refresh
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {error ? (
              <div
                role="alert"
                className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
                {error}
              </div>
            ) : null}

            <p className="text-xs text-muted-foreground">
              Date range filters the report by client closing date.
            </p>

            <div className="grid gap-3 md:grid-cols-3">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    Records
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-2xl font-semibold">{summary.count}</p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    Total Amount
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-2xl font-semibold">
                    {currency.format(summary.totalAmount)}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Sum of all lead totals
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    Upfront (collected)
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-2xl font-semibold">
                    {currency.format(summary.amountPaid)}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Across {summary.amountPaidCount} update
                    {summary.amountPaidCount === 1 ? "" : "s"}
                  </p>
                </CardContent>
              </Card>
            </div>

            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Company</TableHead>
                    <TableHead>Legal Name</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead className="text-right">Upfront</TableHead>
                    <TableHead className="text-right">Paid</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Closed Date</TableHead>
                    <TableHead>Last Update</TableHead>
                    <TableHead>Updated By</TableHead>
                    <TableHead>Last Update Note</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loading ? (
                    <TableRow>
                      <TableCell
                        colSpan={10}
                        className="text-center text-sm text-muted-foreground">
                        Loading payments report…
                      </TableCell>
                    </TableRow>
                  ) : rows.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={10}
                        className="text-center text-sm text-muted-foreground">
                        No payment records found.
                      </TableCell>
                    </TableRow>
                  ) : filtered.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={10}
                        className="text-center text-sm text-muted-foreground">
                        No records for the selected filter.
                      </TableCell>
                    </TableRow>
                  ) : (
                    filtered.map((row) => (
                      <TableRow
                        key={row.$id}
                        role="button"
                        tabIndex={0}
                        onClick={() => router.push(`/client/${row.leadId}`)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            router.push(`/client/${row.leadId}`);
                          }
                        }}
                        className="cursor-pointer hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                        <TableCell className="font-medium">
                          {row.company || "Unknown"}
                        </TableCell>
                        <TableCell className="font-medium">
                          {row.legalName || "—"}
                        </TableCell>
                        <TableCell className="text-right font-medium">
                          {currency.format(row.leadAmount)}
                        </TableCell>
                        <TableCell className="text-right">
                          {currency.format(row.paymentPlan.upfrontAmount)}
                        </TableCell>
                        <TableCell className="text-right font-medium">
                          {typeof row.totalPaid === "number"
                            ? currency.format(row.totalPaid)
                            : "—"}
                        </TableCell>
                        <TableCell>
                          <Badge variant={statusBadgeVariant(row.status)}>
                            {statusLabel(row.status)}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          {row.closedAt
                            ? dateFormatter.format(new Date(row.closedAt))
                            : "—"}
                        </TableCell>
                        <TableCell>
                          {row.lastUpdate?.createdAt
                            ? dateFormatter.format(
                                new Date(row.lastUpdate.createdAt),
                              )
                            : "—"}
                        </TableCell>
                        <TableCell>
                          {row.lastUpdate?.actorName ?? "—"}
                        </TableCell>
                        <TableCell className="max-w-[320px]">
                          <p className="line-clamp-2 whitespace-pre-wrap break-words text-sm text-muted-foreground">
                            {row.lastUpdate?.note ?? "—"}
                          </p>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
