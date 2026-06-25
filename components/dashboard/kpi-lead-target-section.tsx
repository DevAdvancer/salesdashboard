"use client";

import { useMemo, useState } from "react";
import dynamic from "next/dynamic";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Check, Minus, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { KpiRow } from "@/lib/utils/dashboard-kpi";

const KpiPieChart = dynamic(
  () =>
    import("@/components/dashboard/kpi-pie-chart").then((m) => m.KpiPieChart),
  { loading: () => <Skeleton className="h-[260px] w-full" />, ssr: false }
);

interface KpiLeadTargetSectionProps {
  rows: KpiRow[] | null;
  isLoading: boolean;
  mode: "daily" | "monthly";
  target: number;
  scopeLabel: string;
  rangeLabel: string;
}

function roleLabel(role: string): string {
  if (role === "team_lead") return "Team lead";
  if (role === "lead_generation") return "Lead gen";
  return role.charAt(0).toUpperCase() + role.slice(1);
}

export function KpiLeadTargetSection({
  rows,
  isLoading,
  mode,
  target,
  scopeLabel,
  rangeLabel,
}: KpiLeadTargetSectionProps) {
  const [open, setOpen] = useState<"complete" | "incomplete" | null>(null);

  const { completed, pending, completedRows, pendingRows, totalActive } = useMemo(() => {
    const all = rows ?? [];
    const completedRows = all.filter((r) => r.leadCount >= r.target);
    const pendingRows = all.filter((r) => r.leadCount < r.target);
    return {
      completed: completedRows.length,
      pending: pendingRows.length,
      completedRows,
      pendingRows,
      totalActive: all.length,
    };
  }, [rows]);

  const completedPct = totalActive > 0 ? Math.round((completed / totalActive) * 100) : 0;

  return (
    <Card id="tour-kpi-target">
      <CardHeader>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2 text-base sm:text-lg">
              {mode === "daily"
                ? "Lead target — every member should add at least 1 lead today"
                : "Lead target — every member should add at least 1 lead per working day"}
              <Badge variant="default" className="capitalize">
                {mode}
              </Badge>
            </CardTitle>
            <CardDescription>
              {scopeLabel} · {rangeLabel} · target = {target} lead{target === 1 ? "" : "s"}
              {mode === "monthly" ? " (Mon–Fri)" : ""}
            </CardDescription>
          </div>
          <div className="text-sm text-muted-foreground">
            <span className="font-semibold text-foreground">{totalActive}</span> active member{totalActive === 1 ? "" : "s"} in scope
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="grid gap-6 md:grid-cols-2">
            <Skeleton className="h-[260px] w-full" />
            <div className="space-y-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-9 w-full" />
              ))}
            </div>
          </div>
        ) : totalActive === 0 ? (
          <div className="flex h-24 items-center justify-center rounded-md border border-dashed border-[var(--hairline)] text-sm text-[var(--mute)]">
            No active members in scope for this period.
          </div>
        ) : (
          <div className="grid gap-6 md:grid-cols-2">
            <div>
              <KpiPieChart
                completed={completed}
                pending={pending}
                onSliceClick={(slice) => setOpen(slice)}
              />
              <p className="mt-2 text-center text-xs text-muted-foreground">
                Click a slice to see who fell short.
              </p>
            </div>
            <div className="space-y-2">
              <SummaryRow
                tone="success"
                label="Completed KPI"
                value={completed}
                total={totalActive}
                pct={completedPct}
                onClick={() => setOpen("complete")}
              />
              <SummaryRow
                tone="warning"
                label="Missed KPI"
                value={pending}
                total={totalActive}
                pct={100 - completedPct}
                onClick={() => setOpen("incomplete")}
              />
              <p className="pt-2 text-xs text-muted-foreground">
                Showing active agents and team leads in the user&apos;s scope (department / branch / reports).
              </p>
            </div>
          </div>
        )}
      </CardContent>

      <KpiMembersDialog
        open={open === "complete"}
        onOpenChange={(o) => setOpen(o ? "complete" : null)}
        title="Members who completed their KPI"
        description={`${completedRows.length} of ${totalActive} active member${totalActive === 1 ? "" : "s"} met the target of ${target} lead${target === 1 ? "" : "s"}.`}
        rows={completedRows}
        emptyMessage="No one has met the target yet."
        tone="success"
      />
      <KpiMembersDialog
        open={open === "incomplete"}
        onOpenChange={(o) => setOpen(o ? "incomplete" : null)}
        title="Members who missed their KPI"
        description={`${pendingRows.length} of ${totalActive} active member${totalActive === 1 ? "" : "s"} are below the target of ${target} lead${target === 1 ? "" : "s"}.`}
        rows={pendingRows}
        emptyMessage="Everyone in scope has met their target."
        tone="warning"
      />
    </Card>
  );
}

