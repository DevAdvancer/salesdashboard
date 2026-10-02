"use client";

import { useEffect, useState } from "react";
import { format, lastDayOfMonth } from "date-fns";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/use-toast";
import { getTargetMonthBound, saveTargetMonthBound } from "@/app/actions/target-month-bounds";

export function AdminTargetBoundsForm({ monthKey, onSaved }: { monthKey: string; onSaved: () => void }) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  
  const [leadsFromIso, setLeadsFromIso] = useState(`${monthKey}-01`);
  const [leadsToIso, setLeadsToIso] = useState("");

  useEffect(() => {
    async function load() {
      setInitialLoading(true);
      try {
        const bound = await getTargetMonthBound(monthKey);
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
        setInitialLoading(false);
      }
    }
    load();
  }, [monthKey]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(leadsFromIso) || !/^\d{4}-\d{2}-\d{2}$/.test(leadsToIso)) {
      toast({
        variant: "destructive",
        title: "Invalid Format",
        description: "Dates must be YYYY-MM-DD",
      });
      return;
    }
    try {
      setLoading(true);
      await saveTargetMonthBound(monthKey, leadsFromIso, leadsToIso);
      toast({
        title: "Success",
        description: "Target report date bounds saved.",
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

  if (initialLoading) return null;

  return (
    <Card>
      <CardHeader className="py-4">
        <CardTitle className="text-lg">Custom Leads & Payments Date Window for {monthKey}</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="flex flex-col gap-4 sm:flex-row sm:items-end">
          <div className="flex-1 space-y-2">
            <Label htmlFor="leadsFromIso">Start Date (YYYY-MM-DD)</Label>
            <Input 
              id="leadsFromIso" 
              value={leadsFromIso} 
              onChange={e => setLeadsFromIso(e.target.value)} 
              placeholder="2026-09-01" 
              required 
            />
          </div>
          <div className="flex-1 space-y-2">
            <Label htmlFor="leadsToIso">End Date (YYYY-MM-DD)</Label>
            <Input 
              id="leadsToIso" 
              value={leadsToIso} 
              onChange={e => setLeadsToIso(e.target.value)} 
              placeholder="2026-09-30" 
              required 
            />
          </div>
          <Button type="submit" disabled={loading}>
            {loading ? "Saving..." : "Save Window"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
