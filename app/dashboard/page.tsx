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
import { KpiLinkedinConnectionSection } from "@/components/dashboard/kpi-linkedin-connection-section";
import { HolidayCalendarSection } from "@/components/dashboard/holiday-calendar-section";
import { ReferralSection } from "@/components/dashboard/referral-section";
import { PaymentsSection } from "@/components/dashboard/payments-section";
import { LgHandoffSection } from "@/components/dashboard/lg-handoff-section";
import {
  clearDashboardDataCache,
  loadDashboardTopMetrics,
  loadDashboardHolidayCalendar,
  loadLeadTargetProgress,
  loadLinkedinConnectionKpiProgress,
  loadDashboardPaymentInsights,
  loadDashboardReferralStats,
  loadLgHandoffSummaries,
  type TopMetrics,
} from "@/lib/services/dashboard-data-service";
import type { LinkedinConnectionKpiRow } from "@/app/actions/linkedin";
import {
  isSingleDay,
  type DateRange,
  type KpiRow,
} from "@/lib/utils/dashboard-kpi";
import { workingDaysInRange as countWorkingDaysInRange } from "@/lib/utils/holiday-calendar";
import type { ReferralSplit } from "@/lib/utils/dashboard-referral";
import type { PaymentInsightRecord } from "@/app/actions/client-payments";
import { listTechnicalPaymentsAction } from "@/app/actions/technical-payments";
import type { TeamLeadAssignmentSummary } from "@/lib/utils/dashboard-insights";
import { getTodayEst, getMonthStartEst, getMonthEndEst } from "@/lib/utils/est-date";
import type { HolidayCalendarEntry } from "@/lib/types";

type LeadGenerationTeamAssignmentStat = {
  teamLeadId: string;
  teamLeadName: string;
  assignedLeads: number;
};

// ---------------------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------------------

/**
 * Format a YYYY-MM-DD string as a human-readable label.
 * The date is parsed in UTC (not local time) so the label matches
 * the raw string — no timezone drift.
 */
