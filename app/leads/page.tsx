"use client";

import { useEffect, useState, useMemo, useRef, memo, useCallback } from "react";
import { useAuth } from "@/lib/contexts/auth-context";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { listLeadsForExport } from "@/lib/services/lead-action-service";
import { useLeadsQuery } from "@/lib/queries/leads/use-leads-query";
import { getUsersByIds } from "@/lib/services/user-service";
import { MONITOR_ONLY_STATUSES } from "@/lib/utils/lead-status-workflow";
import {
  useAssignableUsersQuery,
  useBranchesQuery,
  useLeadFormConfigQuery,
  useTeamAgentsQuery,
} from "@/lib/queries/users/use-users-query";
import { Branch, Lead, User, LeadListFilters, LeadData } from "@/lib/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TableSkeleton } from "@/components/ui/skeleton";
import { DateRangePicker } from "@/components/ui/date-picker";
import { handleError } from "@/lib/utils/error-handler";
import { ProtectedRoute } from "@/components/protected-route";
import { canExportLeadsByEmail } from "@/lib/constants/lead-export-access";

import { Download } from "lucide-react";

/**
 * Persist the visible filter state in URL search params. Anything that
 * a user might want to share / restore lives here, so the values survive
 * a refresh and the leads query re-uses the same TanStack cache key
 * when nothing has changed.
 */
const FILTER_PARAM_KEYS = {
  q: "q",
  status: "status",
  assignedTo: "assignedTo",
  branch: "branch",
  from: "from",
  to: "to",
} as const;

function parseLeadData(lead: Lead): LeadData {
  try {
    return JSON.parse(lead.data) as LeadData;
  } catch (error) {
    console.error("Failed to parse lead data", error);
    return {};
  }
}

function deletedUserPlaceholder(userId: string): User {
  return {
    $id: userId,
    name: 'Deleted user',
    email: '',
    role: 'agent',
    teamLeadId: null,
    branchIds: [],
    isActive: false,
    department: 'sales',
  };
}

const SHOW_ASSIGNED_ROLES = new Set([
  "admin",
  "developer",
  "monitor",
  "operations",
  "team_lead",
]);

const LEADERSHIP_ROLES = new Set([
  "admin",
  "developer",
  "monitor",
  "operations",
  "team_lead",
]);

const TEAM_LEAD_ONLY = new Set(["team_lead"]);

const LEADERSHIP_NO_BRANCH_FILTER = new Set([
  "admin",
  "developer",
  "monitor",
  "operations",
]);

