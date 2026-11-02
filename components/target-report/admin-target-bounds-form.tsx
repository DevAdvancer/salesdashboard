"use client";

import { useEffect, useState } from "react";
import { format, lastDayOfMonth } from "date-fns";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DatePicker } from "@/components/ui/date-picker";
import { useQueryClient } from '@tanstack/react-query';
import { REPORTING_CALENDAR_QUERY_KEY } from '@/lib/hooks/use-current-month-bounds';
import { clearTargetReportCache } from '@/lib/services/target-report-service';
import { assertReportingWindow } from '@/lib/utils/reporting-period';
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/use-toast";
import { getTargetMonthBound, saveTargetMonthBound } from "@/app/actions/target-month-bounds";

export function AdminTargetBoundsForm({ monthKey, onSaved }: { monthKey: string; onSaved: () => void }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [loading, setLoading] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  
  const [leadsFromIso, setLeadsFromIso] = useState(`${monthKey}-01`);
  const [leadsToIso, setLeadsToIso] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setInitialLoading(true);
      try {
        const bound = await getTargetMonthBound(monthKey);
        if (cancelled) return;
        if (bound) {
          setLeadsFromIso(bound.leadsFromIso);
          setLeadsToIso(bound.leadsToIso);
        } else {
          // Default to calendar month bounds
          const [year, month] = monthKey.split("-").map(Number);
          const endOfMonth = lastDayOfMonth(new Date(year, month - 1, 1));
          setLeadsFromIso(`${monthKey}-01`);
          setLeadsToIso(format(endOfMonth, "yyyy-MM-dd"));
        }
      } catch (err) {
        console.error("Failed to load custom bounds:", err);
      } finally {
        if (!cancelled) setInitialLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [monthKey]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    try {
      assertReportingWindow({ monthKey, leadsFromIso, leadsToIso }, []);
      setLoading(true);
      const result = await saveTargetMonthBound(monthKey, leadsFromIso, leadsToIso);
      if (!result.ok) throw new Error(result.error);
      clearTargetReportCache();
      await queryClient.invalidateQueries({ queryKey: REPORTING_CALENDAR_QUERY_KEY });
      toast({
        title: "Success",
        description: "Reporting window saved for all CRM monthly views.",
      });
      onSaved();
    } catch (err: any) {
      toast({
        variant: "destructive",
        title: "Error",
        description: err.message || "Failed to save bounds.",
      });
    } finally {
      setLoading(false);
    }
  }

  if (initialLoading) return <p className="text-sm text-muted-foreground">Loading reporting window…</p>;

  return (
    <Card>
      <CardHeader className="py-4">
        <CardTitle className="text-lg">CRM Reporting Window for {monthKey}</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="flex flex-col gap-4 sm:flex-row sm:items-end">
          <div className="flex-1 space-y-2">
            <Label htmlFor="leadsFromIso">Start date (Eastern)</Label>
            <DatePicker id="leadsFromIso" value={leadsFromIso} onChange={setLeadsFromIso} maxDate={leadsToIso || undefined} disabled={loading} />
          </div>
          <div className="flex-1 space-y-2">
            <Label htmlFor="leadsToIso">End date (Eastern)</Label>
            <DatePicker id="leadsToIso" value={leadsToIso} onChange={setLeadsToIso} minDate={leadsFromIso || undefined} disabled={loading} />
          </div>
          <Button type="submit" disabled={loading}>
            {loading ? "Saving..." : "Save Window"}
          </Button>
        </form>
        <p className="mt-3 text-xs text-muted-foreground">Both dates are inclusive. This window defines the reporting month across CRM dashboards and reports. Eastern time automatically follows EST / EDT.</p>
      </CardContent>
    </Card>
  );
}
