"use client";

import { useEffect, useState, useMemo, useRef } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/lib/contexts/auth-context";
import { ProtectedRoute } from "@/components/protected-route";
import {
  listTechnicalPaymentsAction,
  type TechnicalPaymentSummary,
} from "@/app/actions/technical-payments";
import {
  Calendar,
  Download,
  Search,
  TrendingUp,
  Users,
  FileText,
  Briefcase,
  DollarSign,
  ArrowUpDown,
  ChevronDown,
  Check,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { getTodayEst, getMonthStartEst } from "@/lib/utils/est-date";

const currencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function toIsoDate(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function dateRangePresets() {
  const today = getTodayEst();
  const nowEst = new Date();
  const estParts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
  }).formatToParts(nowEst);
  const dayOfWeekStr = estParts.find((p) => p.type === "weekday")?.value ?? "Sun";
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const dayIndex = days.indexOf(dayOfWeekStr);
  const startOfWeekMs = nowEst.getTime() - dayIndex * 24 * 60 * 60 * 1000;
  const startOfWeek = toIsoDate(new Date(startOfWeekMs));
  const startOfMonth = getMonthStartEst();
  return [
    { label: "Today", from: today, to: today },
    { label: "This Week", from: startOfWeek, to: today },
    { label: "This Month", from: startOfMonth, to: today },
    { label: "All Time", from: "", to: "" },
  ];
}

type TypeFilter = "all" | "assessment" | "interview";
type SortField = "date" | "type" | "lead" | "agent" | "amount";
type SortDir = "asc" | "desc";

// ---------------------------------------------------------------------------
// Custom inline Select component (avoids external dependency)
// ---------------------------------------------------------------------------

