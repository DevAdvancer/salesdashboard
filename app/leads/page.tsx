"use client";

import { useEffect, useState, useMemo, useRef, useCallback } from "react";
import { useAuth } from "@/lib/contexts/auth-context";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { listLeadsForExport, clearLeadReadCache } from "@/lib/services/lead-action-service";
import { useLeadsQuery } from "@/lib/queries/leads/use-leads-query";
import { useRealtimeCollection } from "@/lib/hooks/use-realtime-collection";
import { useDebounce } from "@/lib/hooks/use-debounce";
import { queryKeys } from "@/lib/queries/keys";
import { COLLECTIONS } from "@/lib/constants/appwrite";
import { getUsersByIds } from "@/lib/services/user-service";
import { MONITOR_ONLY_STATUSES } from "@/lib/utils/lead-status-workflow";
import {
  useAssignableUsersQuery,
  useBranchesQuery,
  useLeadFormConfigQuery,
  useTeamAgentsQuery,
  useTeamLeadsQuery,
} from "@/lib/queries/users/use-users-query";
import { Branch, Lead, User, LeadListFilters, LeadData } from "@/lib/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { TableSkeleton } from "@/components/ui/skeleton";
import { handleError } from "@/lib/utils/error-handler";
import { ProtectedRoute } from "@/components/protected-route";
import { isAdminLikeReadAllRole } from "@/lib/services/lead/visibility";
import { Download } from "lucide-react";

// Extracted components
import { LeadFiltersCard, type FilterDrafts } from "@/components/leads/list/lead-filters-card";
import { LeadTable, LeadRow } from "@/components/leads/list/lead-table";
import { logger } from '@/lib/utils/logger';

/**
 * Persist the visible filter state in URL search params.
 */
const FILTER_PARAM_KEYS = {
  q: "q",
  status: "status",
  assignedTo: "assignedTo",
  owner: "owner",
  mine: "mine",
  branch: "branch",
  from: "from",
  to: "to",
  team: "team",
} as const;

