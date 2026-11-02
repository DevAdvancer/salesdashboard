"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useToast } from "@/components/ui/use-toast";
import { getTargetReport, clearTargetReportCache } from "@/lib/services/target-report-service";
import { useCurrentMonthBounds } from '@/lib/hooks/use-current-month-bounds';
import type { User } from "@/lib/types";
import { MonthPicker } from "./month-picker";
import { TargetReportTable } from "./target-report-table";
import { AdminTargetForm } from "./admin-target-form";
import { TlSplitForm } from "./tl-split-form";
import { AdminTargetBoundsForm } from "./admin-target-bounds-form";
import { filterTargetReportForAgent } from "@/lib/utils/monthly-target-report";

const currency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

interface TargetReportDashboardProps {
  user: User;
}

export function TargetReportDashboard({ user }: TargetReportDashboardProps) {
  const period = useCurrentMonthBounds();
  const [selectedMonthKey, setMonthKey] = useState<string | null>(null);
  const monthKey = selectedMonthKey || period.monthKey;
  const loadGeneration = useRef(0);
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
  const isAgent = user.role === "agent" || user.role === "lead_generation";

  const load = useCallback(async () => {
    if (period.isLoading) return;
    const generation = ++loadGeneration.current;
    try {
      setLoading(true);
      setError(null);
      const data = await getTargetReport({ actorId: user.$id, monthKey });
      if (generation !== loadGeneration.current) return;
      setPayload(data);
    } catch (err) {
      if (generation !== loadGeneration.current) return;
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
      if (generation === loadGeneration.current) setLoading(false);
    }
  }, [user.$id, monthKey, toast, period.isLoading]);

  useEffect(() => {
    queueMicrotask(() => {
      void load();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user.$id, monthKey, period.isLoading]);

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="flex flex-col gap-3 py-4 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
            {period.isLoading ? <span role="status" className="text-sm text-muted-foreground">Loading reporting month…</span> : <MonthPicker monthKey={monthKey} onChange={setMonthKey} />}
          </div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => { clearTargetReportCache(); void load(); }}
            disabled={loading}>
            <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </CardContent>
      </Card>

      {isAdmin && !period.isLoading ? (
        <div className="space-y-4">
          <AdminTargetForm user={user} monthKey={monthKey} onSaved={() => void load()} />
          <AdminTargetBoundsForm monthKey={monthKey} onSaved={() => void load()} />
        </div>
      ) : null}

      {isTl && !period.isLoading ? (
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
        (() => {
          const result = isAgent ? filterTargetReportForAgent(payload.result, user.$id) : payload.result;
          return <TargetReportTable result={result} isAgent={isAgent} monthKey={monthKey} actorId={user.$id} />;
        })()
      ) : null}

      {payload ? (
        (() => {
          const result = isAgent ? filterTargetReportForAgent(payload.result, user.$id) : payload.result;
          return (
            <p className="text-xs text-muted-foreground">
              {isAgent
                ? `Showing your personal target for ${payload.monthLabel}. Your target: ${currency.format(result.totals.target)}. Achieved: ${currency.format(result.totals.achieved)}.`
                : `Showing ${payload.monthLabel}. Total target: ${currency.format(result.totals.target)}. Achieved: ${currency.format(result.totals.achieved)}.`
              }
            </p>
          );
        })()
      ) : null}
    </div>
  );
}
