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
import type { LinkedinConnectionKpiRow } from "@/app/actions/linkedin";

const KpiPieChart = dynamic(
  () =>
    import("@/components/dashboard/kpi-pie-chart").then((m) => m.KpiPieChart),
  { loading: () => <Skeleton className="h-[260px] w-full" />, ssr: false }
);

interface KpiLinkedinConnectionSectionProps {
  rows: LinkedinConnectionKpiRow[] | null;
  isLoading: boolean;
  mode: "daily" | "monthly";
  rangeLabel: string;
}

export function KpiLinkedinConnectionSection({
  rows,
  isLoading,
  mode,
  rangeLabel,
}: KpiLinkedinConnectionSectionProps) {
  const [open, setOpen] = useState<"complete" | "incomplete" | null>(null);

  const { completed, pending, completedRows, pendingRows, totalActive } = useMemo(() => {
    const all = rows ?? [];
    const completedRows = all.filter((r) => r.target > 0 && r.sentCount >= r.target);
    const pendingRows = all.filter((r) => r.target > 0 && r.sentCount < r.target);
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
    <Card id="tour-linkedin-kpi-target">
      <CardHeader>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2 text-base sm:text-lg">
              {mode === "daily"
                ? "LinkedIn Daily Connection target — members that hit their daily limit"
                : "LinkedIn Connection target — members that hit their connection limit"}
              <Badge variant="default" className="capitalize">
                {mode}
              </Badge>
            </CardTitle>
            <CardDescription>
              {rangeLabel} · target = connection limit * working days
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
            No active members with LinkedIn accounts in scope for this period.
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
                Click a slice to see details.
              </p>
            </div>
            <div className="space-y-2">
              <SummaryRow
                tone="success"
                label="Completed Target"
                value={completed}
                total={totalActive}
                pct={completedPct}
                onClick={() => setOpen("complete")}
              />
              <SummaryRow
                tone="warning"
                label="Missed Target"
                value={pending}
                total={totalActive}
                pct={100 - completedPct}
                onClick={() => setOpen("incomplete")}
              />
              <p className="pt-2 text-xs text-muted-foreground">
                Showing active members assigned to LinkedIn accounts in the user&apos;s scope.
              </p>
            </div>
          </div>
        )}
      </CardContent>

      <KpiAccountsDialog
        open={open === "complete"}
        onOpenChange={(o) => setOpen(o ? "complete" : null)}
        title="LinkedIn Members that completed connection limits"
        description={`${completedRows.length} of ${totalActive} active member${totalActive === 1 ? "" : "s"} met the target connection limit.`}
        rows={completedRows}
        emptyMessage="No members have completed connection limits yet."
        tone="success"
      />
      <KpiAccountsDialog
        open={open === "incomplete"}
        onOpenChange={(o) => setOpen(o ? "incomplete" : null)}
        title="LinkedIn Members that missed connection limits"
        description={`${pendingRows.length} of ${totalActive} active member${totalActive === 1 ? "" : "s"} missed the target connection limit.`}
        rows={pendingRows}
        emptyMessage="All members in scope met their targets."
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

function KpiAccountsDialog({
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
  rows: LinkedinConnectionKpiRow[];
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
                key={row.accountId}
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
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    Accounts: {row.company}
                  </div>
                </div>
                <div className="shrink-0 text-right text-sm tabular-nums">
                  <span className={cn("font-semibold", tone === "success" ? "text-emerald-700" : "text-amber-700")}>
                    {row.sentCount}
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
