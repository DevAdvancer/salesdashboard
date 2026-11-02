"use client";

import { useAuth } from "@/lib/contexts/auth-context";
import { useRouter } from "next/navigation";
import { useEffect, useState, useMemo } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ProtectedRoute } from "@/components/protected-route";
import { Button } from "@/components/ui/button";
import { DashboardDateRange } from "@/components/dashboard/dashboard-date-range";
import { NotificationBell } from "@/components/notification-bell";
import { useCurrentMonthBounds } from '@/lib/hooks/use-current-month-bounds';
import { reportingPeriodThroughToday } from '@/lib/utils/reporting-period';
import type { DateRange } from "@/lib/utils/dashboard-kpi";
import { getResumeDashboardDataAction, type ResumeDashboardData } from "@/app/actions/resume-dashboard";
import { ResumeTopMetrics } from "@/components/resume-dashboard/resume-top-metrics";
import { ResumeCharts } from "@/components/resume-dashboard/resume-charts";
import { ResumeKpiTable } from "@/components/resume-dashboard/resume-kpi-table";
import { ResumeRecentActivity } from "@/components/resume-dashboard/resume-recent-activity";

function ResumeDashboardContent() {
  const { user, isAdmin, isMonitor, isOperations, activeDashboard } = useAuth();
  const router = useRouter();
  const reportingPeriod = useCurrentMonthBounds();
  const [customRange, setCustomRange] = useState<DateRange | null>(null);

  // Guard
  const canBeOnResumeView = isAdmin || isMonitor || isOperations || activeDashboard === "resume";

  // State
  const [rangeMode, setRangeMode] = useState(() => typeof window !== 'undefined' && window.localStorage.getItem('resume_dashboard_date_filter') === 'month' ? 'month' : 'today');
  const dateRange = useMemo(() => customRange || (rangeMode === 'month' ? reportingPeriodThroughToday(reportingPeriod, reportingPeriod.today) : { from: reportingPeriod.today, to: reportingPeriod.today }), [customRange, rangeMode, reportingPeriod.leadsFromIso, reportingPeriod.leadsToIso, reportingPeriod.today]);
  const [dashboardData, setDashboardData] = useState<ResumeDashboardData | null>(null);
  const [loading, setLoading] = useState(true);

  const handleDateRangeChange = (newRange: DateRange) => {
    const month = reportingPeriodThroughToday(reportingPeriod, reportingPeriod.today);
    const mode = newRange.from === month.from && newRange.to === month.to ? 'month' : newRange.from === reportingPeriod.today && newRange.to === reportingPeriod.today ? 'today' : 'custom';
    setRangeMode(mode);
    setCustomRange(mode === 'custom' ? newRange : null);
    if (newRange.from && newRange.to && newRange.from === newRange.to) {
      localStorage.setItem('resume_dashboard_date_filter', 'today');
    } else {
      localStorage.setItem('resume_dashboard_date_filter', 'month');
    }
  };

  useEffect(() => {
    if (user && canBeOnResumeView && !reportingPeriod.isLoading && dateRange) {
      let cancelled = false;
      setLoading(true);
      
      getResumeDashboardDataAction(dateRange)
        .then(data => {
          if (!cancelled) {
            setDashboardData(data);
            setLoading(false);
          }
        })
        .catch(err => {
          console.error("Failed to load resume dashboard data", err);
          if (!cancelled) setLoading(false);
        });

      return () => {
        cancelled = true;
      };
    }
  }, [user, canBeOnResumeView, dateRange, reportingPeriod.isLoading]);

  if (user && !canBeOnResumeView) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Access denied</CardTitle>
          <CardDescription>
            You don&apos;t have access to this dashboard. Returning you to the sales dashboard...
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="outline" onClick={() => router.replace("/dashboard")}>
            Go to Sales Dashboard
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (!user) return null;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold">Resume Dashboard</h1>
          <p className="text-muted-foreground mt-1">
            Welcome back, {user.name}
          </p>
        </div>
        
        <div className="flex items-center gap-2 self-start sm:self-auto">
          <NotificationBell />
          <DashboardDateRange
            customMonthStart={reportingPeriod.leadsFromIso}
            customMonthEnd={reportingPeriod.leadsToIso}
            value={dateRange}
            onChange={handleDateRangeChange}
          />
        </div>
      </div>

      <ResumeTopMetrics metrics={dashboardData?.topMetrics} loading={loading} />

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-2">
        <ResumeCharts stageDistribution={dashboardData?.stageDistribution} loading={loading} />
        <ResumeRecentActivity activities={dashboardData?.recentActivities} loading={loading} />
      </div>
      <div className="mt-6">
        <ResumeKpiTable kpiRows={dashboardData?.kpiRows} loading={loading} />
      </div>

    </div>
  );
}

export default function ResumeDashboardPage() {
  return (
    <ProtectedRoute componentKey="resume-dashboard">
      <ResumeDashboardContent />
    </ProtectedRoute>
  );
}