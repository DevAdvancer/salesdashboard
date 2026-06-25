"use client";

import { useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ChevronDown, ChevronUp, Users, ArrowRightLeft } from "lucide-react";
import { cn } from "@/lib/utils";
import type { TeamLeadAssignmentSummary } from "@/lib/utils/dashboard-insights";

interface LgHandoffSectionProps {
  summaries: TeamLeadAssignmentSummary[] | null;
  isLoading: boolean;
}

export function LgHandoffSection({ summaries, isLoading }: LgHandoffSectionProps) {
  const total = summaries?.reduce((s, t) => s + t.assignedLeads, 0) ?? 0;

  return (
    <Card id="tour-lg-handoffs">
      <CardHeader>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2 text-base sm:text-lg">
              <ArrowRightLeft className="h-4 w-4 text-violet-500 shrink-0" />
              Lead Gen → Team Lead Handoffs
            </CardTitle>
            <CardDescription>
              Total leads handed off by Lead Gen actors to Team Leads. Each lead
              is counted once — later reassignments don&apos;t change the tally.
            </CardDescription>
          </div>
          {!isLoading && (
            <div className="shrink-0 text-right">
              <span className="text-2xl font-bold tabular-nums">{total}</span>
              <span className="ml-1 text-sm text-muted-foreground">total handoffs</span>
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-14 w-full" />
            ))}
          </div>
        ) : !summaries || summaries.length === 0 ? (
          <div className="flex h-24 items-center justify-center rounded-md border border-dashed border-[var(--hairline)] text-sm text-[var(--mute)]">
            No handoff records found. Handoffs are recorded when a Lead Gen
            actor assigns a new lead directly to a Team Lead.
          </div>
        ) : (
          <div className="space-y-2">
            {summaries.map((team) => (
              <TeamLeadHandoffRow key={team.teamLeadId} team={team} total={total} />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function TeamLeadHandoffRow({
  team,
  total,
}: {
  team: TeamLeadAssignmentSummary;
  total: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const barPct = total > 0 ? (team.assignedLeads / total) * 100 : 0;

  return (
    <div className="rounded-lg border border-[var(--hairline-soft)] overflow-hidden">
      {/* Main row */}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-[var(--soft-cloud)]/60"
      >
        {/* Avatar */}
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-violet-100 text-violet-700 text-xs font-semibold">
          {team.teamLeadName.charAt(0).toUpperCase()}
        </span>

        {/* Name + bar */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-medium">{team.teamLeadName}</span>
            <Badge variant="default" className="shrink-0 text-xs">
              TL
            </Badge>
          </div>
          {/* Progress bar */}
          <div className="mt-1 h-1.5 w-full rounded-full bg-[var(--hairline)]">
            <div
              className="h-full rounded-full bg-violet-400 transition-all"
              style={{ width: `${barPct}%` }}
            />
          </div>
        </div>

        {/* Count + share */}
        <div className="shrink-0 text-right">
          <span className="text-sm font-semibold tabular-nums text-violet-700">
            {team.assignedLeads}
          </span>
          <span className="ml-1 text-xs text-muted-foreground">
            ({team.assignmentShare}%)
          </span>
        </div>

        {/* Expand chevron */}
        <span className="shrink-0 text-muted-foreground">
          {expanded ? (
            <ChevronUp className="h-4 w-4" />
          ) : (
            <ChevronDown className="h-4 w-4" />
          )}
        </span>
      </button>

      {/* Breakdown */}
      {expanded && team.leadGenerationBreakdown.length > 0 && (
        <div className="border-t border-[var(--hairline)] bg-[var(--soft-cloud)]/30 px-4 py-2 space-y-1.5">
          <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground mb-2">
            <Users className="h-3.5 w-3.5" />
            By Lead Gen actor
          </p>
          {team.leadGenerationBreakdown.map((lg) => {
            const lgPct =
              team.assignedLeads > 0
                ? Math.round((lg.assignedLeads / team.assignedLeads) * 100)
                : 0;
            return (
              <div
                key={lg.leadGenerationId}
                className="flex items-center gap-2 text-sm"
              >
                <span
                  className={cn(
                    "flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold",
                    "bg-emerald-100 text-emerald-700",
                  )}
                >
                  {lg.leadGenerationName.charAt(0).toUpperCase()}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">
                  {lg.leadGenerationName}
                </span>
                <span className="shrink-0 tabular-nums font-medium">
                  {lg.assignedLeads}
                </span>
                <span className="shrink-0 text-xs text-muted-foreground w-9 text-right">
                  ({lgPct}%)
                </span>
              </div>
            );
          })}
        </div>
      )}
      {expanded && team.leadGenerationBreakdown.length === 0 && (
        <div className="border-t border-[var(--hairline)] bg-[var(--soft-cloud)]/30 px-4 py-3 text-xs text-muted-foreground">
          No lead gen breakdown available.
        </div>
      )}
    </div>
  );
}