function LeadsContent() {
  const { user, loading } = useAuth();
  const isMonitor = user?.role === 'monitor';
  const isOperations = user?.role === 'operations';
  const isReadOnlyAdminView = isMonitor || isOperations;
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [owners, setOwners] = useState<Map<string, User>>(new Map());
  const [assignedUsers, setAssignedUsers] = useState<Map<string, User>>(
    new Map(),
  );
  const [isExporting, setIsExporting] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);

  const ITEMS_PER_PAGE = 10;

  // The URL is the source of truth for filter values. We mirror it into
  // local "draft" state so the user can type freely (every keystroke
  // is a no-op for the network) and only commit on Apply. Bundling the
  // six drafts into a single state object means there's only one
  // setState call when Apply/Clear runs and no per-field useEffects.
  const urlSearch = searchParams.get(FILTER_PARAM_KEYS.q) ?? "";
  const urlStatus = searchParams.get(FILTER_PARAM_KEYS.status) ?? "";
  const urlAssignedTo = searchParams.get(FILTER_PARAM_KEYS.assignedTo) ?? "";
  const urlBranch = searchParams.get(FILTER_PARAM_KEYS.branch) ?? "";
  const urlFrom = searchParams.get(FILTER_PARAM_KEYS.from) ?? "";
  const urlTo = searchParams.get(FILTER_PARAM_KEYS.to) ?? "";

  type FilterDrafts = {
    q: string;
    status: string;
    assignedTo: string;
    branch: string;
    from: string;
    to: string;
  };

  const [drafts, setDrafts] = useState<FilterDrafts>(() => ({
    q: urlSearch,
    status: urlStatus,
    assignedTo: urlAssignedTo,
    branch: urlBranch,
    from: urlFrom,
    to: urlTo,
  }));

  // Re-seed the drafts when the URL changes from outside this component
  // (e.g. Apply, Clear, browser back/forward). We compare against the
  // current draft so we only `setDrafts` when something actually moved.
  // The ref is mirrored from `drafts` in a separate effect to keep
  // the URL-sync effect stable and dependency-free.
  const draftsRef = useRef(drafts);
  useEffect(() => {
    draftsRef.current = drafts;
  });
  useEffect(() => {
    const next: FilterDrafts = {
      q: urlSearch,
      status: urlStatus,
      assignedTo: urlAssignedTo,
      branch: urlBranch,
      from: urlFrom,
      to: urlTo,
    };
    const current = draftsRef.current;
    if (
      current.q === next.q &&
      current.status === next.status &&
      current.assignedTo === next.assignedTo &&
      current.branch === next.branch &&
      current.from === next.from &&
      current.to === next.to
    ) {
      return;
    }
    setDrafts(next);
    // Drafts are intentionally excluded from deps — this effect is
    // meant to react to URL changes only, and reading drafts in the
    // dependency list would cause infinite loops because the effect
    // also updates drafts.
  }, [urlSearch, urlStatus, urlAssignedTo, urlBranch, urlFrom, urlTo]);

  const searchDraft = drafts.q;
  const statusDraft = drafts.status;
  const assignedToDraft = drafts.assignedTo;
  const branchDraft = drafts.branch;
  const dateFromDraft = drafts.from;
  const dateToDraft = drafts.to;

  // The committed (URL-sourced) values drive the actual query.
  const searchQuery = urlSearch;
  const statusFilter = urlStatus;
  const assignedToFilter = urlAssignedTo;
  const branchFilter = urlBranch;
  const dateFromFilter = urlFrom;
  const dateToFilter = urlTo;

  const filters: LeadListFilters = useMemo(() => {
    const next: LeadListFilters = {};
    if (searchQuery) next.searchQuery = searchQuery;
    if (statusFilter) next.status = statusFilter;
    if (assignedToFilter) next.assignedToId = assignedToFilter;
    if (branchFilter) next.branchId = branchFilter;
    if (dateFromFilter) {
      const date = new Date(dateFromFilter);
      if (!Number.isNaN(date.getTime())) {
        date.setHours(0, 0, 0, 0);
        next.dateFrom = date.toISOString();
      }
    }
    if (dateToFilter) {
      const date = new Date(dateToFilter);
      if (!Number.isNaN(date.getTime())) {
        date.setHours(23, 59, 59, 999);
        next.dateTo = date.toISOString();
      }
    }
    return next;
  }, [searchQuery, statusFilter, assignedToFilter, branchFilter, dateFromFilter, dateToFilter]);

  const canExportLeads = canExportLeadsByEmail(user?.email);
  const isLeadGeneration = user?.role === "lead_generation";
  const pageTitle = isLeadGeneration ? "Generated Leads" : "Active Leads";

  /**
   * Write the visible filter values to the URL. We use replace rather
   * than push so Apply Filters doesn't bloat the back-stack with one
   * entry per filter change.
   */
  const writeFiltersToUrl = useCallback(
    (next: {
      q: string;
      status: string;
      assignedTo: string;
      branch: string;
      from: string;
      to: string;
    }) => {
      const params = new URLSearchParams();
      if (next.q) params.set(FILTER_PARAM_KEYS.q, next.q);
      if (next.status) params.set(FILTER_PARAM_KEYS.status, next.status);
      if (next.assignedTo) params.set(FILTER_PARAM_KEYS.assignedTo, next.assignedTo);
      if (next.branch) params.set(FILTER_PARAM_KEYS.branch, next.branch);
      if (next.from) params.set(FILTER_PARAM_KEYS.from, next.from);
      if (next.to) params.set(FILTER_PARAM_KEYS.to, next.to);
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [pathname, router],
  );

  const handleExport = async () => {
    if (!user) return;
    setIsExporting(true);

    try {
      // Fetch the full filtered set for export (bypasses pagination).
      // The server caps this at 10K to prevent runaway memory.
      const allLeadsForExport = await listLeadsForExport(
        filters,
        user.$id,
        user.role,
        user.branchIds,
      );

      if (!allLeadsForExport.length) return;

      // 1. Collect all unique keys from all leads' data
      const allKeys = new Set<string>();
      const parsedLeads = allLeadsForExport.map((lead) => {
        const data = parseLeadData(lead);

        // Add all keys from this lead to the set
        Object.keys(data).forEach((key) => allKeys.add(key));

        return {
          ...lead,
          parsedData: data,
        };
      });

      // 2. Define standard headers we always want first
      const standardHeaders = [
        "firstName",
        "lastName",
        "email",
        "phone",
        "company",
        "status",
        "sourceName",
        "referralName",
      ];

      // 3. Create final list of headers (standard + any others found)
      // Filter out standard ones from allKeys to avoid duplicates, then spread the rest
      const otherKeys = Array.from(allKeys).filter(
        (key) => !standardHeaders.includes(key),
      );

      // Create display headers (Capitalized)
      const displayHeaders = [
        "First Name",
        "Last Name",
        "Email",
        "Phone",
        "Company",
        "Status",
        "Source Name",
        "Referral Name",
        "Created At",
        ...otherKeys.map(
          (k) =>
            k.charAt(0).toUpperCase() +
            k
              .slice(1)
              .replace(/([A-Z])/g, " $1")
              .trim(),
        ), // Simple title case
      ];

      // 4. Map data rows
      const rows = parsedLeads.map((lead) => {
        const data = lead.parsedData;

        // Smart mapping for Source and Referral
        // Use sourceName if available, otherwise fall back to 'source' field
        const sourceVal = data.sourceName || data.source || "";
        // Use referralName if available, otherwise check common variations
        const referralVal =
          data.referralName || data.referral || data["Referral Name"] || "";

        // Build row array matching the order of displayHeaders
        const row = [
          data.firstName || "",
          data.lastName || "",
          data.email || "",
          data.phone || "",
          data.company || "",
          lead.status || "",
          sourceVal, // Mapped Source Value
          referralVal, // Mapped Referral Value
          lead.$createdAt ? new Date(lead.$createdAt).toLocaleDateString() : "",
          ...otherKeys.map((key) => data[key] || ""), // Add values for other dynamic keys
        ];

        return row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`); // Escape quotes
      });

      // 5. Combine headers and rows
      const csvContent = [
        displayHeaders.join(","),
        ...rows.map((row) => row.join(",")),
      ].join("\n");

      // Create download link
      const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.setAttribute("href", url);
      link.setAttribute(
        "download",
        `leads_export_${new Date().toISOString().split("T")[0]}.csv`,
      );
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (err) {
      console.error("Export failed:", err);
    } finally {
      setIsExporting(false);
    }
  };

  useEffect(() => {
    if (!loading && !user) {
      router.push("/login");
    }
  }, [user, loading, router]);

  // TanStack Query: server-paginated lead list (10 rows per page by
  // default). The query key embeds (scope, filters, page, pageSize) so
  // any of those changing triggers a refetch. Repeat visits to the same
  // page are served from cache.
  const normalizedFilters = useMemo(() => {
    const currentFilters: LeadListFilters = { ...filters };
    const normalizedStatus =
      typeof currentFilters.status === "string"
        ? currentFilters.status.trim().toLowerCase().replace(/\s+/g, "")
        : "";
    const isBackout =
      normalizedStatus === "backout" || normalizedStatus === "backedout";

    if (currentFilters.isClosed === undefined) {
      currentFilters.isClosed = isBackout;
    }
    return currentFilters;
  }, [filters]);

  const leadsQuery = useLeadsQuery({
    userId: user?.$id ?? "",
    role: user?.role ?? "agent",
    branchIds: user?.branchIds,
    filters: normalizedFilters,
    page: currentPage,
    pageSize: ITEMS_PER_PAGE,
  });

  // Dropdown data — agents, branches, status options — read through
  // TanStack queries so they're shared across pages and survive remounts
  // without re-fetching. The underlying service calls are still
  // resource-cached, so this is a stack of caches.

  const assignableUsersQuery = useAssignableUsersQuery({
    userId: user?.$id ?? "",
    role: user?.role ?? "agent",
    branchIds: user?.branchIds,
    departmentScope: "sales",
  });
  const teamAgentsQuery = useTeamAgentsQuery({
    teamLeadId: user?.$id ?? "",
    departmentScope: "sales",
  });
  const branchesQuery = useBranchesQuery();
  const formConfigQuery = useLeadFormConfigQuery();

  const allAssignableUsers = useMemo(
    () => assignableUsersQuery.data ?? [],
    [assignableUsersQuery.data],
  );
  const teamAgents = useMemo(
    () => teamAgentsQuery.data ?? [],
    [teamAgentsQuery.data],
  );
  const rawBranches = useMemo(
    () => branchesQuery.data ?? [],
    [branchesQuery.data],
  );

  // Pick the agent list based on role: TLs see only their own team,
  // admins/leadership see all assignable users, agent role sees nothing
  // (the dropdown is hidden for them anyway).
  const agents: User[] = useMemo(() => {
    if (!user) return [];
    if (TEAM_LEAD_ONLY.has(user.role)) return teamAgents;
    if (LEADERSHIP_ROLES.has(user.role)) return allAssignableUsers;
    return [];
  }, [user, allAssignableUsers, teamAgents]);

  // Branch filter is shown to every role. Filter to active + role-visible
  // branches: leadership sees all active; everyone else sees only the
  // active branches that overlap their assigned branches.
  const branches: Branch[] = useMemo(() => {
    if (!user) return [];
    if (LEADERSHIP_NO_BRANCH_FILTER.has(user.role)) {
      return rawBranches.filter((b) => b.isActive);
    }
    const userBranchIds = user.branchIds ?? [];
    return rawBranches.filter(
      (b) => b.isActive && userBranchIds.includes(b.$id),
    );
  }, [user, rawBranches]);

  // Status options merge form-config values with the legacy default set.
  // Memoized on the form-config result so a search-input keystroke
  // doesn't re-run the merge.
  const statusOptions = useMemo(() => {
    const config = formConfigQuery.data;
    const formOptions = (() => {
      if (!config) return [];
      const statusField = config.fields.find((f) => f.key === "status");
      if (!Array.isArray(statusField?.options)) return [];
      return statusField.options.filter(
        (v) => typeof v === "string" && v.trim().length > 0,
      );
    })();
    const merged = [
      "Generated",
      ...formOptions,
      "Backed Out",
      // LinkedIn and Leads are monitor-only statuses — they only appear
      // in the filter for users with the `monitor` role. Operations and
      // other roles will not see these as filter options.
      ...(isMonitor ? [...MONITOR_ONLY_STATUSES] : []),
    ]
      .map((v) => v.trim())
      .filter(Boolean);
    return Array.from(new Set(merged));
  }, [formConfigQuery.data, isMonitor]);

  // Derive the current page of leads from the query result. Reading the
  // data directly (instead of mirroring it into local state) keeps
  // every render in sync without an effect.
  const leads: Lead[] = useMemo(
    () => leadsQuery.data?.leads ?? [],
    [leadsQuery.data],
  );
  const totalLeads = leadsQuery.data?.total ?? 0;

  // Fire a toast on the transition into error. We don't keep the
  // string in local state because the inline error card can derive it
  // from the query error directly.
  useEffect(() => {
    if (leadsQuery.error) {
      handleError(leadsQuery.error as Error, {
        title: "Failed to Load Leads",
        showToast: true,
      });
    }
  }, [leadsQuery.error]);

  const error = useMemo(
    () =>
      leadsQuery.error
        ? (handleError(leadsQuery.error as Error, {
            title: "Failed to Load Leads",
            showToast: false,
          }) ?? "Failed to load leads")
        : null,
    [leadsQuery.error],
  );

  // Effect dep is a derived key (ownerId + assignedToId set) so the user
  // lookup only re-fires when the visible user set actually changes, not
  // on every refetch that produces a new array reference.
  const leadUserKey = useMemo(
    () =>
      leads
        .map((l) => `${l.ownerId || ""}:${l.assignedToId || ""}`)
        .join(","),
    [leads],
  );

  // Bulk-fetch both owners and assigned-agent users in a single roundtrip.
  // Replaces what was previously ~2N individual getUserByIdOrNull calls.
  // We keep this as a non-`useCallback` function so the leadUserKey
  // effect below can read the latest closures without React Compiler
  // flagging the wrapped setState calls.
  const loadLeadUserNames = async () => {
    if (!user || leads.length === 0) return;

    try {
      const ownerIds = Array.from(
        new Set(leads.map((lead) => lead.ownerId).filter(Boolean))
      );
      const assignedIds = Array.from(
        new Set(
          leads.map((lead) => lead.assignedToId).filter(Boolean) as string[]
        )
      );

      // Only fetch IDs we don't already have on hand.
      const allNeededIds = new Set<string>();
      for (const id of ownerIds) if (!owners.has(id)) allNeededIds.add(id);
      for (const id of assignedIds) {
        if (assignedUsers.has(id)) continue;
        // We may already know this id from the agents list.
        if (agents.some((a) => a.$id === id)) continue;
        allNeededIds.add(id);
      }

      if (allNeededIds.size === 0) return;

      const fetched = await getUsersByIds(Array.from(allNeededIds));

      const ownerMap = new Map<string, User>();
      const assignedMap = new Map<string, User>();

      for (const id of ownerIds) {
        const u = fetched.get(id);
        ownerMap.set(id, u ?? deletedUserPlaceholder(id));
      }
      for (const id of assignedIds) {
        const cached =
          assignedUsers.get(id) ?? agents.find((a) => a.$id === id);
        if (cached) {
          assignedMap.set(id, cached);
          continue;
        }
        const u = fetched.get(id);
        assignedMap.set(id, u ?? deletedUserPlaceholder(id));
      }

      if (ownerMap.size > 0) {
        setOwners((prev) => new Map([...prev, ...ownerMap]));
      }
      if (assignedMap.size > 0) {
        setAssignedUsers((prev) => new Map([...prev, ...assignedMap]));
      }
    } catch (err) {
      console.error("Error loading lead user names:", err);
    }
  };

  useEffect(() => {
    if (leads.length === 0) return;
    // Defer to a microtask so the synchronous setState calls inside
    // loadLeadUserNames() don't get attributed to this effect's
    // render phase by the React Compiler.
    queueMicrotask(() => {
      void loadLeadUserNames();
    });
    // loadLeadUserNames reads the latest state via closure, so we
    // intentionally key this effect on leadUserKey only. Adding the
    // callback identity would cause a refetch on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leadUserKey]);

  const handleApplyFilters = () => {
    writeFiltersToUrl({
      q: searchDraft,
      status: statusDraft,
      assignedTo: assignedToDraft,
      branch: branchDraft,
      from: dateFromDraft,
      to: dateToDraft,
    });
    // Reset to page 1 when filters change so users see results starting
    // at the top.
    setCurrentPage(1);
  };

  const handleClearFilters = () => {
    writeFiltersToUrl({
      q: "",
      status: "",
      assignedTo: "",
      branch: "",
      from: "",
      to: "",
    });
    setCurrentPage(1);
  };

  // With server pagination, the query already returns the current page
  // slice.
  const paginatedLeads = leads;

  // Memoize the table rows so that unrelated state updates (e.g. search
  // query changes) don't cause the entire table to re-render from scratch.
  // Each <tr> is wrapped in a memoized LeadRow so per-row work is local
  // — typing in the search box or opening a filter dropdown won't rebuild
  // 100 rows from scratch.
  const handleViewLead = useCallback(
    (leadId: string) => router.push(`/leads/${leadId}`),
    [router],
  );
  const leadRows = useMemo(() => {
    const showAssigned = SHOW_ASSIGNED_ROLES.has(user?.role || "");
    return paginatedLeads.map((lead) => (
      <LeadRow
        key={lead.$id}
        lead={lead}
        showAssigned={showAssigned}
        assignedUsers={assignedUsers}
        owners={owners}
        onView={handleViewLead}
      />
    ));
  }, [paginatedLeads, assignedUsers, owners, user?.role, handleViewLead]);

  const totalPages = Math.max(1, Math.ceil(totalLeads / ITEMS_PER_PAGE));

  if (loading || leadsQuery.isLoading) {
    return (
      <div className="container mx-auto">
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-2xl md:text-3xl font-bold">{pageTitle}</h1>
        </div>
        <Card>
          <CardContent className="p-4 md:p-6">
            <TableSkeleton rows={5} />
          </CardContent>
        </Card>
      </div>
    );
  }

  if (error) {
    return (
      <div className="container mx-auto">
        <Card className="border-red-500">
          <CardHeader>
            <CardTitle className="text-red-500">Error</CardTitle>
          </CardHeader>
          <CardContent>
            <p>{error}</p>
            <Button onClick={() => leadsQuery.refetch()} className="mt-4">
              Retry
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
        <h1 className="text-2xl md:text-3xl font-bold">{pageTitle}</h1>
        <div id="tour-leads-actions" className="flex items-center gap-2">
          {canExportLeads && (
            <Button
              variant="outline"
              onClick={handleExport}
              disabled={isExporting || leads.length === 0}
              className="flex items-center gap-2">
              <Download className="h-4 w-4" />
              {isExporting ? "Exporting..." : "Export CSV"}
            </Button>
          )}
          {!isLeadGeneration && !isOperations && (
            <Button onClick={() => router.push("/leads/new")}>Create Lead</Button>
          )}
        </div>
      </div>

      {/* Filters Section */}
      <Card id="tour-leads-filters" className="mb-6">
        <CardHeader>
          <CardTitle>Filters</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <div>
              <Label htmlFor="search">Search</Label>
              <Input
                id="search"
                placeholder="Search leads..."
                value={searchDraft}
                onChange={(e) =>
                  setDrafts((prev) => ({ ...prev, q: e.target.value }))
                }
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    handleApplyFilters();
                  }
                }}
              />
            </div>

            <div>
              <Label htmlFor="status">Status</Label>
              <select
                id="status"
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                value={statusDraft}
                onChange={(e) =>
                  setDrafts((prev) => ({ ...prev, status: e.target.value }))
                }>
                <option value="">All Statuses</option>
                {statusOptions.map((status) => (
                  <option key={status} value={status}>
                    {status}
                  </option>
                ))}
              </select>
            </div>

            {LEADERSHIP_ROLES.has(user?.role || "") && (
              <div>
                <Label htmlFor="assignedTo">Assigned To</Label>
                <select
                  id="assignedTo"
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  value={assignedToDraft}
                  onChange={(e) =>
                    setDrafts((prev) => ({ ...prev, assignedTo: e.target.value }))
                  }>
                  <option value="">All Agents</option>
                  {agents.map((agent) => (
                    <option key={agent.$id} value={agent.$id}>
                      {agent.name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div>
              <Label htmlFor="branchFilter">Branch</Label>
              <select
                id="branchFilter"
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                value={branchDraft}
                onChange={(e) =>
                  setDrafts((prev) => ({ ...prev, branch: e.target.value }))
                }>
                <option value="">All Branches</option>
                {branches.map((branch) => (
                  <option key={branch.$id} value={branch.$id}>
                    {branch.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <Label htmlFor="leadDateRange">Date Range</Label>
              <DateRangePicker
                id="leadDateRange"
                value={{ from: dateFromDraft || undefined, to: dateToDraft || undefined }}
                onChange={(range) => {
                  setDrafts((prev) => ({
                    ...prev,
                    from: range.from ?? "",
                    to: range.to ?? "",
                  }));
                }}
              />
            </div>
          </div>

          <div className="flex gap-2 mt-4">
            <Button onClick={handleApplyFilters}>Apply Filters</Button>
            <Button variant="outline" onClick={handleClearFilters}>
              Clear Filters
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Leads Table */}
      {leads.length === 0 ? (
        <Card>
          <CardContent className="p-6">
            <p className="text-center text-muted-foreground">
              No leads found.{" "}
              {Object.keys(filters).length > 0
                ? "Try adjusting your filters."
                : isReadOnlyAdminView
                  ? "No active leads are available."
                  : "Create your first lead to get started."}
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[600px]">
                  <thead className="border-b">
                    <tr className="text-left">
                      <th className="p-3 md:p-4 font-semibold">Name</th>
                      <th className="p-3 md:p-4 font-semibold hidden sm:table-cell">
                        Email
                      </th>
                      <th className="p-3 md:p-4 font-semibold">Status</th>
                      <th className="p-3 md:p-4 font-semibold hidden lg:table-cell">
                        Source
                      </th>
                      {LEADERSHIP_ROLES.has(user?.role || "") && (
                        <th className="p-3 md:p-4 font-semibold hidden md:table-cell">
                          Assigned To
                        </th>
                      )}
                      {LEADERSHIP_ROLES.has(user?.role || "") && (
                        <th className="p-3 md:p-4 font-semibold hidden lg:table-cell">
                          Owner
                        </th>
                      )}
                      <th className="p-3 md:p-4 font-semibold hidden sm:table-cell">
                        Created
                      </th>
                      <th className="p-3 md:p-4 font-semibold">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {leadRows}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex flex-col sm:flex-row justify-center items-center gap-2 mt-6">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                disabled={currentPage === 1}>
                Previous
              </Button>
              <span className="text-sm text-muted-foreground">
                Page {currentPage} of {totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  setCurrentPage((p) => Math.min(totalPages, p + 1))
                }
                disabled={currentPage === totalPages}>
                Next
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

const AssignedAgentName = memo(function AssignedAgentName({
  agentId,
  assignedUsers,
}: {
  agentId: string;
  assignedUsers: Map<string, User>;
}) {
  const agent = assignedUsers.get(agentId);
  return <span>{agent?.name || "Unknown"}</span>;
});

const OwnerName = memo(function OwnerName({
  ownerId,
  owners,
}: {
  ownerId: string;
  owners: Map<string, User>;
}) {
  const owner = owners.get(ownerId);
  return <span>{owner?.name || "Unknown"}</span>;
});

/**
 * Memoized table row. Re-renders only when its own lead, the resolved
 * assigned/owner user, or the visible status string changes. Keeps the
 * per-keystroke filter cost bounded to the row actually being edited.
 */
const LeadRow = memo(
  function LeadRow({
    lead,
    showAssigned,
    assignedUsers,
    owners,
    onView,
  }: {
    lead: Lead;
    showAssigned: boolean;
    assignedUsers: Map<string, User>;
    owners: Map<string, User>;
    onView: (leadId: string) => void;
  }) {
    const leadData = parseLeadData(lead);
    const firstName =
      typeof leadData.firstName === "string" ? leadData.firstName : "";
    const lastName =
      typeof leadData.lastName === "string" ? leadData.lastName : "";
    const email = typeof leadData.email === "string" ? leadData.email : "";
    const sourceName =
      typeof leadData.sourceName === "string" ? leadData.sourceName : "";
    const source = typeof leadData.source === "string" ? leadData.source : "";

    return (
      <tr className="border-b hover:bg-accent/50 transition-colors">
        <td className="p-3 md:p-4">
          {firstName} {lastName}
        </td>
        <td className="p-3 md:p-4 text-muted-foreground hidden sm:table-cell">
          {email}
        </td>
        <td className="p-3 md:p-4">
          <span className="inline-block px-2 md:px-3 py-1 text-xs md:text-sm rounded-full bg-primary/10 text-primary">
            {lead.status}
          </span>
        </td>
        <td className="p-3 md:p-4 text-muted-foreground hidden lg:table-cell">
          {sourceName || source || "-"}
        </td>
        {showAssigned && (
          <td className="p-3 md:p-4 text-muted-foreground hidden md:table-cell">
            {lead.assignedToId ? (
              <AssignedAgentName
                agentId={lead.assignedToId}
                assignedUsers={assignedUsers}
              />
            ) : (
              "Unassigned"
            )}
          </td>
        )}
        {showAssigned && (
          <td className="p-3 md:p-4 text-muted-foreground hidden lg:table-cell">
            <OwnerName ownerId={lead.ownerId} owners={owners} />
          </td>
        )}
        <td className="p-3 md:p-4 text-muted-foreground hidden sm:table-cell">
          {lead.$createdAt
            ? new Date(lead.$createdAt).toLocaleDateString()
            : "N/A"}
        </td>
        <td className="p-3 md:p-4">
          <Button
            id="tour-lead-view-btn"
            size="sm"
            variant="outline"
            onClick={() => onView(lead.$id)}>
            View
          </Button>
        </td>
      </tr>
    );
  },
  (prev, next) =>
    prev.lead.$id === next.lead.$id &&
    prev.lead.status === next.lead.status &&
    prev.lead.$createdAt === next.lead.$createdAt &&
    prev.lead.data === next.lead.data &&
    prev.lead.ownerId === next.lead.ownerId &&
    prev.lead.assignedToId === next.lead.assignedToId &&
    prev.showAssigned === next.showAssigned &&
    prev.assignedUsers === next.assignedUsers &&
    prev.owners === next.owners &&
    prev.onView === next.onView,
);

export default function LeadsPage() {
  return (
    <ProtectedRoute componentKey="leads">
      <LeadsContent />
    </ProtectedRoute>
  );
}
