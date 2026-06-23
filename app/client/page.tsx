"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/contexts/auth-context";
import { useLeadsForExportQuery } from "@/lib/queries/leads/use-leads-for-export-query";
import {
  Branch,
  Lead,
  LeadData,
  HistoryFilters,
  AuditLog,
  PaymentStatus,
} from "@/lib/types";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { TableSkeleton } from "@/components/ui/skeleton";
import { ProtectedRoute } from "@/components/protected-route";
import { getAuditLogs } from "@/lib/services/audit-service";
import { DateRangePicker } from "@/components/ui/date-picker";
import { listBranches } from "@/lib/services/branch-service";
import { listClientPaymentSummaries } from "@/lib/services/client-payment-service";
import { isVisibleClientLead } from "@/lib/utils/client-history";
import { filterClosedLeadsInDateRange } from "@/lib/utils/dashboard-referral";

function HistoryContent() {
  const router = useRouter();
  const { user } = useAuth();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(true);
  // Tracks which row's Copy button is mid-flight. Rapid clicks on the same
  // row's Copy button otherwise fire multiple navigator.clipboard.writeText
  // calls (and the audit-log writes that some installations also do).
  const [copyingLeadId, setCopyingLeadId] = useState<string | null>(null);
  const [filters, setFilters] = useState<HistoryFilters>({});
  const [dateRange, setDateRange] = useState<{
    from?: string;
    to?: string;
  }>({});
  const [search, setSearch] = useState("");
  const [closedByMap, setClosedByMap] = useState<Record<string, string>>({});
  const [paymentByLeadId, setPaymentByLeadId] = useState<
    Record<
      string,
      { status: PaymentStatus; personalDetails: Record<string, unknown> }
    >
  >({});
  const [paymentFilter, setPaymentFilter] = useState<
    PaymentStatus | "no_record" | "all"
  >("all");
  const [currentPage, setCurrentPage] = useState(1);
  const ITEMS_PER_PAGE = 10;
  const getLeadData = (lead: Lead): LeadData => {
    try {
      return JSON.parse(lead.data);
    } catch {
      return {};
    }
  };

  const formatPaymentStatusLabel = (status: PaymentStatus | "no_record") => {
    if (status === "no_record") return "No Record";
    if (status === "fully_paid") return "Fully Paid";
    if (status === "partially_paid") return "Partially Paid";
    return "Not Paid";
  };

  const buildCopyText = (
    lead: Lead,
    leadData: LeadData,
    personalDetails: Record<string, unknown>,
    status: PaymentStatus | "no_record",
    closedByName: string,
  ) => {
    const get = (key: string) => {
      const value = personalDetails[key] ?? leadData[key];
      if (value === null || value === undefined) return "";
      if (typeof value === "string") return value.trim();
      if (typeof value === "number" || typeof value === "boolean")
        return String(value);
      return JSON.stringify(value);
    };

    const salesperson = closedByName || get("salesperson");
    const ref = get("ref");
    const area = get("areaOfInterestRoles");
    const fullName =
      get("fullName") ||
      `${typeof leadData.firstName === "string" ? leadData.firstName : ""} ${
        typeof leadData.lastName === "string" ? leadData.lastName : ""
      }`.trim();

    return [
      `Salesperson: ${salesperson}`,
      `Ref: ${ref}`,
      `Area of Interest (Roles): ${area}`,
      `Full Name: ${fullName}`,
      `Date of Birth: ${get("dateOfBirth")}`,
      `Visa Status: ${get("visaStatus")}`,
      `Arrival in the USA: ${get("arrivalInUsa")}`,
      `Master’s Degree Details: ${get("mastersDegreeDetails")}`,
      `Bachelor’s Degree Details: ${get("bachelorsDegreeDetails")}`,
      `Email Address: ${get("email")}`,
      `Contact Number: ${get("phone")}`,
      `Current Location: ${get("currentLocation")}`,
      `Total Experience: ${get("totalExperience")}`,
      `Technology/Skill Set: ${get("technologySkillSet")}`,
      `Open to Relocation (Yes/No): ${get("openToRelocation")}`,
      `Availability for Marketing: ${get("availabilityForMarketing")}`,
      `Agreement: ${get("agreement")}`,
      `Upfront: ${get("upfront")}`,
      `BGC: ${get("bgc")}`,
      `LinkedIn profile link: ${get("linkedinProfileUrl")}`,
      "",
    ].join("\n");
  };

  async function loadClosedBy(currentLeads: Lead[]) {
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
  }

  const fetchClosedByName = async (leadId: string) => {
    try {
      const { logs } = await getAuditLogs({
        targetId: leadId,
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

      return closeLog?.actorName || "";
    } catch {
      return "";
    }
  };

  const handleCopy = async (lead: Lead) => {
    // Single-click guard: bail if this row is already being copied.
    if (copyingLeadId === lead.$id) return;
    setCopyingLeadId(lead.$id);
    try {
      const data = getLeadData(lead);
      const payment = paymentByLeadId[lead.$id];
      const status = payment?.status ?? "no_record";
      const personalDetails = payment?.personalDetails ?? {};
      let closedByName = closedByMap[lead.$id] || "";
      if (!closedByName) {
        closedByName = await fetchClosedByName(lead.$id);
        if (closedByName) {
          setClosedByMap((prev) => ({ ...prev, [lead.$id]: closedByName }));
        }
      }
      const text = buildCopyText(
        lead,
        data,
        personalDetails,
        status,
        closedByName,
      );
      await navigator.clipboard.writeText(text);
    } finally {
      setCopyingLeadId(null);
    }
  };

  const filteredLeads = useMemo(() => {
    const query = search.trim().toLowerCase();
    const leadsInRange =
      dateRange.from && dateRange.to
        ? filterClosedLeadsInDateRange(leads, dateRange.from, dateRange.to)
        : leads;

    const base = leadsInRange.filter((lead) => {
      const data = getLeadData(lead);
      if (filters.branchId && lead.branchId !== filters.branchId) {
        return false;
      }
      if (filters.agentId && lead.assignedToId !== filters.agentId) {
        return false;
      }
      if (!query) return true;

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

    if (paymentFilter === "all") return base;

    return base.filter((lead) => {
      const status = paymentByLeadId[lead.$id]?.status ?? "no_record";
      return status === paymentFilter;
    });
  }, [
    leads,
    search,
    paymentFilter,
    paymentByLeadId,
    filters.branchId,
    filters.agentId,
    dateRange.from,
    dateRange.to,
  ]);

  const totalPages = Math.max(
    1,
    Math.ceil(filteredLeads.length / ITEMS_PER_PAGE),
  );
  const paginatedLeads = useMemo(() => {
    const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
    return filteredLeads.slice(startIndex, startIndex + ITEMS_PER_PAGE);
  }, [currentPage, filteredLeads]);
  const canFilterByBranch = user?.role === "admin";

  useEffect(() => {
    if (!user) {
      router.push("/login");
      return;
    }
    // closedLeadsQuery is keyed on (userId, role, branchIds, filters) so
    // it auto-refetches when any of those change. No manual refetch needed.
  }, [user, router]);

  useEffect(() => {
    if (user?.role === "admin") {
      queueMicrotask(() => {
        void (async () => {
          try {
            const branchList = await listBranches();
            const visibleBranches = branchList.filter((branch) => {
              if (!branch.isActive) return false;
              return (
                user.role === "admin" ||
                (user.branchIds ?? []).includes(branch.$id)
              );
            });
            setBranches(visibleBranches);
          } catch (error) {
            console.error("Error loading branches:", error);
          }
        })();
      });
    }
  }, [user]);

  useEffect(() => {
    const leadsMissingClosedBy = paginatedLeads.filter(
      (lead) => lead.$id && !closedByMap[lead.$id],
    );

    if (leadsMissingClosedBy.length === 0) {
      return;
    }

    queueMicrotask(() => {
      void loadClosedBy(leadsMissingClosedBy);
    });
  }, [paginatedLeads, closedByMap]);

  // TanStack Query: fetch ALL closed leads matching the current filters.
  // The action uses cursor pagination (listAllDocuments) so the result
  // is uncapped at 5K — every closed lead in the user's visibility
  // scope comes back.
  const closedLeadsQuery = useLeadsForExportQuery({
    userId: user?.$id ?? "",
    role: user?.role ?? "agent",
    branchIds: user?.branchIds,
    filters: {
      isClosed: true,
      assignedToId: filters.agentId,
      branchId: filters.branchId,
    },
    actionOptions: {
      // Client history should show every closed client the actor can access,
      // even when the original owner / assignee is no longer in the current
      // department-scoped user cache.
      skipDepartmentScope: true,
    },
  });

  // Mirror the query result into local state, applying the
  // backout / not-interested filter that the client history page
  // historically applied.
  useEffect(() => {
    if (!closedLeadsQuery.data) return;
    const visible = closedLeadsQuery.data.leads.filter(isVisibleClientLead);
    queueMicrotask(() => {
      setLeads(visible);
      setPaymentByLeadId({});
    });
  }, [closedLeadsQuery.data]);

  useEffect(() => {
    queueMicrotask(() => {
      setLoading(closedLeadsQuery.isLoading);
    });
  }, [closedLeadsQuery.isLoading]);

  // Side-effect: fetch payment summaries whenever the visible
  // closed-leads set changes.
  useEffect(() => {
    if (!user || leads.length === 0) return;

    let cancelled = false;
    (async () => {
      try {
        const summaries = await listClientPaymentSummaries({
          actorId: user.$id,
          leadIds: leads.map((lead) => lead.$id),
        });
        if (cancelled) return;
        const next: Record<
          string,
          { status: PaymentStatus; personalDetails: Record<string, unknown> }
        > = {};
        for (const item of summaries) {
          next[item.leadId] = {
            status: item.status,
            personalDetails: item.personalDetails ?? {},
          };
        }
        setPaymentByLeadId(next);
      } catch (error) {
        console.error("Error loading payment statuses:", error);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [leads, user]);

  const clearFilters = () => {
    setDateRange({});
    setFilters({});
    setSearch("");
    setPaymentFilter("all");
    setCurrentPage(1);
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
          <div>
            <Label htmlFor="clientPaymentFilter">Payment</Label>
            <select
              id="clientPaymentFilter"
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground"
              value={paymentFilter}
              onChange={(event) => {
                setPaymentFilter(
                  (event.target.value as PaymentStatus | "no_record" | "all") ||
                    "all",
                );
                setCurrentPage(1);
              }}>
              <option value="all">All</option>
              <option value="no_record">No Record</option>
              <option value="not_paid">Not Paid</option>
              <option value="partially_paid">Partially Paid</option>
              <option value="fully_paid">Fully Paid</option>
            </select>
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
                }}>
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
                <th className="text-left p-3 md:p-4 font-semibold">Client</th>
                <th className="text-left p-3 md:p-4 font-semibold hidden sm:table-cell">
                  Email
                </th>
                <th className="text-left p-3 md:p-4 font-semibold">Status</th>
                <th className="text-left p-3 md:p-4 font-semibold hidden md:table-cell">
                  Payment
                </th>
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
                    colSpan={8}
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
                  const email =
                    typeof data.email === "string" ? data.email : "";
                  const sourceName =
                    typeof data.sourceName === "string" ? data.sourceName : "";
                  const source =
                    typeof data.source === "string" ? data.source : "";
                  const paymentStatus =
                    paymentByLeadId[lead.$id]?.status ?? "no_record";
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
                      <td className="p-3 md:p-4 hidden md:table-cell">
                        <span className="px-2 py-1 rounded-full text-xs bg-secondary text-secondary-foreground">
                          {formatPaymentStatusLabel(paymentStatus)}
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
                        <div className="flex gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            loading={copyingLeadId === lead.$id}
                            onClick={async (e) => {
                              e.stopPropagation();
                              await handleCopy(lead);
                            }}>
                            Copy
                          </Button>
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
                        </div>
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
