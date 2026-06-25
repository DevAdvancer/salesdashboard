"use client";

import { useAuth } from "@/lib/contexts/auth-context";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ProtectedRoute } from "@/components/protected-route";
import { listLeads } from "@/lib/services/lead-action-service";
import type { User } from "@/lib/types";
import { AttendanceSelfToggle } from "@/components/attendance-self-toggle";
import { DashboardDateRange } from "@/components/dashboard/dashboard-date-range";
import { TopMetricsRow } from "@/components/dashboard/top-metrics-row";
import { KpiLeadTargetSection } from "@/components/dashboard/kpi-lead-target-section";
import { ReferralSection } from "@/components/dashboard/referral-section";
import { PaymentsSection } from "@/components/dashboard/payments-section";
import { LgHandoffSection } from "@/components/dashboard/lg-handoff-section";
import {
  loadDashboardTopMetrics,
  loadLeadTargetProgress,
  loadDashboardPaymentInsights,
  loadDashboardReferralStats,
  loadLgHandoffSummaries,
  type TopMetrics,
} from "@/lib/services/dashboard-data-service";
import {
  isSingleDay,
  workingDaysInRange,
  type DateRange,
  type KpiRow,
} from "@/lib/utils/dashboard-kpi";
import type { ReferralSplit } from "@/lib/utils/dashboard-referral";
import type { PaymentInsightRecord } from "@/app/actions/client-payments";
import type { TeamLeadAssignmentSummary } from "@/lib/utils/dashboard-insights";

type LeadGenerationTeamAssignmentStat = {
  teamLeadId: string;
  teamLeadName: string;
  assignedLeads: number;
};

// ---------------------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------------------

function toIsoDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function monthStartIso(date: Date): string {
  return toIsoDate(new Date(date.getFullYear(), date.getMonth(), 1));
}

function monthEndIso(date: Date): string {
  // Return the last day of the month as a YYYY-MM-DD string so it can
  // be expanded to the end-of-day timestamp on the server side. This
  // matches monthStartIso and avoids timezone skew from toISOString
  // (which would shift the boundary for users not on UTC).
  return toIsoDate(new Date(date.getFullYear(), date.getMonth() + 1, 0));
}

function monthLabel(date: Date): string {
  return date.toLocaleString("en-US", { month: "long", year: "numeric" });
}

function rangeLabel(range: DateRange): string {
  if (isSingleDay(range) && range.from) {
    const [y, m, d] = range.from.split("-").map(Number);
    const date = new Date(y, m - 1, d);
    return date.toLocaleDateString("en-US", {
      month: "long",
      day: "numeric",
      year: "numeric",
    });
  }
  if (range.from && range.to) {
    return `${range.from} → ${range.to}`;
  }
  if (range.from) return `from ${range.from}`;
  if (range.to) return `through ${range.to}`;
  return "no range";
}

// ---------------------------------------------------------------------------
// Main dashboard content
// ---------------------------------------------------------------------------

function DashboardContent() {
  const {
    user,
    isAdmin,
    isTeamLead,
    isAgent,
    isMonitor,
    isOperations,
    activeDashboard,
  } = useAuth();
  const router = useRouter();

  // Resume department / view — redirect handled by parent.
  const isOnResumeView = activeDashboard === "resume";
  useEffect(() => {
    if (user && isOnResumeView) {
      router.replace("/resume-dashboard");
    }
  }, [user, isOnResumeView, router]);

  if (user?.role === "lead_generation") {
    return <LeadGenerationDashboardContent />;
  }

  if (!user || isOnResumeView) {
    return null;
  }

  return (
    <MainDashboard
      user={user}
      isAdmin={isAdmin}
      isTeamLead={isTeamLead}
      isAgent={isAgent}
      isMonitor={isMonitor}
      isOperations={isOperations}
    />
  );
}

interface MainDashboardProps {
  user: User;
  isAdmin: boolean;
  isTeamLead: boolean;
  isAgent: boolean;
  isMonitor: boolean;
  isOperations: boolean;
}

