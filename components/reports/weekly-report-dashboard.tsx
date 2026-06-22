"use client";

import { useEffect, useMemo, useState } from "react";
import { DateRangePicker } from "@/components/ui/date-picker";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { getWeeklyReport } from "@/lib/services/weekly-report-service";
import { expandIsoDateToEnd, expandIsoDateToStart } from "@/lib/utils/iso-date-range";
import type { WeeklyReportResult } from "@/app/actions/weekly-report";
import type { User } from "@/lib/types";

function toDateValue(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getDefaultRange(): { from: string; to: string } {
  // Default to the last 30 days instead of "this week" so the report
  // always shows recent activity. The current-week default frequently
  // missed leads for users who created/closed them in the prior week
  // (e.g. Friday after the Monday-start week boundary).
  const today = new Date();
  const start = new Date(today);
  start.setDate(today.getDate() - 29);
  return { from: toDateValue(start), to: toDateValue(today) };
}

const currency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

type Kpi = WeeklyReportResult["teams"][number]["totals"]["kpi"];

/**
 * Inline KPI summary used in the report table — shows met / total day
 * count and a tooltip with the per-day breakdown.
 */
function KpiBadge({ kpi }: { kpi: Kpi }) {
  const ratio = `${kpi.daysMet}/${kpi.totalDays}`;
  const title =
    kpi.daily.length === 0
      ? "KPI: no days in range"
      : kpi.daily
          .map((d) => `${d.date}: ${d.done ? "✓" : "—"}`)
          .join("\n");

  const variant = kpi.daysMet === kpi.totalDays
    ? "active"
    : kpi.daysMet === 0
      ? "inactive"
      : "default";

  return (
    <div className="flex flex-col items-start gap-1">
      <Badge variant={variant} title={title}>
        KPI {ratio}
      </Badge>
      <div className="flex flex-wrap gap-0.5" aria-label="per-day KPI">
        {kpi.daily.map((day) => (
          <span
            key={day.date}
            title={`${day.date}: ${day.done ? "Met (1+ lead)" : "Missed (0 leads)"}`}
            className={
              day.done
                ? "h-2 w-2 rounded-sm bg-emerald-500"
                : "h-2 w-2 rounded-sm bg-amber-400"
            }
          />
        ))}
      </div>
    </div>
  );
}

export function WeeklyReportDashboard({ user }: { user: User }) {
  const [range, setRange] = useState<{ from?: string; to?: string }>(() => getDefaultRange());
  const [report, setReport] = useState<WeeklyReportResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isoRange = useMemo(() => {
    if (!range.from || !range.to) return null;
    return {
      from: expandIsoDateToStart(range.from),
      to: expandIsoDateToEnd(range.to),
    };
  }, [range.from, range.to]);

  useEffect(() => {
    async function load() {
      if (!isoRange) return;
      try {
        setLoading(true);
        setError(null);
        const result = await getWeeklyReport(user.$id, isoRange.from, isoRange.to);
        setReport(result);
      } catch (err) {
        console.error("Failed to load weekly report:", err);
        setReport(null);
        setError("Weekly report is not available for your current permissions.");
      } finally {
        setLoading(false);
      }
    }
    void load();
  }, [isoRange, user.$id]);

  const singleMember = report?.teams.length === 1 && report.teams[0]?.members.length === 1 ? report.teams[0] : null;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="space-y-2">
          <CardTitle>Weekly Report</CardTitle>
          <div className="max-w-md">
            <DateRangePicker value={range} onChange={setRange} />
          </div>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Leads are counted by assigned agent. Calls are completed follow-ups. Upfront is counted when payment status
            first becomes partially/fully paid in the selected range.
          </p>
        </CardContent>
      </Card>

      {error && (
        <Card className="border-destructive">
          <CardContent className="pt-5">
            <p className="text-sm text-muted-foreground">{error}</p>
          </CardContent>
        </Card>
      )}

      {loading && (
        <Card>
          <CardContent className="p-6">
            <p className="text-sm text-muted-foreground">Loading report…</p>
          </CardContent>
        </Card>
      )}

      {!loading && report && singleMember && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">KPI</CardTitle>
            </CardHeader>
            <CardContent>
              <KpiBadge kpi={singleMember.totals.kpi} />
            </CardContent>
          </Card>
          {[
            ["Calls", singleMember.totals.calls],
            ["Followups", singleMember.totals.followups],
            ["Leads", singleMember.totals.leads],
            ["Closures", singleMember.totals.closures],
            ["Cold Calls", singleMember.totals.coldCalls],
            ["Not Interested", singleMember.totals.notInterested],
            ["Upfront", currency.format(singleMember.totals.upfront)],
          ].map(([label, value]) => (
            <Card key={label}>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-semibold">{value as any}</div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {!loading &&
        report &&
        !singleMember &&
        report.teams.filter((team) => Boolean(team.teamLead)).map((team) => (
          <Card key={team.teamLead?.$id ?? "unassigned"}>
            <CardHeader>
              <CardTitle>
                {team.teamLead ? `Team: ${team.teamLead.name}` : "Team: Unassigned"}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <Table>
                <TableHeader>
                  <TableRow className="cursor-default hover:bg-transparent">
                    <TableHead>User</TableHead>
                    <TableHead>Calls</TableHead>
                    <TableHead>Followups</TableHead>
                    <TableHead>Leads</TableHead>
                    <TableHead>Closures</TableHead>
                    <TableHead>Cold Calls</TableHead>
                    <TableHead>Not Interested</TableHead>
                    <TableHead>KPI</TableHead>
                    <TableHead className="text-right">Upfront</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {team.members.map((member) => (
                    <TableRow key={member.user.$id} className="cursor-default">
                      <TableCell className="font-medium">{member.user.name}</TableCell>
                      <TableCell>{member.metrics.calls}</TableCell>
                      <TableCell>{member.metrics.followups}</TableCell>
                      <TableCell>{member.metrics.leads}</TableCell>
                      <TableCell>{member.metrics.closures}</TableCell>
                      <TableCell>{member.metrics.coldCalls}</TableCell>
                      <TableCell>{member.metrics.notInterested}</TableCell>
                      <TableCell><KpiBadge kpi={member.metrics.kpi} /></TableCell>
                      <TableCell className="text-right">{currency.format(member.metrics.upfront)}</TableCell>
                    </TableRow>
                  ))}
                  <TableRow className="cursor-default bg-[var(--surface-1)] hover:bg-[var(--surface-1)]">
                    <TableCell className="font-semibold">Total</TableCell>
                    <TableCell className="font-semibold">{team.totals.calls}</TableCell>
                    <TableCell className="font-semibold">{team.totals.followups}</TableCell>
                    <TableCell className="font-semibold">{team.totals.leads}</TableCell>
                    <TableCell className="font-semibold">{team.totals.closures}</TableCell>
                    <TableCell className="font-semibold">{team.totals.coldCalls}</TableCell>
                    <TableCell className="font-semibold">{team.totals.notInterested}</TableCell>
                    <TableCell><KpiBadge kpi={team.totals.kpi} /></TableCell>
                    <TableCell className="text-right font-semibold">{currency.format(team.totals.upfront)}</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        ))}
    </div>
  );
}