function SummaryRow({
  tone,
  label,
  value,
  total,
  pct,
  onClick,
}: {
  tone: "success" | "warning";
  label: string;
  value: number;
  total: number;
  pct: number;
  onClick: () => void;
}) {
  const isSuccess = tone === "success";
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-center justify-between gap-3 rounded-lg border px-3 py-2 text-left transition-colors hover:bg-[var(--soft-cloud)]/60",
        isSuccess ? "border-emerald-200" : "border-amber-200",
      )}
    >
      <div className="flex items-center gap-2">
        <span
          className={cn(
            "flex h-6 w-6 items-center justify-center rounded-full",
            isSuccess ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700",
          )}
        >
          {isSuccess ? <Check className="h-3.5 w-3.5" /> : <Minus className="h-3.5 w-3.5" />}
        </span>
        <span className="text-sm font-medium">{label}</span>
      </div>
      <div className="text-right text-sm tabular-nums">
        <span className={cn("font-semibold", isSuccess ? "text-emerald-700" : "text-amber-700")}>
          {value}
        </span>
        <span className="text-muted-foreground"> / {total}</span>
        <span className="ml-2 text-xs text-muted-foreground">({pct}%)</span>
      </div>
    </button>
  );
}

function KpiMembersDialog({
  open,
  onOpenChange,
  title,
  description,
  rows,
  emptyMessage,
  tone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  rows: KpiRow[];
  emptyMessage: string;
  tone: "success" | "warning";
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {rows.length === 0 ? (
          <div className="flex h-24 items-center justify-center rounded-md border border-dashed border-[var(--hairline)] text-sm text-[var(--mute)]">
            {emptyMessage}
          </div>
        ) : (
          <ul className="max-h-[60vh] space-y-1 overflow-y-auto">
            {rows.map((row) => (
              <li
                key={row.userId}
                className="flex items-center gap-3 rounded-md border border-[var(--hairline-soft)] px-3 py-2"
              >
                <span
                  className={cn(
                    "flex h-7 w-7 shrink-0 items-center justify-center rounded-full",
                    tone === "success"
                      ? "bg-emerald-100 text-emerald-700"
                      : "bg-amber-100 text-amber-700",
                  )}
                >
                  {tone === "success" ? (
                    <Check className="h-4 w-4" />
                  ) : (
                    <X className="h-4 w-4" />
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium">{row.userName}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {roleLabel(row.userRole)}
                    </span>
                  </div>
                  {row.assignedLeadCount !== undefined && (
                    <div className="text-xs text-muted-foreground mt-0.5">
                      Assigned: {row.assignedLeadCount} lead{row.assignedLeadCount === 1 ? "" : "s"}
                    </div>
                  )}
                </div>
                <div className="shrink-0 text-right text-sm tabular-nums">
                  <span className={cn("font-semibold", tone === "success" ? "text-emerald-700" : "text-amber-700")}>
                    {row.leadCount}
                  </span>
                  <span className="text-muted-foreground"> / {row.target}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
        <div className="flex justify-end">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
