"use client";

import { useState, useEffect } from "react";
import { ProtectedRoute } from "@/components/protected-route";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { getResumeReportsAction } from "@/app/actions/resume-reports";
import { DashboardDateRange } from "@/components/dashboard/dashboard-date-range";
import { getTodayEst } from "@/lib/utils/est-date";
import { formatEasternDateTime } from "@/lib/utils/eastern-date";
import { format } from "date-fns";
import { PhoneCall, CheckCircle2, Clock } from "lucide-react";
import type { DateRange } from "@/lib/utils/dashboard-kpi";

export default function ResumeReportsPage() {
  const defaultDate = getTodayEst();
  const [dateRange, setDateRange] = useState<DateRange>({
    from: defaultDate,
    to: defaultDate,
  });

  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!dateRange.from) return;
    const start = new Date(dateRange.from);
    start.setHours(0, 0, 0, 0);
    
    const end = dateRange.to ? new Date(dateRange.to) : new Date(dateRange.from);
    end.setHours(23, 59, 59, 999);

    setLoading(true);
    setError(null);
    getResumeReportsAction(start.toISOString(), end.toISOString())
      .then(setData)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [dateRange]);

  return (
    <ProtectedRoute componentKey="resume-reports">
      <div className="space-y-6 max-w-[1400px] mx-auto pb-12">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-foreground">Resume Reports</h1>
            <p className="text-muted-foreground mt-1">
              Performance metrics and profile lifecycle timing.
            </p>
          </div>
          <DashboardDateRange
            value={dateRange}
            onChange={(r: DateRange) => {
              if (r) setDateRange(r);
            }}
          />
        </div>

        {error && (
          <div className="p-4 bg-destructive/15 text-destructive rounded-md text-sm font-medium">
            Error loading reports: {error}
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <Card className="shadow-sm">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium">Completed Calls</CardTitle>
              <PhoneCall className="h-4 w-4 text-primary" />
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="h-8 w-16 bg-muted animate-pulse rounded" />
              ) : (
                <>
                  <div className="text-3xl font-bold">{data?.completedCallsCount ?? 0}</div>
                  <p className="text-xs text-muted-foreground mt-1">Calls marked as Done</p>
                </>
              )}
            </CardContent>
          </Card>

          <Card className="shadow-sm">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium">Completed Profiles</CardTitle>
              <CheckCircle2 className="h-4 w-4 text-emerald-500" />
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="h-8 w-16 bg-muted animate-pulse rounded" />
              ) : (
                <>
                  <div className="text-3xl font-bold">{data?.completedProfilesCount ?? 0}</div>
                  <p className="text-xs text-muted-foreground mt-1">Moved to Marketing</p>
                </>
              )}
            </CardContent>
          </Card>

          <Card className="shadow-sm">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium">Avg Completion Time</CardTitle>
              <Clock className="h-4 w-4 text-amber-500" />
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="h-8 w-32 bg-muted animate-pulse rounded" />
              ) : (
                <>
                  <div className="text-3xl font-bold">{data?.avgTimingStr ?? "N/A"}</div>
                  <p className="text-xs text-muted-foreground mt-1">Approval to Marketing</p>
                </>
              )}
            </CardContent>
          </Card>
        </div>

        <Card className="shadow-sm">
          <CardHeader>
            <CardTitle>Team Performance</CardTitle>
            <CardDescription>Performance metrics grouped by team member.</CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="py-12 text-center text-muted-foreground animate-pulse">Loading data...</div>
            ) : !data || data.agentReports.length === 0 ? (
              <div className="py-12 text-center text-muted-foreground">No data found for this date range.</div>
            ) : (
              <div className="rounded-md border overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/40 font-semibold text-left">
                      <th className="p-3">Team Member</th>
                      <th className="p-3 text-right">Completed Calls</th>
                      <th className="p-3 text-right">Completed Profiles</th>
                      <th className="p-3 text-right">Avg Time Taken</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {data.agentReports.map((p: any, idx: number) => (
                      <tr key={idx} className="hover:bg-muted/30">
                        <td className="p-3 font-medium">{p.assignedToName}</td>
                        <td className="p-3 text-right">{p.completedCallsCount}</td>
                        <td className="p-3 text-right">{p.completedProfilesCount}</td>
                        <td className="p-3 text-right font-medium">{p.avgTimingStr}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </ProtectedRoute>
  );
}
