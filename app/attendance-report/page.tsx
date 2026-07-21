"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/lib/contexts/auth-context";
import { ProtectedRoute } from "@/components/protected-route";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { DatePicker, DateRangePicker } from "@/components/ui/date-picker";
import { getAttendanceReportAction, listTeamLeadsAttendanceForAdminAction } from "@/app/actions/attendance";

type ReportResult = Awaited<ReturnType<typeof getAttendanceReportAction>>;
type TeamReport = ReportResult["teams"][number];
type AgentRow = TeamReport["agents"][number];

export default function AttendanceReportPage() {
  return (
    <ProtectedRoute componentKey="attendance-report">
      <AttendanceReportContent />
    </ProtectedRoute>
  );
}

function StatusBadge({ present, flagged }: { present: boolean; flagged?: boolean }) {
  if (present && flagged) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">
        <span className="w-1.5 h-1.5 rounded-full bg-yellow-500 inline-block" />
        Present (Flagged)
      </span>
    );
  }
  if (present) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800">
        <span className="w-1.5 h-1.5 rounded-full bg-green-500 inline-block" />
        Present
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium bg-red-100 text-red-800">
      <span className="w-1.5 h-1.5 rounded-full bg-red-500 inline-block" />
      Absent
    </span>
  );
}