function CustomSelect({
  value,
  onChange,
  options,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handlePointer = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", handlePointer);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handlePointer);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open]);

  const selected = options.find((o) => o.value === value);

  return (
    <div ref={ref} className={`relative ${className ?? ""}`}>
      <button
        type="button"
        onClick={() => setOpen((p) => !p)}
        className="flex h-9 w-full items-center justify-between gap-2 rounded-xl border border-[var(--hairline)] bg-background px-3 text-sm transition-colors hover:border-[var(--ink)]/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ink)]/20"
      >
        <span>{selected?.label ?? value}</span>
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-150 ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open && (
        <div className="absolute left-0 top-full z-50 mt-1 w-full overflow-hidden rounded-xl border border-[var(--hairline)] bg-popover shadow-xl">
          {options.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => {
                onChange(opt.value);
                setOpen(false);
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-sm transition-colors hover:bg-[var(--soft-cloud)]"
            >
              <Check
                className={`h-3.5 w-3.5 shrink-0 ${opt.value === value ? "opacity-100" : "opacity-0"}`}
              />
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page component
// ---------------------------------------------------------------------------

function TechnicalPaymentsPage() {
  const { user, isAdmin, isMonitor, isOperations, isTeamLead } = useAuth();
  const isAdminLike = isAdmin || isMonitor || isOperations;
  const [payments, setPayments] = useState<TechnicalPaymentSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Filters
  const [dateFrom, setDateFrom] = useState(() => getMonthStartEst());
  const [dateTo, setDateTo] = useState(() => getTodayEst());
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [searchAgent, setSearchAgent] = useState("");
  const [companySearch, setCompanySearch] = useState("");
  const [sortField, setSortField] = useState<SortField>("date");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [showFilters, setShowFilters] = useState(false);

  useEffect(() => {
    const loadPayments = async () => {
      if (!user) return;
      try {
        setIsLoading(true);
        const data = await listTechnicalPaymentsAction(user.$id);
        setPayments(data);
      } catch (error) {
        console.error("Error loading payments:", error);
      } finally {
        setIsLoading(false);
      }
    };
    loadPayments();
  }, [user]);

  // Apply filters + sort
  const filtered = useMemo(() => {
    let result = payments.filter((p) => {
      if (typeFilter !== "all" && p.type !== typeFilter) return false;
      if (dateFrom && p.createdAt < dateFrom) return false;
      if (dateTo && p.createdAt > dateTo + "T23:59:59") return false;
      if (searchAgent && !p.userName.toLowerCase().includes(searchAgent.toLowerCase())) return false;
      if (companySearch && !p.leadName.toLowerCase().includes(companySearch.toLowerCase())) return false;
      return true;
    });

    result.sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case "date":
          cmp = new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
          break;
        case "type":
          cmp = a.type.localeCompare(b.type);
          break;
        case "lead":
          cmp = a.leadName.localeCompare(b.leadName);
          break;
        case "agent":
          cmp = a.userName.localeCompare(b.userName);
          break;
        case "amount":
          cmp = a.amount - b.amount;
          break;
      }
      return sortDir === "desc" ? -cmp : cmp;
    });

    return result;
  }, [payments, dateFrom, dateTo, typeFilter, searchAgent, companySearch, sortField, sortDir]);

  const totals = useMemo(() => {
    const assessment = filtered.filter((p) => p.type === "assessment").reduce((s, p) => s + p.amount, 0);
    const interview = filtered.filter((p) => p.type === "interview").reduce((s, p) => s + p.amount, 0);
    return { assessment, interview, total: assessment + interview, count: filtered.length };
  }, [filtered]);

  const presets = dateRangePresets();

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortDir("desc");
    }
  };

  const clearFilters = () => {
    setDateFrom(getMonthStartEst());
    setDateTo(getTodayEst());
    setTypeFilter("all");
    setSearchAgent("");
    setCompanySearch("");
  };

  const hasCustomFilters = typeFilter !== "all" || searchAgent || companySearch;

  const handleExport = () => {
    const headers = ["Date", "Type", "Lead", "Email", "Agent", "Amount"];
    const rows = filtered.map((p) => [
      formatDate(p.createdAt),
      p.type,
      p.leadName,
      p.leadEmail,
      p.userName,
      p.amount.toString(),
    ]);
    const csv = [headers, ...rows].map((r) => r.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `technical-payments-${dateFrom || "all"}-to-${dateTo || "all"}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const SortButton = ({ field, children }: { field: SortField; children: React.ReactNode }) => (
    <button
      onClick={() => handleSort(field)}
      className="flex items-center gap-1 transition-colors hover:text-foreground"
    >
      {children}
      <ArrowUpDown
        className={`h-3 w-3 transition-opacity ${sortField === field ? "opacity-60" : "opacity-20"}`}
      />
    </button>
  );

  if (isLoading) {
    return (
      <div className="space-y-6 p-4 md:p-6">
        {/* Header skeleton */}
        <div className="flex items-center justify-between">
          <div className="space-y-2">
            <div className="h-8 w-64 rounded-xl bg-muted animate-pulse" />
            <div className="h-4 w-80 rounded-lg bg-muted animate-pulse" />
          </div>
          <div className="h-9 w-32 rounded-xl bg-muted animate-pulse" />
        </div>
        {/* Stat cards skeleton */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-28 rounded-2xl bg-muted animate-pulse" />
          ))}
        </div>
        {/* Table skeleton */}
        <div className="h-96 rounded-2xl bg-muted animate-pulse" />
      </div>
    );
  }

  return (
    <div className="space-y-6 p-4 md:p-6">

      {/* ── Header ─────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight">
            Technical Payments
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Assessment &amp; Interview upfront collections
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={handleExport}
          className="gap-2 self-start rounded-xl"
        >
          <Download className="h-4 w-4" />
          Export CSV
        </Button>
      </div>

      {/* ── KPI Cards ──────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Transactions */}
        <div className="group relative overflow-hidden rounded-2xl border border-[var(--hairline)] bg-card p-5 shadow-sm transition-shadow hover:shadow-md">
          <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
            <div className="flex h-7 w-7 items-center justify-center rounded-full bg-muted">
              <FileText className="h-3.5 w-3.5" />
            </div>
            Transactions
          </div>
          <div className="mt-3 text-3xl font-bold tabular-nums">{totals.count}</div>
          <div className="mt-1 text-xs text-muted-foreground">
            of {payments.length} total
          </div>
          <div className="absolute inset-x-0 bottom-0 h-0.5 bg-gradient-to-r from-transparent via-[var(--hairline)] to-transparent" />
        </div>

        {/* Assessment */}
        <div className="group relative overflow-hidden rounded-2xl border border-blue-200/60 bg-gradient-to-br from-blue-50/80 to-blue-100/30 p-5 shadow-sm transition-shadow hover:shadow-md dark:border-blue-800/40 dark:from-blue-950/40 dark:to-blue-900/20">
          <div className="flex items-center gap-2 text-xs font-medium text-blue-700 dark:text-blue-400">
            <div className="flex h-7 w-7 items-center justify-center rounded-full bg-blue-100 dark:bg-blue-900/50">
              <Briefcase className="h-3.5 w-3.5" />
            </div>
            Assessment
          </div>
          <div className="mt-3 text-3xl font-bold tabular-nums text-blue-800 dark:text-blue-300">
            {currencyFormatter.format(totals.assessment)}
          </div>
          <div className="mt-1 text-xs text-blue-600/70 dark:text-blue-400/70">
            {filtered.filter((p) => p.type === "assessment").length} payments
          </div>
        </div>

        {/* Interview */}
        <div className="group relative overflow-hidden rounded-2xl border border-violet-200/60 bg-gradient-to-br from-violet-50/80 to-violet-100/30 p-5 shadow-sm transition-shadow hover:shadow-md dark:border-violet-800/40 dark:from-violet-950/40 dark:to-violet-900/20">
          <div className="flex items-center gap-2 text-xs font-medium text-violet-700 dark:text-violet-400">
            <div className="flex h-7 w-7 items-center justify-center rounded-full bg-violet-100 dark:bg-violet-900/50">
              <Users className="h-3.5 w-3.5" />
            </div>
            Interview
          </div>
          <div className="mt-3 text-3xl font-bold tabular-nums text-violet-800 dark:text-violet-300">
            {currencyFormatter.format(totals.interview)}
          </div>
          <div className="mt-1 text-xs text-violet-600/70 dark:text-violet-400/70">
            {filtered.filter((p) => p.type === "interview").length} payments
          </div>
        </div>

        {/* Grand Total */}
        <div className="group relative overflow-hidden rounded-2xl border border-emerald-700/50 bg-gradient-to-br from-emerald-950/30 to-emerald-900/10 p-5 shadow-sm transition-shadow hover:shadow-md">
          <div className="flex items-center gap-2 text-xs font-medium text-emerald-400">
            <div className="flex h-7 w-7 items-center justify-center rounded-full bg-emerald-950/40 border border-emerald-700/40">
              <DollarSign className="h-3.5 w-3.5" />
            </div>
            Total Collected
          </div>
          <div className="mt-3 text-3xl font-bold tabular-nums text-emerald-400">
            {currencyFormatter.format(totals.total)}
          </div>
          <div className="mt-1 text-xs text-emerald-400/60">
            avg {totals.count > 0 ? currencyFormatter.format(totals.total / totals.count) : "$0"}
          </div>
          {/* Subtle glow */}
          <div className="pointer-events-none absolute -right-4 -bottom-4 h-20 w-20 rounded-full bg-emerald-500/10 blur-2xl" />
        </div>
      </div>

      {/* ── Filter Bar ─────────────────────────────────────────────── */}
      <div className="rounded-2xl border border-[var(--hairline)] bg-card shadow-sm">
        {/* Date preset row */}
        <div className="flex flex-wrap items-center gap-2 p-4 border-b border-[var(--hairline)]">
          <Calendar className="h-4 w-4 text-muted-foreground shrink-0" />

          {/* Preset chips */}
          <div className="flex flex-wrap gap-1.5">
            {presets.map((preset) => {
              const active = dateFrom === preset.from && dateTo === preset.to;
              return (
                <button
                  key={preset.label}
                  onClick={() => {
                    setDateFrom(preset.from);
                    setDateTo(preset.to);
                  }}
                  className={`rounded-full px-3.5 py-1.5 text-xs font-medium transition-all ${
                    active
                      ? "bg-[var(--ink)] text-[var(--canvas)] shadow-sm"
                      : "bg-muted text-muted-foreground hover:bg-muted/70 hover:text-foreground"
                  }`}
                >
                  {preset.label}
                </button>
              );
            })}
          </div>

          {/* Custom date inputs */}
          <div className="flex items-center gap-2 ml-1">
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="h-8 rounded-lg border border-[var(--hairline)] bg-background px-2.5 text-xs focus:outline-none focus:ring-2 focus:ring-[var(--ink)]/20"
            />
            <span className="text-xs text-muted-foreground">→</span>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="h-8 rounded-lg border border-[var(--hairline)] bg-background px-2.5 text-xs focus:outline-none focus:ring-2 focus:ring-[var(--ink)]/20"
            />
          </div>

          {/* Filters toggle */}
          <button
            onClick={() => setShowFilters((p) => !p)}
            className={`ml-auto flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-medium transition-colors ${
              showFilters || hasCustomFilters
                ? "border-[var(--ink)] bg-[var(--ink)] text-[var(--canvas)]"
                : "border-[var(--hairline)] hover:border-[var(--ink)]/40"
            }`}
          >
            <SlidersHorizontal className="h-3.5 w-3.5" />
            Filters
            {hasCustomFilters && (
              <span className="flex h-4 w-4 items-center justify-center rounded-full bg-white/20 text-[10px]">
                •
              </span>
            )}
          </button>
        </div>

        {/* Expanded filter row */}
        {showFilters && (
          <div className="flex flex-wrap items-center gap-3 p-4">
            {/* Type filter */}
            <CustomSelect
              value={typeFilter}
              onChange={(v) => setTypeFilter(v as TypeFilter)}
              options={[
                { value: "all", label: "All Types" },
                { value: "assessment", label: "Assessment" },
                { value: "interview", label: "Interview" },
              ]}
              className="w-36"
            />

            {/* Agent search */}
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                type="text"
                placeholder="Search agent…"
                value={searchAgent}
                onChange={(e) => setSearchAgent(e.target.value)}
                className="h-9 rounded-xl pl-8 text-xs w-44"
              />
            </div>

            {/* Lead search */}
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                type="text"
                placeholder="Filter by lead…"
                value={companySearch}
                onChange={(e) => setCompanySearch(e.target.value)}
                className="h-9 rounded-xl pl-8 text-xs w-44"
              />
            </div>

            {hasCustomFilters && (
              <button
                onClick={clearFilters}
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors ml-auto"
              >
                <X className="h-3.5 w-3.5" />
                Clear filters
              </button>
            )}
          </div>
        )}
      </div>

      {/* ── Results header ─────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-1">
        <p className="text-sm text-muted-foreground">
          Showing{" "}
          <span className="font-semibold text-foreground">{filtered.length}</span> of{" "}
          {payments.length} transactions
          {(dateFrom || dateTo) && (
            <span className="ml-1 text-xs">
              ({dateFrom || "…"} → {dateTo || "…"})
            </span>
          )}
        </p>
        <div className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground text-xs">Filtered total:</span>
          <span className="font-bold text-emerald-500 tabular-nums">
            {currencyFormatter.format(totals.total)}
          </span>
        </div>
      </div>

      {/* ── Table ──────────────────────────────────────────────────── */}
      {filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-[var(--hairline)] py-20 text-muted-foreground">
          <TrendingUp className="h-10 w-10 opacity-20" />
          <p className="text-sm">No transactions found matching your filters.</p>
          <button
            onClick={clearFilters}
            className="text-xs underline underline-offset-4 hover:text-foreground transition-colors"
          >
            Clear all filters
          </button>
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-[var(--hairline)] bg-card shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--hairline)] bg-muted/30 text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="py-3 pl-5 pr-4 text-left font-medium">
                    <SortButton field="date">Date</SortButton>
                  </th>
                  <th className="py-3 px-4 text-left font-medium">
                    <SortButton field="type">Type</SortButton>
                  </th>
                  <th className="py-3 px-4 text-left font-medium">
                    <SortButton field="lead">Lead</SortButton>
                  </th>
                  <th className="py-3 px-4 text-left font-medium">Email</th>
                  <th className="py-3 px-4 text-left font-medium">
                    <SortButton field="agent">Agent</SortButton>
                  </th>
                  <th className="py-3 pr-5 pl-4 text-right font-medium">
                    <SortButton field="amount">Amount</SortButton>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--hairline)]">
                {filtered.map((payment) => (
                  <tr
                    key={payment.$id}
                    className="group transition-colors hover:bg-[var(--soft-cloud)]/40"
                  >
                    <td className="py-3 pl-5 pr-4 font-mono text-xs text-muted-foreground whitespace-nowrap">
                      {formatDate(payment.createdAt)}
                    </td>
                    <td className="py-3 px-4 whitespace-nowrap">
                      <span
                        className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${
                          payment.type === "assessment"
                            ? "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300"
                            : "bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-300"
                        }`}
                      >
                        {payment.type === "assessment" ? (
                          <Briefcase className="h-3 w-3" />
                        ) : (
                          <Users className="h-3 w-3" />
                        )}
                        {payment.type}
                      </span>
                    </td>
                    <td className="py-3 px-4 font-medium whitespace-nowrap">
                      {payment.leadName}
                    </td>
                    <td className="py-3 px-4 text-xs text-muted-foreground max-w-[200px] truncate whitespace-nowrap">
                      {payment.leadEmail || "—"}
                    </td>
                    <td className="py-3 px-4 whitespace-nowrap">
                      <span className="inline-flex items-center gap-1.5">
                        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-muted text-[10px] font-semibold uppercase">
                          {payment.userName?.charAt(0) ?? "?"}
                        </span>
                        {payment.userName}
                      </span>
                    </td>
                    <td className="py-3 pr-5 pl-4 text-right font-mono font-semibold whitespace-nowrap tabular-nums">
                      <span className="text-emerald-600 dark:text-emerald-400">
                        {currencyFormatter.format(payment.amount)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
              {/* Footer totals row */}
              <tfoot>
                <tr className="border-t-2 border-[var(--hairline)] bg-muted/20 text-xs font-semibold">
                  <td colSpan={5} className="py-3 pl-5 pr-4 text-muted-foreground">
                    {filtered.length} transactions in range
                  </td>
                  <td className="py-3 pr-5 pl-4 text-right font-mono tabular-nums text-emerald-600 dark:text-emerald-400">
                    {currencyFormatter.format(totals.total)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

export default function TechnicalPayments() {
  return (
    <ProtectedRoute componentKey="technical-payments">
      <TechnicalPaymentsPage />
    </ProtectedRoute>
  );
}