function rangeLabel(range: DateRange): string {
  if (isSingleDay(range) && range.from) {
    const [y, m, d] = range.from.split("-").map(Number);
    const date = new Date(Date.UTC(y, m - 1, d));
    return date.toLocaleDateString("en-US", {
      month: "long",
      day: "numeric",
      year: "numeric",
      timeZone: "UTC",
    });
  }
  if (range.from && range.to) {
    return `${range.from} \u2192 ${range.to}`;
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

  // Date range — initially null to prevent hydration mismatch and double-fetching, initialized via useEffect.
  const [dateRange, setDateRange] = useState<DateRange | null>(null);

  // Initialize date range from localStorage
  useEffect(() => {
    const savedFilter = localStorage.getItem('dashboard_date_filter');
    const today = getTodayEst();
    if (savedFilter === 'month') {
      const monthStart = getMonthStartEst(new Date());
      setDateRange({ from: monthStart, to: today });
    } else {
      setDateRange({ from: today, to: today });
    }
  }, []);

  const handleDateRangeChange = (newRange: DateRange) => {
    setDateRange(newRange);
    
    // Check if it's a single day to determine the filter type.
    if (newRange.from && newRange.to && newRange.from === newRange.to) {
      localStorage.setItem('dashboard_date_filter', 'today');
    } else {
      // Treat any multi-day range as 'month' for persistence
      localStorage.setItem('dashboard_date_filter', 'month');
    }
  };

  // Top metrics
  const [topMetrics, setTopMetrics] = useState<TopMetrics | null>(null);
  const [topMetricsLoading, setTopMetricsLoading] = useState(true);

  // KPI rows
  const [kpiRows, setKpiRows] = useState<KpiRow[] | null>(null);
  const [kpiLoading, setKpiLoading] = useState(true);

  // LinkedIn Connection KPI rows
  const [linkedinKpiRows, setLinkedinKpiRows] = useState<LinkedinConnectionKpiRow[] | null>(null);
  const [linkedinKpiLoading, setLinkedinKpiLoading] = useState(true);
  const [holidayCalendar, setHolidayCalendar] = useState<HolidayCalendarEntry[]>([]);
  const [holidayLoading, setHolidayLoading] = useState(true);

  // Referral split uses the date range filter
  const monthStartKey = dateRange?.from ?? getMonthStartEst(new Date());
  const monthEndKey = dateRange?.to ?? getMonthEndEst(new Date());


  // Payment insights (admin-like only)
  const [paymentRecords, setPaymentRecords] = useState<PaymentInsightRecord[]>(
    [],
  );
  const [paymentLoading, setPaymentLoading] = useState(isAdminLike);
  const [technicalPaymentsTotal, setTechnicalPaymentsTotal] = useState(0);
  const [referralData, setReferralData] = useState<ReferralSplit | null>(null);
  const [referralLoading, setReferralLoading] = useState(isAdminLike);


  // LG Handoff summaries (admin-like only)
  const [handoffSummaries, setHandoffSummaries] = useState<TeamLeadAssignmentSummary[] | null>(null);
  const [handoffLoading, setHandoffLoading] = useState(isAdminLike);


  // ── Fetch top metrics when range changes ──────────────────────────────
  useEffect(() => {
    if (!user || !dateRange) return;
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
    if (!user || !dateRange) return;
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

  // ── Fetch LinkedIn KPI rows when range changes ─────────────────────────
  useEffect(() => {
    if (!user || !dateRange) return;
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      setLinkedinKpiLoading(true);
    });

    (async () => {
      try {
        const rows = await loadLinkedinConnectionKpiProgress({
          userId: user.$id,
          role: user.role,
          branchIds: user.branchIds,
          dateRange,
        });
        if (!cancelled) {
          setLinkedinKpiRows(rows);
          setLinkedinKpiLoading(false);
        }
      } catch (error) {
        console.error("Error loading LinkedIn Connection KPI rows:", error);
        if (!cancelled) {
          setLinkedinKpiRows([]);
          setLinkedinKpiLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [user, dateRange]);

  // ── Fetch holiday calendar (all dashboard viewers use this to disable
  // holiday selection and to exclude weekday holidays from KPI targets) ──
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      setHolidayLoading(true);
    });

    (async () => {
      try {
        const rows = await loadDashboardHolidayCalendar(user.$id);
        if (!cancelled) {
          setHolidayCalendar(rows);
          setHolidayLoading(false);
        }
      } catch (error) {
        console.error("Error loading holiday calendar:", error);
        if (!cancelled) {
          setHolidayCalendar([]);
          setHolidayLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [user]);

  // ── Fetch payment insights (admin-like only) ──────────────────────────
  useEffect(() => {
    if (!user || !isAdminLike || !dateRange) {
      return;
    }
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      setPaymentLoading(true);
    });

    (async () => {
      try {
        const records = await loadDashboardPaymentInsights(user.$id, dateRange);
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
  }, [user, isAdminLike, dateRange]);

  // ── Fetch technical payments total for dashboard (all accessible technical payments in date range) ──
  useEffect(() => {
    if (!user || !isAdminLike || !dateRange) {
      setTechnicalPaymentsTotal(0);
      return;
    }
    let cancelled = false;

    (async () => {
      try {
        const techPayments = await listTechnicalPaymentsAction(user.$id);

        // Filter by date range to only include payments from the selected period
        const filteredTechPayments = techPayments.filter(p => {
          const paymentDate = p.createdAt?.substring(0, 10);
          if (!paymentDate) return false;
          return (!dateRange.from || paymentDate >= dateRange.from) &&
                 (!dateRange.to || paymentDate <= dateRange.to);
        });

        if (!cancelled) {
          const techTotal = filteredTechPayments.reduce((sum: number, p: { amount: number }) => sum + (Number(p.amount) || 0), 0);
          setTechnicalPaymentsTotal(techTotal);
        }
      } catch (error) {
        console.error("Error loading technical payments total:", error);
        if (!cancelled) {
          setTechnicalPaymentsTotal(0);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [user, isAdminLike, dateRange]);

  // ── Fetch referral split (admin-like only, current month by closedAt) ───
  useEffect(() => {
    if (!user || !isAdminLike || !dateRange) {
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
  }, [user, isAdminLike, dateRange]);

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
  const kpiMode = (dateRange && isSingleDay(dateRange)) ? "daily" : "monthly";
  const scopeLabel = isAgent
    ? "Just you"
    : isTeamLead
      ? "Your team"
      : "All members";
  const holidayDateKeys = useMemo(
    () => holidayCalendar.map((holiday) => holiday.date).filter(Boolean),
    [holidayCalendar],
  );

  useEffect(() => {
    if (holidayDateKeys.length === 0 || !dateRange) return;
    if (!dateRange.from || !dateRange.to || dateRange.from !== dateRange.to) return;
    if (!holidayDateKeys.includes(dateRange.from)) return;

    const previousWorkingDay = (() => {
      const cursor = new Date(`${dateRange.from}T00:00:00`);
      for (let i = 0; i < 370; i += 1) {
        const year = cursor.getFullYear();
        const month = String(cursor.getMonth() + 1).padStart(2, "0");
        const day = String(cursor.getDate()).padStart(2, "0");
        const iso = `${year}-${month}-${day}`;
        if (countWorkingDaysInRange(iso, iso, holidayDateKeys) > 0) {
          return iso;
        }
        cursor.setDate(cursor.getDate() - 1);
      }
      return null;
    })();

    if (previousWorkingDay) {
      setDateRange({ from: previousWorkingDay, to: previousWorkingDay });
    }
  }, [dateRange?.from, dateRange?.to, holidayDateKeys]);

  // Use rows[0] as the source of truth once loaded; otherwise compute a
  // fallback from the range so the UI never shows "0" on load. The
  // target is the count of working days (Mon-Fri) in the range — a
  // 31-day month has roughly 22 working days, a one-week range has 5.
  const kpiTarget: number = (() => {
    if (kpiRows && kpiRows.length > 0) return kpiRows[0].target;
    if (!dateRange) return 0;
    const fromIso = dateRange.from ?? getTodayEst();
    const toIso = dateRange.to ?? fromIso;
    return countWorkingDaysInRange(fromIso, toIso, holidayDateKeys);
  })();

  async function reloadHolidayAwareDashboardData() {
    clearDashboardDataCache();
    if (!user || !dateRange) return;

    const [holidays, topMetricsResult, leadRows, linkedinRows] =
      await Promise.all([
        loadDashboardHolidayCalendar(user.$id),
        loadDashboardTopMetrics({
          userId: user.$id,
          role: user.role,
          branchIds: user.branchIds,
          dateRange,
        }),
        loadLeadTargetProgress({
          userId: user.$id,
          role: user.role,
          branchIds: user.branchIds,
          dateRange,
        }),
        loadLinkedinConnectionKpiProgress({
          userId: user.$id,
          role: user.role,
          branchIds: user.branchIds,
          dateRange,
        }),
      ]);

    setHolidayCalendar(holidays);
    setTopMetrics(topMetricsResult);
    setKpiRows(leadRows);
    setLinkedinKpiRows(linkedinRows);
  }

  const initialLoading = !user || !dateRange;

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
          <DashboardDateRange
            value={dateRange!}
            onChange={handleDateRangeChange}
            disabledDates={holidayDateKeys}
            disableHolidaySelection
          />
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
        rangeLabel={dateRange ? rangeLabel(dateRange) : ""}
      />

      {/* LinkedIn daily/monthly Connection limit KPI */}
      {(isAdminLike || isTeamLead) && (
        <KpiLinkedinConnectionSection
          rows={linkedinKpiRows}
          isLoading={linkedinKpiLoading}
          mode={kpiMode}
          rangeLabel={dateRange ? rangeLabel(dateRange) : ""}
        />
      )}

      {/* Referral split — admin-only, filtered by date range */}
      {isAdminLike && (
        <ReferralSection
          data={referralData}
          isLoading={referralLoading}
          rangeLabel={dateRange ? rangeLabel(dateRange) : ""}
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
        <PaymentsSection
          records={paymentRecords}
          isLoading={paymentLoading}
          rangeLabel={dateRange ? rangeLabel(dateRange) : ""}
          dateFilter={dateRange!}
          technicalPaymentsTotal={technicalPaymentsTotal}
        />
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

      {isAdmin && (
        <HolidayCalendarSection
          currentUserId={user.$id}
          holidays={holidayCalendar}
          isLoading={holidayLoading}
          onCalendarChanged={reloadHolidayAwareDashboardData}
        />
      )}
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