function getTodayKey() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function AttendanceReportContent() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<ReportResult | null>(null);
  const [selectedDateRange, setSelectedDateRange] = useState<{ from?: string; to?: string }>(() => {
    const today = getTodayKey();
    return { from: today, to: today };
  });
  const [teamLeadOptions, setTeamLeadOptions] = useState<Array<{ userId: string; userName: string }>>([]);
  const [selectedTeamLeadId, setSelectedTeamLeadId] = useState<string>(""); // empty = all

  const todayKey = useMemo(() => {
    return getTodayKey();
  }, []);

  const isAdminLike =
    user?.role === "admin" ||
    user?.role === "developer" ||
    user?.role === "monitor" ||
    user?.role === "operations";

  // Load team lead options for admin/monitor
  useEffect(() => {
    if (!user || !isAdminLike) return;
    listTeamLeadsAttendanceForAdminAction({
      currentUserId: user.$id,
      dateKey: todayKey,
      departmentScope: "sales",
    }).then((data) => {
      setTeamLeadOptions(data.delegateOptions);
    }).catch(() => {});
  }, [user, isAdminLike, todayKey]);

  const loadReport = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setError(null);
    try {
      const result = await getAttendanceReportAction({
        currentUserId: user.$id,
        startDateKey: selectedDateRange.from || undefined,
        endDateKey: selectedDateRange.to || undefined,
        teamLeadId: isAdminLike && selectedTeamLeadId ? selectedTeamLeadId : undefined,
        departmentScope: "sales",
      });
      setReport(result);
      if (!selectedDateRange.from) {
        setSelectedDateRange({ from: result.startDateKey, to: result.endDateKey });
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load attendance report");
    } finally {
      setLoading(false);
    }
  }, [user, selectedDateRange, selectedTeamLeadId, isAdminLike]);

  useEffect(() => {
    loadReport();
  }, [loadReport]);

  if (!user) return null;

  // Summary counts
  const summary = useMemo(() => {
    if (!report) return null;
    let totalAgents = 0;
    let presentAgents = 0;
    let absentAgents = 0;
    let withDelegate = 0;
    let tlPresent = 0;
    let tlAbsent = 0;

    for (const team of report.teams) {
      if (team.teamLeadPresent) tlPresent++;
      else tlAbsent++;

      for (const agent of team.agents) {
        totalAgents++;
        if (agent.present) presentAgents++;
        else absentAgents++;
        if (agent.delegateUserId) withDelegate++;
      }
    }
    return { totalAgents, presentAgents, absentAgents, withDelegate, tlPresent, tlAbsent };
  }, [report]);

  return (
    <div className="container mx-auto">
      {/* Header */}
      <div className="flex flex-col gap-2 mb-6">
        <h1 className="text-2xl md:text-3xl font-bold">Attendance Report</h1>
        <p className="text-muted-foreground text-sm">
          {isAdminLike
            ? "Full visibility across all teams — view only."
            : "Your team's attendance overview."}
        </p>

        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between mt-2">
          <div className="flex flex-col sm:flex-row gap-3 sm:items-end">
            <div className="max-w-xs">
              <Label htmlFor="report-date">Date (ET)</Label>
              <DateRangePicker
                id="report-date"
                value={selectedDateRange}
                onChange={setSelectedDateRange}
                align="left"
              />
            </div>

            {isAdminLike && teamLeadOptions.length > 0 && (
              <div className="max-w-xs">
                <Label htmlFor="report-team-lead">Filter by Team</Label>
                <select
                  id="report-team-lead"
                  className="mt-1 w-full h-10 pl-3 pr-8 rounded-md border border-input bg-background text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  value={selectedTeamLeadId}
                  onChange={(e) => setSelectedTeamLeadId(e.target.value)}
                >
                  <option value="">All Teams</option>
                  {teamLeadOptions.map((tl) => (
                    <option key={tl.userId} value={tl.userId}>
                      {tl.userName}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          <Button variant="outline" onClick={loadReport} disabled={loading}>
            {loading ? "Loading..." : "Refresh"}
          </Button>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="p-3 mb-4 border border-red-200 bg-red-50 rounded-md text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Summary Cards */}
      {!loading && summary && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
          {[
            { label: "Total Agents", value: summary.totalAgents, color: "text-foreground" },
            { label: "Present", value: summary.presentAgents, color: "text-green-600" },
            { label: "Absent", value: summary.absentAgents, color: "text-red-600" },
            { label: "Working on Behalf", value: summary.withDelegate, color: "text-blue-600" },
            ...(isAdminLike
              ? [
                  { label: "TLs Present", value: summary.tlPresent, color: "text-green-600" },
                  { label: "TLs Absent", value: summary.tlAbsent, color: "text-red-600" },
                ]
              : []),
          ].map((stat) => (
            <Card key={stat.label} className="text-center p-3">
              <p className={`text-2xl font-bold ${stat.color}`}>{stat.value}</p>
              <p className="text-xs text-muted-foreground mt-1">{stat.label}</p>
            </Card>
          ))}
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-16 text-muted-foreground text-sm">
          Loading report…
        </div>
      )}

      {/* Teams */}
      {!loading && !error && report && report.teams.length === 0 && (
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground text-sm">
            No data found for this date.
          </CardContent>
        </Card>
      )}

      {!loading && !error && report && report.teams.map((team) => (
        <TeamReportCard 
          key={team.teamLeadId} 
          team={team} 
          isRange={report.startDateKey !== report.endDateKey} 
        />
      ))}
    </div>
  );
}

function TeamReportCard({ team, isRange }: { team: TeamReport; isRange: boolean }) {
  const presentCount = team.agents.filter((a) => a.present).length;
  const absentCount = team.agents.filter((a) => !a.present).length;
  const delegateCount = team.agents.filter((a) => a.delegateUserId).length;

  return (
    <Card className="mb-5">
      <CardHeader className="pb-3">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2">
          <div>
            <CardTitle className="text-base font-semibold">{team.teamLeadName}</CardTitle>
            <div className="flex flex-wrap items-center gap-2 mt-1">
              {!isRange && <StatusBadge present={team.teamLeadPresent} />}
              {isRange ? (
                <span className="text-xs font-medium">
                  {team.teamLeadPresentDays} Present, {team.teamLeadTotalRecords - team.teamLeadPresentDays} Absent
                </span>
              ) : (
                team.teamLeadPresentAt && (
                  <span className="text-xs text-muted-foreground">
                    at {new Date(team.teamLeadPresentAt).toLocaleTimeString()}
                  </span>
                )
              )}
              {team.teamLeadDelegateName && (
                <span className="text-xs text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full border border-amber-200">
                  Covered by: {team.teamLeadDelegateName}
                </span>
              )}
            </div>
          </div>

          <div className="flex gap-3 text-sm shrink-0">
            <span className="text-green-600 font-medium">{presentCount} present</span>
            <span className="text-muted-foreground">·</span>
            <span className="text-red-600 font-medium">{absentCount} absent</span>
            {delegateCount > 0 && (
              <>
                <span className="text-muted-foreground">·</span>
                <span className="text-blue-600 font-medium">{delegateCount} delegated</span>
              </>
            )}
          </div>
        </div>
      </CardHeader>

      <CardContent>
        {team.agents.length === 0 ? (
          <p className="text-sm text-muted-foreground">No agents in this team.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="text-left p-3 font-medium">Agent</th>
                  <th className="text-left p-3 font-medium">Status</th>
                  {!isRange && <th className="text-left p-3 font-medium">Present At</th>}
                  <th className="text-left p-3 font-medium">Worked on Behalf of</th>
                  <th className="text-left p-3 font-medium">Assigned By</th>
                  <th className="text-left p-3 font-medium">LinkedIn IDs</th>
                </tr>
              </thead>
              <tbody>
                {team.agents.map((agent) => (
                  <AgentReportRow key={agent.userId} agent={agent} isRange={isRange} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function AgentReportRow({ agent, isRange }: { agent: AgentRow; isRange: boolean }) {
  return (
    <tr className="border-b hover:bg-muted/30 transition-colors">
      <td className="p-3">
        <div>
          <p className="font-medium">{agent.userName}</p>
          {agent.role === "lead_generation" && (
            <p className="text-xs text-muted-foreground">Lead Gen</p>
          )}
        </div>
      </td>
      <td className="p-3">
        <div className="flex flex-col gap-1 items-start">
          {!isRange && (
            <StatusBadge present={agent.present} flagged={agent.presentWithDelegateFlag} />
          )}
          {isRange && agent.totalRecords > 0 && (
            <span className="text-sm font-medium">
              {agent.presentDays} Present, {agent.totalRecords - agent.presentDays} Absent
            </span>
          )}
        </div>
      </td>
      {!isRange && (
        <td className="p-3 text-muted-foreground">
          {agent.presentAt ? new Date(agent.presentAt).toLocaleTimeString() : "—"}
        </td>
      )}
      <td className="p-3">
        {agent.delegateUserName ? (
          <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium bg-blue-50 text-blue-700 border border-blue-200">
            {agent.delegateUserName}
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </td>
      <td className="p-3 text-muted-foreground text-xs">
        {agent.assignedByName ?? "—"}
      </td>
      <td className="p-3 text-muted-foreground text-xs">
        {agent.linkedinAccounts.length === 0
          ? "—"
          : agent.linkedinAccounts
              .map((a) => `${a.company}: ${a.idName}`)
              .join(", ")}
      </td>
    </tr>
  );
}
