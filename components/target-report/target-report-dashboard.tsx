"use client";

import { useEffect, useState, useCallback } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useToast } from "@/components/ui/use-toast";
import { getTargetReport } from "@/lib/services/target-report-service";
import type { User } from "@/lib/types";
import { MonthPicker } from "./month-picker";
import { TargetReportTable } from "./target-report-table";
import { AdminTargetForm } from "./admin-target-form";
import { TlSplitForm } from "./tl-split-form";

const currency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

function currentMonthKey(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

interface TargetReportDashboardProps {
  user: User;
}

export function TargetReportDashboard({ user }: TargetReportDashboardProps) {
  const [monthKey, setMonthKey] = useState<string>(currentMonthKey());
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [payload, setPayload] = useState<{
    result: import("@/lib/utils/monthly-target-report").TargetReportResult;
    monthLabel: string;
  } | null>(null);
  const { toast } = useToast();

  const isAdmin =
    user.role === "admin" ||
    user.role === "developer" ||
    user.role === "monitor" ||
    user.role === "operations";
  const isTl = user.role === "team_lead";

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await getTargetReport({ actorId: user.$id, monthKey });
      setPayload(data);
    } catch (err) {
      console.error("Failed to load target report:", err);
      const message = err instanceof Error ? err.message : "Failed to load target report.";
      setError(message);
      setPayload(null);
      toast({
        variant: "destructive",
        title: "Failed to load target report",
        description: message,
      });
    } finally {
      setLoading(false);
    }
  }, [user.$id, monthKey, toast]);

  useEffect(() => {
    queueMicrotask(() => {
      void load();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user.$id, monthKey]);

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="flex flex-col gap-3 py-4 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
            <MonthPicker monthKey={monthKey} onChange={setMonthKey} />
          </div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => void load()}
            disabled={loading}>
            <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </CardContent>
      </Card>

      {isAdmin ? (
        <AdminTargetForm user={user} monthKey={monthKey} onSaved={() => void load()} />
      ) : null}

      {isTl ? (
        <TlSplitForm user={user} monthKey={monthKey} onSaved={() => void load()} />
      ) : null}

      {error ? (
        <div
          role="alert"
          className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      {loading && !payload ? (
        <div className="rounded-md border bg-card p-6 text-center text-sm text-muted-foreground">
          Loading target report…
        </div>
      ) : payload ? (
        <TargetReportTable result={payload.result} />
      ) : null}

      {payload ? (
        <p className="text-xs text-muted-foreground">
          Showing {payload.monthLabel}. Team total: {currency.format(payload.result.totals.target)}.
          Achieved: {currency.format(payload.result.totals.achieved)}.
        </p>
      ) : null}
    </div>
  );
}
