// app/dashboard/DashboardServer.tsx
// Server component – no "use client" directive
import { type DateRange } from "@/lib/utils/dashboard-kpi";
import { type User } from "@/lib/types";
import { loadDashboardData, loadDashboardTopMetrics, loadLeadTargetProgress, loadLinkedinConnectionKpiProgress, loadDashboardPaymentInsights, loadDashboardReferralStats, loadLgHandoffSummaries, loadDashboardHolidayCalendar } from "@/lib/services/dashboard-data-service";
import { TopMetricsRow } from "@/components/dashboard/top-metrics-row";
import { KpiLeadTargetSection } from "@/components/dashboard/kpi-lead-target-section";
import { KpiLinkedinConnectionSection } from "@/components/dashboard/kpi-linkedin-connection-section";
import { HolidayCalendarSection } from "@/components/dashboard/holiday-calendar-section";
import { ReferralSection } from "@/components/dashboard/referral-section";
import { PaymentsSection } from "@/components/dashboard/payments-section";
import { LgHandoffSection } from "@/components/dashboard/lg-handoff-section";
import { AttendanceSelfToggle } from "@/components/attendance-self-toggle";
import { DashboardDateRange } from "@/components/dashboard/dashboard-date-range";
import { Button } from "@/components/ui/button";
import { useRouter } from "next/navigation";
import { getMonthStartEst, getMonthEndEst, getTodayEst } from "@/lib/utils/est-date";
import { rangeLabel } from "@/lib/utils/dashboard-kpi";
import { Skeleton } from "@/components/ui/skeleton";

interface DashboardServerProps {
  user: User;
  isAdminLike: boolean;
  isTeamLead: boolean;
  isAdmin: boolean;
  isMonitor: boolean;
  isOperations: boolean;
  dateRange: DateRange;
}

export default async function DashboardServer({
  user,
  isAdminLike,
  isTeamLead,
  isAdmin,
  isMonitor,
  isOperations,
  dateRange,
}: DashboardServerProps) {
  // Load all needed dashboard data on the server (cached via client-read-cache)
  const [
    topMetrics,
    kpiRows,
    linkedinKpiRows,
    paymentRecords,
    referralData,
    handoffSummaries,
    holidayCalendar,
  ] = await Promise.all([
    loadDashboardTopMetrics({ user, isAdminLike, isTeamLead, includeAllBranchesForAdminLike: true, includeAssignedAgents: true }),
    loadLeadTargetProgress({ user, isAdminLike, isTeamLead, includeAllBranchesForAdminLike: true, includeAssignedAgents: true, dateRange }),
    loadLinkedinConnectionKpiProgress({ user, isAdminLike, isTeamLead, includeAllBranchesForAdminLike: true, includeAssignedAgents: true, dateRange }),
    loadDashboardPaymentInsights(user.$id, { from: getMonthStartEst(new Date()), to: getMonthEndEst(new Date()) }),
    loadDashboardReferralStats({ user, isAdminLike, dateRange }),
    loadLgHandoffSummaries({ user, isAdminLike, dateRange }),
    loadDashboardHolidayCalendar(user.$id),
  ]);

  const visibilityLabel = isAdminLike ? "Assigned to you" : "Total active leads";

  const router = useRouter();

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold">Dashboard</h1>
          <p className="text-muted-foreground mt-1">Welcome back, {user.name}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <DashboardDateRange
            value={dateRange}
            onChange={() => {}}
            disabledDates={[]}
            disableHolidaySelection
          />
          <AttendanceSelfToggle />
        </div>
      </div>

      {/* Top metrics */}
      <TopMetricsRow metrics={topMetrics} isLoading={false} visibilityLabel={visibilityLabel} />

      {/* KPI sections */}
      <KpiLeadTargetSection rows={kpiRows} isLoading={false} mode="monthly" target={0} scopeLabel="" rangeLabel={rangeLabel(dateRange)} />
      {(isAdminLike || isTeamLead) && (
        <KpiLinkedinConnectionSection rows={linkedinKpiRows} isLoading={false} mode="monthly" rangeLabel={rangeLabel(dateRange)} />
      )}

      {/* Referral */}
      {isAdminLike && (
        <ReferralSection data={referralData} isLoading={false} rangeLabel={rangeLabel(dateRange)} />
      )}

      {/* LG → TL Handoff */}
      {isAdminLike && (
        <LgHandoffSection summaries={handoffSummaries} isLoading={false} />
      )}

      {/* Payments */}
      {isAdminLike && (
        <PaymentsSection
          records={paymentRecords}
          isLoading={false}
          rangeLabel={rangeLabel(dateRange)}
          dateFilter={dateRange}
          technicalPaymentsTotal={0}
        />
      )}

      {/* Footer quick actions */}
      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
        <Button variant="outline" onClick={() => router.push("/leads")}>View Leads</Button>
        {isTeamLead && (
          <Button variant="outline" onClick={() => router.push("/linkedin-requests")}>LinkedIn Requests</Button>
        )}
        {(isAdminLike || isTeamLead) && (
          <Button variant="outline" onClick={() => router.push("/users")}> {isAdminLike && !isMonitor && !isOperations ? "Manage Users" : "View Users"} </Button>
        )}
        {isAdmin && (
          <Button variant="outline" onClick={() => router.push("/payments-report")}>Payments Report</Button>
        )}
      </div>

      {isAdmin && (
        <HolidayCalendarSection
          currentUserId={user.$id}
          holidays={holidayCalendar}
          isLoading={false}
          onCalendarChanged={() => {}}
        />
      )}
    </div>
  );
}