function MainDashboard({
  user,
  isAdmin,
  isTeamLead,
  isAgent,
  isMonitor,
  isOperations,
}: MainDashboardProps) {
  const isAdminLike = isAdmin || isMonitor || isOperations;
  const visibilityLabel = isAgent ? "Assigned to you" : "Total active leads";
  const router = useRouter();

  // Date range — defaults to today (single day).
  const [dateRange, setDateRange] = useState<DateRange>(() => ({
    from: toIsoDate(new Date()),
    to: toIsoDate(new Date()),
  }));

  // Top metrics
  const [topMetrics, setTopMetrics] = useState<TopMetrics | null>(null);
  const [topMetricsLoading, setTopMetricsLoading] = useState(true);

  // KPI rows
  const [kpiRows, setKpiRows] = useState<KpiRow[] | null>(null);
  const [kpiLoading, setKpiLoading] = useState(true);

  // Referral split (always current month)
  const currentMonth = useMemo(() => new Date(), []);
  const monthStartKey = useMemo(
    () => monthStartIso(currentMonth),
    [currentMonth],
  );
  const monthEndKey = useMemo(() => monthEndIso(currentMonth), [currentMonth]);

  // Payment insights (admin-like only)
  const [paymentRecords, setPaymentRecords] = useState<PaymentInsightRecord[]>(
    [],
  );
  const [paymentLoading, setPaymentLoading] = useState(isAdminLike);
  const [referralData, setReferralData] = useState<ReferralSplit | null>(null);
  const [referralLoading, setReferralLoading] = useState(isAdminLike);

  // LG Handoff summaries (admin-like only)
  const [handoffSummaries, setHandoffSummaries] = useState<TeamLeadAssignmentSummary[] | null>(null);
  const [handoffLoading, setHandoffLoading] = useState(isAdminLike);

  // Section loading flags driven by a single readiness gate.
  const initialLoading = !user;

  // ── Fetch top metrics when range changes ──────────────────────────────
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    // Start loading inside a microtask to satisfy the lint rule
    // against synchronous setState in effect bodies.
    queueMicrotask(() => {
      if (cancelled) return;
      setTopMetricsLoading(true);
    });

    (async () => {
      try {
        const result = await loadDashboardTopMetrics({
          userId: user.$id,
          role: user.role,
          branchIds: user.branchIds,
          dateRange,
        });
        if (!cancelled) {
          setTopMetrics(result);
          setTopMetricsLoading(false);
        }
      } catch (error) {
        console.error("Error loading top metrics:", error);
        if (!cancelled) {
          setTopMetrics({
            activeLeads: 0,
            closedLeads: 0,
            createdMocks: 0,
            createdInterviewSupport: 0,
            createdAssessmentSupport: 0,
          });
          setTopMetricsLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [user, dateRange]);

  // ── Fetch KPI rows when range changes ─────────────────────────────────
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      setKpiLoading(true);
    });

    (async () => {
      try {
        const rows = await loadLeadTargetProgress({
          userId: user.$id,
          role: user.role,
          branchIds: user.branchIds,
          dateRange,
        });
        if (!cancelled) {
          setKpiRows(rows);
          setKpiLoading(false);
        }
      } catch (error) {
        console.error("Error loading KPI rows:", error);
        if (!cancelled) {
          setKpiRows([]);
          setKpiLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [user, dateRange]);

  // ── Fetch payment insights (admin-like only) ──────────────────────────
  useEffect(() => {
    if (!user || !isAdminLike) {
      return;
    }
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      setPaymentLoading(true);
    });

    (async () => {
      try {
        const records = await loadDashboardPaymentInsights(user.$id);
        if (!cancelled) {
          setPaymentRecords(records);
          setPaymentLoading(false);
        }
      } catch (error) {
        console.error("Error loading payment insights:", error);
        if (!cancelled) {
          setPaymentRecords([]);
          setPaymentLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [user, isAdminLike]);

  // ── Fetch referral split (admin-like only, current month by closedAt) ───
  useEffect(() => {
    if (!user || !isAdminLike) {
      return;
    }
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      setReferralLoading(true);
    });

    (async () => {
      try {
        const result = await loadDashboardReferralStats({
          userId: user.$id,
          role: user.role,
          branchIds: user.branchIds,
          monthStartIso: monthStartKey,
          monthEndIso: monthEndKey,
        });
        if (!cancelled) {
          setReferralData(result);
          setReferralLoading(false);
        }
      } catch (error) {
        console.error("Error loading referral stats:", error);
        if (!cancelled) {
          setReferralData(null);
          setReferralLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [user, isAdminLike, monthStartKey, monthEndKey]);

  // ── Fetch LG handoff summaries (admin-like only) ──────────────────────
  useEffect(() => {
    if (!user || !isAdminLike) return;
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      setHandoffLoading(true);
    });

    (async () => {
      try {
        const result = await loadLgHandoffSummaries(user.$id);
        if (!cancelled) {
          setHandoffSummaries(result);
          setHandoffLoading(false);
        }
      } catch (error) {
        console.error("Error loading LG handoff summaries:", error);
        if (!cancelled) {
          setHandoffSummaries([]);
          setHandoffLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [user, isAdminLike]);

  // KPI section mode + target derived from range
  const kpiMode = isSingleDay(dateRange) ? "daily" : "monthly";
  const scopeLabel = isAgent
    ? "Just you"
    : isTeamLead
      ? "Your team"
      : "All members";

  // Use rows[0] as the source of truth once loaded; otherwise compute a
  // fallback from the range so the UI never shows "0" on load. The
  // target is the count of working days (Mon-Fri) in the range — a
  // 31-day month has roughly 22 working days, a one-week range has 5.
  const kpiTarget: number = (() => {
    if (kpiRows && kpiRows.length > 0) return kpiRows[0].target;
    if (kpiMode === "daily") return 1;
    const fromIso = dateRange.from ?? toIsoDate(new Date());
    const toIso = dateRange.to ?? fromIso;
    return Math.max(1, workingDaysInRange(fromIso, toIso));
  })();

  if (initialLoading) {
    return (
      <div className="space-y-6">
        <div>
          <Skeleton className="h-9 w-52" />
          <Skeleton className="mt-3 h-4 w-72" />
        </div>
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-5">
          {Array.from({ length: 5 }).map((_, index) => (
            <Skeleton key={index} className="h-28 w-full" />
          ))}
        </div>
        <Skeleton className="h-72 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold">Dashboard</h1>
          <p className="text-muted-foreground mt-1">
            Welcome back, {user.name}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <DashboardDateRange value={dateRange} onChange={setDateRange} />
          <AttendanceSelfToggle />
        </div>
      </div>

      {/* Top metrics row — respects the date range */}
      <TopMetricsRow
        metrics={topMetrics}
        isLoading={topMetricsLoading}
        visibilityLabel={visibilityLabel}
      />

      {/* KPI — daily/monthly lead target per member */}
      <KpiLeadTargetSection
        rows={kpiRows}
        isLoading={kpiLoading}
        mode={kpiMode}
        target={kpiTarget}
        scopeLabel={scopeLabel}
        rangeLabel={rangeLabel(dateRange)}
      />

      {/* Referral split — admin-only, current month */}
      {isAdminLike && (
        <ReferralSection
          data={referralData}
          isLoading={referralLoading}
          monthLabel={monthLabel(currentMonth)}
        />
      )}

      {/* LG → TL Handoff counts — admin-only */}
      {isAdminLike && (
        <LgHandoffSection
          summaries={handoffSummaries}
          isLoading={handoffLoading}
        />
      )}

      {/* Payments — admin-only, all-time + per-month */}
      {isAdminLike && (
        <PaymentsSection records={paymentRecords} isLoading={paymentLoading} />
      )}

      {/* Quick actions footer — kept minimal */}
      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
        <Button variant="outline" onClick={() => router.push("/leads")}>
          View Leads
        </Button>
        {isTeamLead && (
          <Button
            variant="outline"
            onClick={() => router.push("/linkedin-requests")}>
            LinkedIn Requests
          </Button>
        )}
        {(isAdminLike || isTeamLead) && (
          <Button variant="outline" onClick={() => router.push("/users")}>
            {isAdminLike && !isMonitor && !isOperations
              ? "Manage Users"
              : "View Users"}
          </Button>
        )}
        {isAdmin && (
          <Button
            variant="outline"
            onClick={() => router.push("/payments-report")}>
            Payments Report
          </Button>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Lead Generation dashboard (unchanged from prior version)
// ---------------------------------------------------------------------------

function LeadGenerationDashboardContent() {
  const { user } = useAuth();
  const router = useRouter();
  const [stats, setStats] = useState<{
    total: number;
    unassigned: number;
    teamAssignments: LeadGenerationTeamAssignmentStat[];
    loading: boolean;
  }>({
    total: 0,
    unassigned: 0,
    teamAssignments: [],
    loading: true,
  });

  useEffect(() => {
    if (!user) return;

    let cancelled = false;

    (async () => {
      try {
        const leads = await listLeads(
          { isClosed: false },
          user.$id,
          user.role,
          user.branchIds,
        );
        const unassigned = leads.filter((lead) => !lead.assignedToId).length;
        const { getUserByIdOrNull } =
          await import("@/lib/services/user-service");
        const usersById = new Map<string, User>([[user.$id, user]]);
        const userIdsToResolve = new Set(
          leads
            .map((lead) => lead.assignedToId)
            .filter((assignedToId): assignedToId is string =>
              Boolean(assignedToId),
            ),
        );

        for (const userId of Array.from(userIdsToResolve)) {
          const resolvedUser = await getUserByIdOrNull(userId);
          if (!resolvedUser) continue;

          usersById.set(resolvedUser.$id, resolvedUser);
          if (
            resolvedUser.role === "agent" &&
            resolvedUser.teamLeadId &&
            !usersById.has(resolvedUser.teamLeadId)
          ) {
            const teamLead = await getUserByIdOrNull(resolvedUser.teamLeadId);
            if (teamLead) {
              usersById.set(teamLead.$id, teamLead);
            }
          }
        }

        const teamMap = new Map<string, LeadGenerationTeamAssignmentStat>();
        for (const lead of leads) {
          if (!lead.assignedToId) continue;
          const assignee = usersById.get(lead.assignedToId);
          const teamLeadId =
            assignee?.role === "team_lead"
              ? assignee.$id
              : assignee?.role === "agent"
                ? assignee.teamLeadId
                : null;
          if (!teamLeadId) continue;

          const teamLead = usersById.get(teamLeadId);
          const teamStat = teamMap.get(teamLeadId) ?? {
            teamLeadId,
            teamLeadName: teamLead?.name ?? "Unknown Team Lead",
            assignedLeads: 0,
          };
          teamStat.assignedLeads += 1;
          teamMap.set(teamLeadId, teamStat);
        }

        const teamAssignments = Array.from(teamMap.values()).sort(
          (a, b) =>
            b.assignedLeads - a.assignedLeads ||
            a.teamLeadName.localeCompare(b.teamLeadName),
        );

        if (!cancelled) {
          setStats({
            total: leads.length,
            unassigned,
            teamAssignments,
            loading: false,
          });
        }
      } catch {
        if (!cancelled) {
          setStats((prev) => ({ ...prev, loading: false }));
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [user]);

  if (!user) {
    return (
      <div className="container mx-auto space-y-6">
        <Skeleton className="h-10 w-56" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  return (
    <div className="container mx-auto space-y-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold md:text-3xl">Lead Generation</h1>
          <p className="text-muted-foreground">
            Create new leads with the basic details and hand them off for
            assignment.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <AttendanceSelfToggle />
          <Button variant="outline" onClick={() => router.push("/settings")}>
            Profile Settings
          </Button>
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <div className="rounded-2xl border border-[var(--hairline)] bg-[var(--soft-cloud)]/40 p-4">
          <div className="text-sm font-medium text-muted-foreground">
            My Generated Leads
          </div>
          <div className="text-muted-foreground text-xs">
            Leads created by you (active only).
          </div>
          <div className="mt-2 flex items-center justify-between">
            <div className="text-3xl font-semibold">
              {stats.loading ? "—" : stats.total}
            </div>
            <Button variant="outline" onClick={() => router.push("/leads")}>
              View Leads
            </Button>
          </div>
        </div>

        <div className="rounded-2xl border border-[var(--hairline)] bg-[var(--soft-cloud)]/40 p-4">
          <div className="text-sm font-medium text-muted-foreground">
            Awaiting Assignment
          </div>
          <div className="text-muted-foreground text-xs">
            Leads not yet assigned to a team.
          </div>
          <div className="mt-2 text-3xl font-semibold">
            {stats.loading ? "—" : stats.unassigned}
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-[var(--hairline)] bg-card p-4">
        <div className="text-sm font-medium">Team Assignment Counts</div>
        <div className="text-muted-foreground text-xs">
          Active leads you have assigned to each team.
        </div>
        <div className="mt-3">
          {stats.loading ? (
            <Skeleton className="h-24 w-full" />
          ) : stats.teamAssignments.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No leads assigned to a team yet.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="border-b">
                  <tr className="text-left">
                    <th className="p-3 text-sm font-semibold">Team Lead</th>
                    <th className="p-3 text-sm font-semibold">
                      Assigned Leads
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {stats.teamAssignments.map((team) => (
                    <tr
                      key={team.teamLeadId}
                      className="border-b last:border-0">
                      <td className="p-3 text-sm font-medium">
                        {team.teamLeadName}
                      </td>
                      <td className="p-3 text-sm">{team.assignedLeads}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page export
// ---------------------------------------------------------------------------

export default function DashboardPage() {
  return (
    <ProtectedRoute componentKey="dashboard">
      <DashboardContent />
    </ProtectedRoute>
  );
}
