"use client";

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import type { TargetReportResult, TargetReportTlRow } from "@/lib/utils/monthly-target-report";

const currency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

const percent = new Intl.NumberFormat("en-US", {
  style: "percent",
  maximumFractionDigits: 1,
});

function badgeFor(percentValue: number | null): { label: string; variant: "default" | "active" | "inactive" } {
  if (percentValue === null) return { label: "No target", variant: "inactive" };
  if (percentValue >= 1) return { label: "Met", variant: "active" };
  if (percentValue >= 0.75) return { label: "On track", variant: "default" };
  return { label: "Below", variant: "inactive" };
}

function TargetBar({ value }: { value: number | null }) {
  if (value === null) return <span className="text-xs text-muted-foreground">—</span>;
  const pct = Math.min(1, Math.max(0, value));
  return (
    <div
      className="h-2 w-full overflow-hidden rounded bg-muted"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(pct * 100)}>
      <div
        className={`h-full ${
          pct >= 1
            ? "bg-emerald-500"
            : pct >= 0.75
              ? "bg-amber-500"
              : "bg-red-500"
        }`}
        style={{ width: `${pct * 100}%` }}
      />
    </div>
  );
}

function TeamRow({ row }: { row: TargetReportTlRow }) {
  return (
    <TableRow>
      <TableCell className="font-medium">
        <div className="flex flex-col">
          <span>{row.teamLeadName}</span>
          {row.needsSplit ? (
            <span className="text-xs text-amber-600">
              Team total set — split across agents not yet configured.
            </span>
          ) : null}
        </div>
      </TableCell>
      <TableCell className="text-right tabular-nums">
        {currency.format(row.target)}
      </TableCell>
      <TableCell className="text-right tabular-nums">
        {currency.format(row.achieved)}
      </TableCell>
      <TableCell className="w-[200px]">
        <div className="flex flex-col gap-1">
          <TargetBar value={row.percent} />
          <span className="text-xs text-muted-foreground">
            {row.percent === null ? "—" : percent.format(row.percent)}
          </span>
        </div>
      </TableCell>
      <TableCell>
        {(() => {
          const b = badgeFor(row.percent);
          return <Badge variant={b.variant}>{b.label}</Badge>;
        })()}
      </TableCell>
      <TableCell className="text-right text-sm text-muted-foreground">
        {row.agents.length}
      </TableCell>
    </TableRow>
  );
}

export interface TargetReportTableProps {
  result: TargetReportResult;
}

export function TargetReportTable({ result }: TargetReportTableProps) {
  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Team Targets
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold tabular-nums">
              {currency.format(result.totals.target)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Achieved
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold tabular-nums">
              {currency.format(result.totals.achieved)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Achievement
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold tabular-nums">
              {result.totals.percent === null
                ? "—"
                : percent.format(result.totals.percent)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Agents
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold tabular-nums">
              {result.totals.agentCount}
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Team breakdown</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Team Lead</TableHead>
                  <TableHead className="text-right">Target</TableHead>
                  <TableHead className="text-right">Achieved</TableHead>
                  <TableHead>Progress</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Agents</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {result.rows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-sm text-muted-foreground">
                      No targets configured for this month.
                    </TableCell>
                  </TableRow>
                ) : (
                  result.rows.map((row) => <TeamRow key={row.teamLeadId} row={row} />)
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {result.rows.some((row) => row.agents.length > 0) ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Per-agent breakdown</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {result.rows.map((row) =>
                row.agents.length === 0 ? null : (
                  <div key={row.teamLeadId} className="space-y-2">
                    <div className="text-sm font-semibold">{row.teamLeadName}</div>
                    <div className="rounded-md border">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Agent</TableHead>
                            <TableHead className="text-right">Target</TableHead>
                            <TableHead className="text-right">Achieved</TableHead>
                            <TableHead>Progress</TableHead>
                            <TableHead className="text-right">Leads</TableHead>
                            <TableHead className="text-right">Not Interested</TableHead>
                            <TableHead className="text-right">Referrals Excluded</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {row.agents.map((agent) => {
                            const b = badgeFor(agent.percent);
                            return (
                              <TableRow key={agent.userId}>
                                <TableCell className="font-medium">
                                  <div className="flex flex-col">
                                    <span>{agent.userName}</span>
                                    <Badge variant={b.variant} className="self-start text-[10px]">
                                      {b.label}
                                    </Badge>
                                  </div>
                                </TableCell>
                                <TableCell className="text-right tabular-nums">
                                  {agent.target > 0 ? currency.format(agent.target) : "—"}
                                </TableCell>
                                <TableCell className="text-right tabular-nums">
                                  {currency.format(agent.achieved)}
                                </TableCell>
                                <TableCell className="w-[200px]">
                                  <div className="flex flex-col gap-1">
                                    <TargetBar value={agent.percent} />
                                    <span className="text-xs text-muted-foreground">
                                      {agent.percent === null
                                        ? "—"
                                        : percent.format(agent.percent)}
                                    </span>
                                  </div>
                                </TableCell>
                                <TableCell className="text-right tabular-nums">
                                  {agent.leadCount}
                                </TableCell>
                                <TableCell
                                  className="text-right tabular-nums"
                                  title={
                                    agent.notInterestedCount > 0
                                      ? `${agent.notInterestedCount} lead${agent.notInterestedCount === 1 ? "" : "s"} marked Not Interested in this month`
                                      : "No leads marked Not Interested in this month"
                                  }
                                >
                                  {agent.notInterestedCount > 0
                                    ? agent.notInterestedCount
                                    : <span className="text-muted-foreground">0</span>}
                                </TableCell>
                                <TableCell className="text-right tabular-nums text-xs text-muted-foreground">
                                  {agent.referralExcludedCount > 0
                                    ? agent.referralExcludedCount
                                    : "—"}
                                </TableCell>
                              </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                    </div>
                  </div>
                ),
              )}
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
