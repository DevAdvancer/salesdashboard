"use client";

import { useEffect, useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/lib/contexts/auth-context";
import { ProtectedRoute } from "@/components/protected-route";
import {
  listTechnicalPaymentsAction,
  type TechnicalPaymentSummary,
} from "@/app/actions/technical-payments";
import { Calendar, Download, Filter, Search } from "lucide-react";

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function toIsoDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function dateRangePresets() {
  const today = new Date();
  const startOfWeek = new Date(today);
  startOfWeek.setDate(today.getDate() - today.getDay());
  const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
  return [
    { label: "Today", from: toIsoDate(today), to: toIsoDate(today) },
    { label: "This Week", from: toIsoDate(startOfWeek), to: toIsoDate(today) },
    { label: "This Month", from: toIsoDate(startOfMonth), to: toIsoDate(today) },
    { label: "All Time", from: "", to: "" },
  ];
}

type TypeFilter = "all" | "assessment" | "interview";
type ViewMode = "all" | "by-team" | "by-agent";

function TechnicalPaymentsPage() {
  const { user, isAdmin, isMonitor, isOperations, isTeamLead } = useAuth();
  const isAdminLike = isAdmin || isMonitor || isOperations;
  const [payments, setPayments] = useState<TechnicalPaymentSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Filters
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [searchAgent, setSearchAgent] = useState("");
  const [companySearch, setCompanySearch] = useState("");
  const [viewMode, setViewMode] = useState<ViewMode>("all");

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

  const isAdminScope = isAdminLike || isTeamLead;

  // Apply filters client-side
  const filtered = useMemo(() => {
    return payments.filter((p) => {
      if (typeFilter !== "all" && p.type !== typeFilter) return false;
      if (dateFrom && p.createdAt < dateFrom) return false;
      if (dateTo && p.createdAt > dateTo + "T23:59:59") return false;
      if (searchAgent && !p.userName.toLowerCase().includes(searchAgent.toLowerCase())) return false;
      if (companySearch && !p.leadName.toLowerCase().includes(companySearch.toLowerCase())) return false;
      return true;
    });
  }, [payments, dateFrom, dateTo, typeFilter, searchAgent, companySearch]);

  // Group by team lead or agent
  const grouped = useMemo(() => {
    if (viewMode === "all") return null;

    const groups = new Map<string, { name: string; payments: TechnicalPaymentSummary[]; total: number }>();

    for (const p of filtered) {
      const key = viewMode === "by-team" ? p.userName.split(" ")[0] + " Team" : p.userName;
      const existing = groups.get(key);
      if (existing) {
        existing.payments.push(p);
        existing.total += p.amount;
      } else {
        groups.set(key, { name: key, payments: [p], total: p.amount });
      }
    }

    return Array.from(groups.values()).sort((a, b) => b.total - a.total);
  }, [filtered, viewMode]);

  const totals = useMemo(() => {
    const assessment = filtered.filter((p) => p.type === "assessment").reduce((s, p) => s + p.amount, 0);
    const interview = filtered.filter((p) => p.type === "interview").reduce((s, p) => s + p.amount, 0);
    return { assessment, interview, total: assessment + interview, count: filtered.length };
  }, [filtered]);

  const presets = dateRangePresets();

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

  if (isLoading) {
    return (
      <div className="container mx-auto p-6 space-y-4">
        <div className="h-8 w-64 bg-muted rounded animate-pulse" />
        <div className="h-32 bg-muted rounded animate-pulse" />
        <div className="h-64 bg-muted rounded animate-pulse" />
      </div>
    );
  }

  return (
    <div className="container mx-auto space-y-6 p-4 md:p-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold">Technical Payments</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Assessment and Interview upfront collections
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={handleExport} className="gap-2">
          <Download className="h-4 w-4" />
          Export CSV
        </Button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4 text-center">
            <div className="text-2xl font-bold">{filtered.length}</div>
            <div className="text-xs text-muted-foreground">Transactions</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <div className="text-2xl font-bold text-green-600">
              ${totals.assessment.toLocaleString()}
            </div>
            <div className="text-xs text-muted-foreground">Assessments</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <div className="text-2xl font-bold text-blue-600">
              ${totals.interview.toLocaleString()}
            </div>
            <div className="text-xs text-muted-foreground">Interviews</div>
          </CardContent>
        </Card>
        <Card className="bg-emerald-50 border-emerald-200">
          <CardContent className="p-4 text-center">
            <div className="text-2xl font-bold text-emerald-700">
              ${totals.total.toLocaleString()}
            </div>
            <div className="text-xs text-emerald-600">Total Collected</div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <Filter className="h-4 w-4 text-muted-foreground" />
            <CardTitle className="text-sm">Filters</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            {/* Date range presets */}
            <div className="flex flex-wrap gap-1">
              {presets.map((preset) => (
                <button
                  key={preset.label}
                  onClick={() => {
                    setDateFrom(preset.from);
                    setDateTo(preset.to);
                  }}
                  className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                    dateFrom === preset.from && dateTo === preset.to
                      ? "bg-[var(--ink)] text-[var(--canvas)]"
                      : "bg-muted hover:bg-muted/80 text-muted-foreground"
                  }`}>
                  {preset.label}
                </button>
              ))}
            </div>

            {/* Custom date range */}
            <div className="flex items-center gap-2">
              <Calendar className="h-4 w-4 text-muted-foreground" />
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="rounded-md border border-[var(--hairline)] bg-background px-2 py-1 text-xs"
              />
              <span className="text-xs text-muted-foreground">to</span>
              <input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="rounded-md border border-[var(--hairline)] bg-background px-2 py-1 text-xs"
              />
            </div>

            {/* Type filter */}
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value as TypeFilter)}
              className="rounded-full border border-[var(--hairline)] bg-[var(--soft-cloud)] px-3 py-1 text-xs font-medium">
              <option value="all">All Types</option>
              <option value="assessment">Assessment</option>
              <option value="interview">Interview</option>
            </select>

            {/* View mode (admin/team_lead only) */}
            {isAdminScope && (
              <select
                value={viewMode}
                onChange={(e) => setViewMode(e.target.value as ViewMode)}
                className="rounded-full border border-[var(--hairline)] bg-[var(--soft-cloud)] px-3 py-1 text-xs font-medium">
                <option value="all">All Transactions</option>
                <option value="by-agent">By Agent</option>
              </select>
            )}
          </div>

          {/* Agent search (admin only) */}
          {isAdminScope && (
            <div className="flex items-center gap-2 flex-wrap">
              <div className="relative min-w-[160px]">
                <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  type="text"
                  placeholder="Search agent..."
                  value={searchAgent}
                  onChange={(e) => setSearchAgent(e.target.value)}
                  className="pl-8 h-8 text-xs w-40"
                />
              </div>
              <div className="relative min-w-[160px]">
                <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  type="text"
                  placeholder="Filter by company..."
                  value={companySearch}
                  onChange={(e) => setCompanySearch(e.target.value)}
                  className="pl-8 h-8 text-xs w-40"
                />
              </div>
            </div>
          )}

          {/* Company search for non-admin */}
          {!isAdminScope && (
            <div className="relative min-w-[160px]">
              <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                type="text"
                placeholder="Filter by company..."
                value={companySearch}
                onChange={(e) => setCompanySearch(e.target.value)}
                className="pl-8 h-8 text-xs w-40"
              />
            </div>
          )}
        </CardContent>
      </Card>

      {/* Payment Table or Grouped View */}
      {filtered.length === 0 ? (
        <Card>
          <CardContent className="flex items-center justify-center py-12 text-muted-foreground">
            No transactions found matching your filters.
          </CardContent>
        </Card>
      ) : viewMode === "all" ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Transactions ({filtered.length})</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-6">Date</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Lead</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Agent</TableHead>
                    <TableHead className="text-right pr-6">Amount</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((payment) => (
                    <TableRow key={payment.$id}>
                      <TableCell className="pl-6 font-mono text-sm">
                        {formatDate(payment.createdAt)}
                      </TableCell>
                      <TableCell>
                        <Badge
                          className={
                            payment.type === "assessment"
                              ? "bg-blue-100 text-blue-800"
                              : "bg-purple-100 text-purple-800"
                          }>
                          {payment.type}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-medium">{payment.leadName}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {payment.leadEmail || "—"}
                      </TableCell>
                      <TableCell>{payment.userName}</TableCell>
                      <TableCell className="text-right pr-6 font-mono font-medium">
                        ${payment.amount.toLocaleString()}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {grouped?.map((group) => (
            <Card key={group.name}>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="text-sm">{group.name}</CardTitle>
                <div className="flex items-center gap-2">
                  <Badge variant="default">{group.payments.length} transactions</Badge>
                  <Badge className="bg-emerald-600 text-white">
                    ${group.total.toLocaleString()}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="pl-6">Date</TableHead>
                        <TableHead>Type</TableHead>
                        <TableHead>Lead</TableHead>
                        <TableHead>Email</TableHead>
                        <TableHead className="text-right pr-6">Amount</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {group.payments.map((payment) => (
                        <TableRow key={payment.$id}>
                          <TableCell className="pl-6 font-mono text-sm">
                            {formatDate(payment.createdAt)}
                          </TableCell>
                          <TableCell>
                            <Badge
                              className={
                                payment.type === "assessment"
                                  ? "bg-blue-100 text-blue-800"
                                  : "bg-purple-100 text-purple-800"
                              }>
                              {payment.type}
                            </Badge>
                          </TableCell>
                          <TableCell className="font-medium">{payment.leadName}</TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {payment.leadEmail || "—"}
                          </TableCell>
                          <TableCell className="text-right pr-6 font-mono font-medium">
                            ${payment.amount.toLocaleString()}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          ))}
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
