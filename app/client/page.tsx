"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/contexts/auth-context";
import { listLeadsAction } from "@/app/actions/lead";
import { Branch, Lead, LeadData, HistoryFilters, AuditLog } from "@/lib/types";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { TableSkeleton } from "@/components/ui/skeleton";
import { ProtectedRoute } from "@/components/protected-route";
import { getAuditLogs } from "@/lib/services/audit-service";
import { DateRangePicker } from "@/components/ui/date-picker";
import { listBranches } from "@/lib/services/branch-service";

function HistoryContent() {
  const router = useRouter();
  const { user } = useAuth();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState<HistoryFilters>({});
  const [dateRange, setDateRange] = useState<{
    from?: string;
    to?: string;
  }>({});
  const [search, setSearch] = useState("");
  const [closedByMap, setClosedByMap] = useState<Record<string, string>>({});
  const [currentPage, setCurrentPage] = useState(1);
  const ITEMS_PER_PAGE = 10;
  const getLeadData = (lead: Lead): LeadData => {
    try {
      return JSON.parse(lead.data);
    } catch {
      return {};
    }
  };
  const filteredLeads = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return leads;

    return leads.filter((lead) => {
      const data = getLeadData(lead);
      const name = `${data.firstName ?? ""} ${data.lastName ?? ""}`.trim();
      const email = `${data.email ?? ""}`.trim();
      const source = `${data.sourceName ?? data.source ?? ""}`.trim();
      const status = `${lead.status ?? ""}`.trim();

      return (
        name.toLowerCase().includes(query) ||
        email.toLowerCase().includes(query) ||
        source.toLowerCase().includes(query) ||
        status.toLowerCase().includes(query)
      );
    });
  }, [leads, search]);

  const totalPages = Math.max(1, Math.ceil(filteredLeads.length / ITEMS_PER_PAGE));
  const paginatedLeads = useMemo(() => {
    const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
    return filteredLeads.slice(startIndex, startIndex + ITEMS_PER_PAGE);
  }, [currentPage, filteredLeads]);
  const canFilterByBranch = user?.role === "admin" || user?.role === "manager";

  useEffect(() => {
    if (!user) {
      router.push("/login");
      return;
    }

    loadClosedLeads();
  }, [user, filters, router]);

  useEffect(() => {
    if (user?.role === "admin" || user?.role === "manager") {
      loadBranches();
    }
  }, [user]);

  useEffect(() => {
    const visibleLeads = filteredLeads.slice(
      (currentPage - 1) * ITEMS_PER_PAGE,
      currentPage * ITEMS_PER_PAGE,
    );
    const leadsMissingClosedBy = visibleLeads.filter(
      (lead) => !closedByMap[lead.$id],
    );

    if (leadsMissingClosedBy.length === 0) {
      return;
    }

    void loadClosedBy(leadsMissingClosedBy);
  }, [filteredLeads, currentPage, closedByMap]);

  const loadClosedLeads = async () => {
    if (!user) return;

    try {
      setLoading(true);
      const closedLeads = await listLeadsAction(
        {
          isClosed: true,
          assignedToId: filters.agentId,
          branchId: filters.branchId,
          dateFrom: filters.dateFrom,
          dateTo: filters.dateTo,
        },
        user.$id,
        user.role,
        user.branchIds,
      );
      setLeads(closedLeads);
    } catch (error) {
      console.error("Error loading closed leads:", error);
    } finally {
      setLoading(false);
    }
  };

  const loadClosedBy = async (currentLeads: Lead[]) => {
    try {
      const entries: Record<string, string> = {};

      await Promise.all(
        currentLeads.map(async (lead) => {
          try {
            const { logs } = await getAuditLogs({
              targetId: lead.$id,
              targetType: "LEAD",
              limit: 10,
            });

            const closeLog = logs.find((log: AuditLog) => {
              if (log.action !== "LEAD_UPDATE" || !log.metadata) return false;
              try {
                const metadata = JSON.parse(log.metadata);
                return metadata.isClosed === true;
              } catch {
                return false;
              }
            });

            if (closeLog) {
              entries[lead.$id] = closeLog.actorName;
            }
          } catch (error) {
            console.error("Error loading closedBy for lead", lead.$id, error);
          }
        }),
      );

      if (Object.keys(entries).length > 0) {
        setClosedByMap((prev) => ({
          ...prev,
          ...entries,
        }));
      }
    } catch (error) {
      console.error("Error loading closedBy names:", error);
    }
  };

  const clearFilters = () => {
    setDateRange({});
    setFilters({});
    setSearch("");
    setCurrentPage(1);
  };

  const loadBranches = async () => {
    if (!user || (user.role !== "admin" && user.role !== "manager")) return;

    try {
      const branchList = await listBranches();
      const visibleBranches = branchList.filter((branch) => {
        if (!branch.isActive) return false;
        return user.role === "admin" || (user.branchIds ?? []).includes(branch.$id);
      });
      setBranches(visibleBranches);
    } catch (error) {
      console.error("Error loading branches:", error);
    }
  };

  const formatDate = (dateString: string | null | undefined) => {
    if (!dateString) return "N/A";
    return new Date(dateString).toLocaleDateString();
  };

  if (loading) {
    return (
      <div className="container mx-auto">
        <div className="mb-6">
          <h1 className="text-2xl md:text-3xl font-bold mb-2">
            Client History
          </h1>
        </div>
        <Card className="p-4 md:p-6">
          <TableSkeleton rows={5} />
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl md:text-3xl font-bold mb-2">Client History</h1>
        <p className="text-muted-foreground">View all client records</p>
      </div>

      {/* Filters */}
      <Card id="tour-clients-filters" className="p-4 mb-6">
        <h2 className="text-lg font-semibold mb-4">Filters</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
          <div className="sm:col-span-2 md:col-span-1">
            <Label htmlFor="clientSearch">Search</Label>
            <Input
              id="clientSearch"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setCurrentPage(1);
              }}
              placeholder="Name, email, status, source..."
            />
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="clientDateRange">Date Range</Label>
            <DateRangePicker
              id="clientDateRange"
              value={dateRange}
              onChange={(range) => {
                setDateRange(range);

                if (!range.from && !range.to) {
                  setFilters((prev) => ({
                    ...prev,
                    dateFrom: undefined,
                    dateTo: undefined,
                  }));
                  setCurrentPage(1);
                  return;
                }

                if (range.from && range.to) {
                  setFilters((prev) => ({
                    ...prev,
                    dateFrom: range.from,
                    dateTo: range.to,
                  }));
                  setCurrentPage(1);
                }
              }}
            />
          </div>
          {canFilterByBranch && (
            <div>
              <Label htmlFor="clientBranchFilter">Branch</Label>
              <select
                id="clientBranchFilter"
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground"
                value={filters.branchId ?? ""}
                onChange={(event) => {
                  setFilters((prev) => ({
                    ...prev,
                    branchId: event.target.value || undefined,
                  }));
                  setCurrentPage(1);
                }}
              >
                <option value="">All Branches</option>
                {branches.map((branch) => (
                  <option key={branch.$id} value={branch.$id}>
                    {branch.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div className="flex items-end">
            <Button onClick={clearFilters} variant="outline" className="w-full">
              Clear Filters
            </Button>
          </div>
        </div>
      </Card>

      {/* Leads Table */}
      <Card>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[500px]">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left p-3 md:p-4 font-semibold">Name</th>
                <th className="text-left p-3 md:p-4 font-semibold hidden sm:table-cell">
                  Email
                </th>
                <th className="text-left p-3 md:p-4 font-semibold">Status</th>
                <th className="text-left p-3 md:p-4 font-semibold hidden lg:table-cell">
                  Source
                </th>
                <th className="text-left p-3 md:p-4 font-semibold hidden md:table-cell">
                  Closed By
                </th>
                <th className="text-left p-3 md:p-4 font-semibold hidden sm:table-cell">
                  Closed Date
                </th>
                <th className="text-left p-3 md:p-4 font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody>
              {paginatedLeads.length === 0 ? (
                <tr>
                  <td
                    colSpan={6}
                    className="text-center py-8 text-muted-foreground">
                    No client records found
                  </td>
                </tr>
              ) : (
                paginatedLeads.map((lead) => {
                  const data = getLeadData(lead);
                  const firstName =
                    typeof data.firstName === "string" ? data.firstName : "";
                  const lastName =
                    typeof data.lastName === "string" ? data.lastName : "";
                  const email = typeof data.email === "string" ? data.email : "";
                  const sourceName =
                    typeof data.sourceName === "string" ? data.sourceName : "";
                  const source = typeof data.source === "string" ? data.source : "";
                  return (
                    <tr
                      key={lead.$id}
                      className="border-b border-border hover:bg-accent/50 cursor-pointer transition-colors"
                      onClick={() => router.push(`/client/${lead.$id}`)}>
                      <td className="p-3 md:p-4">
                        {firstName} {lastName}
                      </td>
                      <td className="p-3 md:p-4 text-muted-foreground hidden sm:table-cell">
                        {email || "N/A"}
                      </td>
                      <td className="p-3 md:p-4">
                        <span className="px-2 py-1 rounded-full text-xs bg-secondary text-secondary-foreground">
                          {lead.status}
                        </span>
                      </td>
                      <td className="p-3 md:p-4 text-muted-foreground hidden lg:table-cell">
                        {sourceName || source || "-"}
                      </td>
                      <td className="p-3 md:p-4 text-muted-foreground hidden md:table-cell">
                        {closedByMap[lead.$id] || "N/A"}
                      </td>
                      <td className="p-3 md:p-4 text-muted-foreground hidden sm:table-cell">
                        {formatDate(lead.closedAt)}
                      </td>
                      <td className="p-3 md:p-4">
                        <Button
                          id="tour-client-view-btn"
                          variant="outline"
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            router.push(`/client/${lead.$id}`);
                          }}>
                          View
                        </Button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Pagination Controls */}
      {filteredLeads.length > 0 && (
        <div className="flex justify-between items-center mt-4">
          <Button
            onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
            disabled={currentPage === 1}
            variant="outline">
            Previous
          </Button>
          <span className="text-sm text-muted-foreground">
            Page {currentPage} of {totalPages}
          </span>
          <Button
            onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
            disabled={currentPage === totalPages}
            variant="outline">
            Next
          </Button>
        </div>
      )}

      {/* Summary */}
      <div className="mt-4 text-muted-foreground text-sm">
        Showing {paginatedLeads.length} of {filteredLeads.length} client record
        {filteredLeads.length !== 1 ? "s" : ""}
      </div>
    </div>
  );
}

export default function HistoryPage() {
  return (
    <ProtectedRoute componentKey="history">
      <HistoryContent />
    </ProtectedRoute>
  );
}
