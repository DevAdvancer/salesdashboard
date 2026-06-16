"use client";

import { useMemo } from "react";
import { Banknote, CheckCircle2, Clock, Wallet } from "lucide-react";
import type { PaymentsReportRow } from "@/app/actions/client-payments";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const currency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

const dateFormatter = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "2-digit",
});

export interface PaymentsReportSidebarProps {
  rows: PaymentsReportRow[];
}

export function PaymentsReportSidebar({ rows }: PaymentsReportSidebarProps) {
  const stats = useMemo(() => {
    let fullyPaid = 0;
    let partiallyPaid = 0;
    let notPaid = 0;
    let amountPaid = 0;
    let amountPaidCount = 0;
    let totalAmount = 0;
    let mostRecent: { at: string; company: string } | null = null;

    for (const r of rows) {
      if (r.status === "fully_paid") fullyPaid++;
      else if (r.status === "partially_paid") partiallyPaid++;
      else notPaid++;

      // Compute the amount collected for this record. The priority is:
      // 1) the running total of all update `amount` values (when present);
      // 2) the last update's `amount` (legacy records);
      // 3) the planned `upfrontAmount` from the payment plan (when the
      //    record exists but no actual amount has been logged yet — every
      //    record in the report has an upfront plan, so the sidebar/card
      //    "Upfront (collected)" always reflects the full upfront value).
      let rowPaid = 0;
      let rowPaidCount = 0;
      if (typeof r.totalPaid === "number" && Number.isFinite(r.totalPaid)) {
        rowPaid = r.totalPaid;
        rowPaidCount = r.paidUpdateCount;
      } else if (r.lastUpdate?.amount != null) {
        rowPaid = r.lastUpdate.amount;
        rowPaidCount = 1;
      } else if (
        typeof r.paymentPlan?.upfrontAmount === "number" &&
        Number.isFinite(r.paymentPlan.upfrontAmount) &&
        r.paymentPlan.upfrontAmount > 0
      ) {
        rowPaid = r.paymentPlan.upfrontAmount;
        rowPaidCount = 1;
      }
      amountPaid += rowPaid;
      amountPaidCount += rowPaidCount;
      totalAmount += r.leadAmount;

      const lastAt = r.lastUpdate?.createdAt ?? r.createdAt;
      if (lastAt && (!mostRecent || new Date(lastAt) > new Date(mostRecent.at))) {
        mostRecent = { at: lastAt, company: r.company || "Unknown" };
      }
    }

    return {
      fullyPaid,
      partiallyPaid,
      notPaid,
      amountPaid,
      amountPaidCount,
      totalAmount,
      outstanding: Math.max(totalAmount - amountPaid, 0),
      mostRecent,
      total: rows.length,
    };
  }, [rows]);

  const breakdown = useMemo(() => {
    const total = Math.max(stats.total, 1);
    return [
      {
        key: "fully_paid",
        label: "Fully Paid",
        value: stats.fullyPaid,
        pct: Math.round((stats.fullyPaid / total) * 100),
        tone: "bg-emerald-500",
      },
      {
        key: "partially_paid",
        label: "Partially Paid",
        value: stats.partiallyPaid,
        pct: Math.round((stats.partiallyPaid / total) * 100),
        tone: "bg-amber-500",
      },
      {
        key: "not_paid",
        label: "Not Paid",
        value: stats.notPaid,
        pct: Math.round((stats.notPaid / total) * 100),
        tone: "bg-zinc-400",
      },
    ];
  }, [stats]);

  return (
    <aside
      aria-label="Payments report sidebar"
      className="space-y-4 lg:sticky lg:top-6 lg:self-start"
    >
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Wallet className="h-4 w-4" />
            Summary
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <SidebarStat
            icon={<Banknote className="h-4 w-4" />}
            label="Total Amount"
            value={currency.format(stats.totalAmount)}
            sub="Sum of all lead totals"
          />
          <SidebarStat
            icon={<CheckCircle2 className="h-4 w-4" />}
            label="Upfront (collected)"
            value={currency.format(stats.amountPaid)}
            sub={`${stats.amountPaidCount} update${
              stats.amountPaidCount === 1 ? "" : "s"
            } with an amount`}
          />
          <SidebarStat
            icon={<CheckCircle2 className="h-4 w-4" />}
            label="Most recent activity"
            value={
              stats.mostRecent
                ? dateFormatter.format(new Date(stats.mostRecent.at))
                : "—"
            }
            sub={stats.mostRecent?.company ?? "No activity yet"}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Status mix</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {breakdown.map((b) => (
            <div key={b.key} className="space-y-1">
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium">{b.label}</span>
                <span className="text-muted-foreground">
                  {b.value} · {b.pct}%
                </span>
              </div>
              <div
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={b.pct}
                aria-label={`${b.label} percentage`}
                className="h-2 w-full overflow-hidden rounded-full bg-muted"
              >
                <div
                  className={`h-full ${b.tone}`}
                  style={{ width: `${b.pct}%` }}
                />
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </aside>
  );
}

function SidebarStat({
  icon,
  label,
  value,
  sub,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub: string;
}) {
  return (
    <div className="flex items-start gap-3">
      <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
        {icon}
      </div>
      <div className="min-w-0">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">
          {label}
        </p>
        <p className="truncate text-sm font-semibold">{value}</p>
        <p className="truncate text-xs text-muted-foreground">{sub}</p>
      </div>
    </div>
  );
}