function parseLeadData(lead: Lead): LeadData {
  try {
    return JSON.parse(lead.data) as LeadData;
  } catch (error) {
    logger.error("Failed to parse lead data", error);
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

// Roles that see all agents but have no default team selected
const ADMIN_OPS_NO_DEFAULT = new Set(["admin", "operations"]);

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

  // URL is the source of truth for filter values
  const urlSearch = searchParams.get(FILTER_PARAM_KEYS.q) ?? "";
  const urlStatus = searchParams.get(FILTER_PARAM_KEYS.status) ?? "";
  const urlAssignedTo = searchParams.get(FILTER_PARAM_KEYS.assignedTo) ?? "";
  const urlBranch = searchParams.get(FILTER_PARAM_KEYS.branch) ?? "";
  const urlFrom = searchParams.get(FILTER_PARAM_KEYS.from) ?? "";
  const urlTo = searchParams.get(FILTER_PARAM_KEYS.to) ?? "";
  const urlOwner = searchParams.get(FILTER_PARAM_KEYS.owner) ?? "";
  const urlMine = searchParams.get(FILTER_PARAM_KEYS.mine) ?? "";
  const urlTeam = searchParams.get(FILTER_PARAM_KEYS.team) ?? "";

  const [drafts, setDrafts] = useState<FilterDrafts>(() => ({
    q: urlSearch,
    status: urlStatus,
    assignedTo: urlAssignedTo,
    owner: urlOwner,
    mine: urlMine,
    branch: urlBranch,
    from: urlFrom,
    to: urlTo,
    team: urlTeam,
  }));

  // Re-seed the drafts when the URL changes from outside this component
  const draftsRef = useRef(drafts);
  useEffect(() => {
    draftsRef.current = drafts;
  });
  useEffect(() => {
    const next: FilterDrafts = {
      q: urlSearch,
      status: urlStatus,
      assignedTo: urlAssignedTo,
      owner: urlOwner,
      mine: urlMine,
      branch: urlBranch,
      from: urlFrom,
      to: urlTo,
      team: urlTeam,
    };
    const current = draftsRef.current;
    if (
      current.q === next.q &&
      current.status === next.status &&
      current.assignedTo === next.assignedTo &&
      current.owner === next.owner &&
      current.mine === next.mine &&
      current.branch === next.branch &&
      current.from === next.from &&
      current.to === next.to &&
      current.team === next.team
    ) {
      return;
    }
    setDrafts(next);
  }, [urlSearch, urlStatus, urlAssignedTo, urlOwner, urlMine, urlBranch, urlFrom, urlTo, urlTeam]);

  const teamDraft = drafts.team;

  // Set default team selection
  useEffect(() => {
    if (!user) return;
    if (urlTeam) return;
    if (ADMIN_OPS_NO_DEFAULT.has(user.role)) return;
    if (user.role === "team_lead") {
      queueMicrotask(() => {
        setDrafts((prev) => ({ ...prev, team: user.$id }));
      });
    }
  }, [user, urlTeam]);

  // Reset assignedTo when team changes
  useEffect(() => {
    queueMicrotask(() => {
      setDrafts((prev) => ({ ...prev, assignedTo: "", owner: "" }));
    });
  }, [teamDraft]);

  // The committed (URL-sourced) values drive the actual query
  const filters: LeadListFilters = useMemo(() => {
    const next: LeadListFilters = {};
    if (urlSearch) next.searchQuery = urlSearch;
    if (urlStatus) next.status = urlStatus;
    if (urlAssignedTo) next.assignedToId = urlAssignedTo;
    if (urlBranch) next.branchId = urlBranch;
    if (urlFrom) {
      const date = new Date(urlFrom);
      if (!Number.isNaN(date.getTime())) {
        date.setHours(0, 0, 0, 0);
        next.dateFrom = date.toISOString();
      }
    }
    if (urlTo) {
      const date = new Date(urlTo);
      if (!Number.isNaN(date.getTime())) {
        date.setHours(23, 59, 59, 999);
        next.dateTo = date.toISOString();
      }
    }
    if (urlOwner) next.ownerId = urlOwner;
    if (urlMine === "true") next.mine = true;
    return next;
  }, [urlSearch, urlStatus, urlAssignedTo, urlOwner, urlMine, urlBranch, urlFrom, urlTo]);

  const canExportLeads = user ? isAdminLikeReadAllRole(user.role) : false;
  const isLeadGeneration = user?.role === "lead_generation";
  const pageTitle = isLeadGeneration ? "Generated Leads" : "Active Leads";

  const writeFiltersToUrl = useCallback(
    (next: FilterDrafts) => {
      const params = new URLSearchParams();
      if (next.q) params.set(FILTER_PARAM_KEYS.q, next.q);
      if (next.status) params.set(FILTER_PARAM_KEYS.status, next.status);
      if (next.assignedTo) params.set(FILTER_PARAM_KEYS.assignedTo, next.assignedTo);
      if (next.owner) params.set(FILTER_PARAM_KEYS.owner, next.owner);
      if (next.mine) params.set(FILTER_PARAM_KEYS.mine, next.mine);
      if (next.branch) params.set(FILTER_PARAM_KEYS.branch, next.branch);
      if (next.from) params.set(FILTER_PARAM_KEYS.from, next.from);
      if (next.to) params.set(FILTER_PARAM_KEYS.to, next.to);
      if (next.team) params.set(FILTER_PARAM_KEYS.team, next.team);
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [pathname, router],
  );

  const handleExport = async () => {
    if (!user) return;
    setIsExporting(true);

    try {
      const allLeadsForExport = await listLeadsForExport(
        filters,
        user.$id,
        user.role,
        user.branchIds,
      );

      if (!allLeadsForExport.length) return;

      const allKeys = new Set<string>();
      const parsedLeads = allLeadsForExport.map((lead) => {
        const data = parseLeadData(lead);
        Object.keys(data).forEach((key) => allKeys.add(key));
        return { ...lead, parsedData: data };
      });

      const standardHeaders = [
        "firstName", "lastName", "email", "phone", "company",
        "status", "sourceName", "referralName",
      ];

      const otherKeys = Array.from(allKeys).filter(
        (key) => !standardHeaders.includes(key),
      );

      const displayHeaders = [
        "First Name", "Last Name", "Email", "Phone", "Company",
        "Status", "Source Name", "Referral Name", "Created At",
        ...otherKeys.map(
          (k) =>
            k.charAt(0).toUpperCase() +
            k.slice(1).replace(/([A-Z])/g, " $1").trim(),
        ),
      ];

      const rows = parsedLeads.map((lead) => {
        const data = lead.parsedData;
        const sourceVal = data.sourceName || data.source || "";
        const referralVal =
          data.referralName || data.referral || data["Referral Name"] || "";
        const row = [
          data.firstName || "", data.lastName || "", data.email || "",
          data.phone || "", data.company || "", lead.status || "",
          sourceVal, referralVal,
          lead.$createdAt ? new Date(lead.$createdAt).toLocaleDateString() : "",
          ...otherKeys.map((key) => data[key] || ""),
        ];
        return row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`);
      });

      const csvContent = [
        displayHeaders.join(","),
        ...rows.map((row) => row.join(",")),
      ].join("\n");

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
      logger.error("Export failed:", err);
    } finally {
      setIsExporting(false);
    }
  };

  useEffect(() => {
    if (!loading && !user) {
      router.push("/login");
    }
  }, [user, loading, router]);

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

  const queryClient = useQueryClient();
  useRealtimeCollection(COLLECTIONS.LEADS, () => {
    clearLeadReadCache();
    queryClient.invalidateQueries({ queryKey: queryKeys.leads.all });
  });

  // Dropdown data
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
  const teamLeadsQuery = useTeamLeadsQuery({
    userId: user?.$id ?? "",
    role: user?.role ?? "agent",
    branchIds: user?.branchIds,
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
  const teamLeads = useMemo(
    () => teamLeadsQuery.data ?? [],
    [teamLeadsQuery.data],
  );
  const rawBranches = useMemo(
    () => branchesQuery.data ?? [],
    [branchesQuery.data],
  );

  const agentsByTeamLead = useMemo(() => {
    const map = new Map<string, User[]>();
    allAssignableUsers.forEach((u) => {
      if (u.role === "agent" || u.role === "lead_generation") {
        const tlId = u.teamLeadId || "";
        if (!map.has(tlId)) map.set(tlId, []);
        map.get(tlId)!.push(u);
      }
    });
    return map;
  }, [allAssignableUsers]);

  const agentsForCurrentRole: User[] = useMemo(() => {
    if (!user) return [];
    if (TEAM_LEAD_ONLY.has(user.role)) return teamAgents;
    if (LEADERSHIP_ROLES.has(user.role)) return allAssignableUsers;
    return [];
  }, [user, allAssignableUsers, teamAgents]);

  const agents: User[] = useMemo(() => {
    if (!user) return [];
    if (!LEADERSHIP_ROLES.has(user.role)) return [user];
    if (!teamDraft) return agentsForCurrentRole;
    return agentsByTeamLead.get(teamDraft) ?? [];
  }, [user, agentsForCurrentRole, agentsByTeamLead, teamDraft]);

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
      ...(isMonitor ? [...MONITOR_ONLY_STATUSES] : []),
    ]
      .map((v) => v.trim())
      .filter((v) => {
        if (!v) return false;
        const clean = v.toLowerCase().replace(/[^a-z0-9]/g, "");
        return (
          clean !== "signed" &&
          clean !== "closure" &&
          clean !== "signedclosure"
        );
      });
    return Array.from(new Set(merged));
  }, [formConfigQuery.data, isMonitor]);

  const leads: Lead[] = useMemo(
    () => leadsQuery.data?.leads ?? [],
    [leadsQuery.data],
  );
  const totalLeads = leadsQuery.data?.total ?? 0;

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

  const leadUserKey = useMemo(
    () =>
      leads
        .map((l) => `${l.ownerId || ""}:${l.assignedToId || ""}`)
        .join(","),
    [leads],
  );

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
      const allNeededIds = new Set<string>();
      for (const id of ownerIds) if (!owners.has(id)) allNeededIds.add(id);
      for (const id of assignedIds) {
        if (assignedUsers.has(id)) continue;
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
      logger.error("Error loading lead user names:", err);
    }
  };

  useEffect(() => {
    if (leads.length === 0) return;
    queueMicrotask(() => {
      void loadLeadUserNames();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leadUserKey]);

  const debouncedDrafts = useDebounce(drafts, 300);

  useEffect(() => {
    if (
      debouncedDrafts.q !== urlSearch ||
      debouncedDrafts.status !== urlStatus ||
      debouncedDrafts.assignedTo !== urlAssignedTo ||
      debouncedDrafts.owner !== urlOwner ||
      debouncedDrafts.mine !== urlMine ||
      debouncedDrafts.branch !== urlBranch ||
      debouncedDrafts.from !== urlFrom ||
      debouncedDrafts.to !== urlTo ||
      debouncedDrafts.team !== urlTeam
    ) {
      writeFiltersToUrl(debouncedDrafts);
      setCurrentPage(1);
    }
  }, [
    debouncedDrafts,
    urlSearch, urlStatus, urlAssignedTo, urlOwner, urlMine,
    urlBranch, urlFrom, urlTo, urlTeam,
    writeFiltersToUrl,
  ]);

  const handleClearFilters = () => {
    writeFiltersToUrl({
      q: "", status: "", assignedTo: "", owner: "",
      mine: "", branch: "", from: "", to: "", team: "",
    });
    setCurrentPage(1);
  };

  const handleViewLead = useCallback(
    (leadId: string) => router.push(`/leads/${leadId}`),
    [router],
  );

  const showAssigned = SHOW_ASSIGNED_ROLES.has(user?.role || "");
  const leadRows = useMemo(() => {
    return leads.map((lead) => (
      <LeadRow
        key={lead.$id}
        lead={lead}
        showAssigned={showAssigned}
        assignedUsers={assignedUsers}
        owners={owners}
        onView={handleViewLead}
      />
    ));
  }, [leads, assignedUsers, owners, showAssigned, handleViewLead]);

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

      <LeadFiltersCard
        drafts={drafts}
        setDrafts={setDrafts}
        userRole={user?.role || ""}
        statusOptions={statusOptions}
        agents={agents}
        branches={branches}
        teamLeads={teamLeads}
        onClearFilters={handleClearFilters}
      />

      <LeadTable
        leads={leads}
        leadRows={leadRows}
        showAssigned={showAssigned}
        totalPages={totalPages}
        currentPage={currentPage}
        setCurrentPage={setCurrentPage}
        filters={filters}
        isReadOnlyAdminView={isReadOnlyAdminView}
      />
    </div>
  );
}

export default function LeadsPage() {
  return (
    <ProtectedRoute componentKey="leads">
      <LeadsContent />
    </ProtectedRoute>
  );
}
