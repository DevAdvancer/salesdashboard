"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/contexts/auth-context";
import { listLeadsAction } from "@/app/actions/lead";
import { Lead, LeadData, HistoryFilters, AuditLog } from "@/lib/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TableSkeleton } from "@/components/ui/skeleton";
import { ProtectedRoute } from "@/components/protected-route";
import { getAuditLogs } from "@/lib/services/audit-service";

function HistoryContent() {
  const router = useRouter();
  const { user, isManager, isAgent } = useAuth();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState<HistoryFilters>({});
  const [closedByMap, setClosedByMap] = useState<Record<string, string>>({});
  const [currentPage, setCurrentPage] = useState(1);
  const ITEMS_PER_PAGE = 10;

  useEffect(() => {
    if (!user) {
      router.push("/login");
      return;
    }

    loadClosedLeads();
  }, [user, filters]);

  const loadClosedLeads = async () => {
    if (!user) return;

    try {
      setLoading(true);
      const closedLeads = await listLeadsAction(
        {
          isClosed: true,
          assignedToId: filters.agentId,
          dateFrom: filters.dateFrom,
          dateTo: filters.dateTo,
        },
        user.$id,
        user.role,
        user.branchIds,
      );
      setLeads(closedLeads);
      loadClosedBy(closedLeads);
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

      setClosedByMap(entries);
    } catch (error) {
      console.error("Error loading closedBy names:", error);
    }
  };

  const handleFilterChange = (key: keyof HistoryFilters, value: string) => {
    setFilters((prev) => ({
      ...prev,
      [key]: value || undefined,
    }));
  };

  const clearFilters = () => {
    setFilters({});
    setCurrentPage(1);
  };

  const formatDate = (dateString: string | null | undefined) => {
    if (!dateString) return "N/A";
    return new Date(dateString).toLocaleDateString();
  };

  const getLeadData = (lead: Lead): LeadData => {
    try {
      return JSON.parse(lead.data);
    } catch {
      return {};
    }
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

  const paginatedLeads = leads.slice(
    (currentPage - 1) * ITEMS_PER_PAGE,
    currentPage * ITEMS_PER_PAGE,
  );

  const totalPages = Math.ceil(leads.length / ITEMS_PER_PAGE);

  return (
    <div className="container mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl md:text-3xl font-bold mb-2">Client History</h1>
        <p className="text-muted-foreground">View all client records</p>
      </div>

      {/* Filters */}
      <Card className="p-4 mb-6">
        <h2 className="text-lg font-semibold mb-4">Filters</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
          <div>
            <Label htmlFor="dateFrom">From Date</Label>
            <Input
              id="dateFrom"
              type="date"
              value={filters.dateFrom || ""}
              onChange={(e) => handleFilterChange("dateFrom", e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="dateTo">To Date</Label>
            <Input
              id="dateTo"
              type="date"
              value={filters.dateTo || ""}
              onChange={(e) => handleFilterChange("dateTo", e.target.value)}
            />
          </div>
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
                  return (
                    <tr
                      key={lead.$id}
                      className="border-b border-border hover:bg-accent/50 cursor-pointer transition-colors"
                      onClick={() => router.push(`/client/${lead.$id}`)}>
                      <td className="p-3 md:p-4">
                        {data.firstName} {data.lastName || ""}
                      </td>
                      <td className="p-3 md:p-4 text-muted-foreground hidden sm:table-cell">
                        {data.email || "N/A"}
                      </td>
                      <td className="p-3 md:p-4">
                        <span className="px-2 py-1 rounded-full text-xs bg-secondary text-secondary-foreground">
                          {lead.status}
                        </span>
                      </td>
                      <td className="p-3 md:p-4 text-muted-foreground hidden lg:table-cell">
                        {data.sourceName || data.source || "-"}
                      </td>
                      <td className="p-3 md:p-4 text-muted-foreground hidden md:table-cell">
                        {closedByMap[lead.$id] || "N/A"}
                      </td>
                      <td className="p-3 md:p-4 text-muted-foreground hidden sm:table-cell">
                        {formatDate(lead.closedAt)}
                      </td>
                      <td className="p-3 md:p-4">
                        <Button
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
      {leads.length > 0 && (
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
        Showing {paginatedLeads.length} of {leads.length} client record
        {leads.length !== 1 ? "s" : ""}
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
