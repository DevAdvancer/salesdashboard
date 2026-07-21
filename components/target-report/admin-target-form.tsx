"use client";

import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/use-toast";
import {
  listTeamLeadsForTarget,
  listMonthlyTargets,
  upsertMonthlyTeamTarget,
} from "@/lib/services/target-report-service";
import type { TeamLeadOption } from "@/app/actions/monthly-targets";
import type { User } from "@/lib/types";
import { formatMonthKey } from "@/lib/utils/month-key";

interface AdminTargetFormProps {
  user: User;
  monthKey: string;
  onSaved: () => void;
}

const currency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

export function AdminTargetForm({ user, monthKey, onSaved }: AdminTargetFormProps) {
  const [teamLeads, setTeamLeads] = useState<TeamLeadOption[]>([]);
  const [teamLeadId, setTeamLeadId] = useState<string>("");
  const [existingTargets, setExistingTargets] = useState<Record<string, number>>({});
  const [amount, setAmount] = useState<string>("");
  const [note, setNote] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const { toast } = useToast();

  // Fetch team leads + saved targets when (user, month) changes. Uses a
  // data-fetching effect that writes to state inside an async callback —
  // this is the pattern the rest of the codebase uses for similar
  // service-loaded lists.
  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      setLoaded(false);
      setTeamLeadId("");
      setAmount("");
      setNote("");
    });
    void (async () => {
      try {
        const [tls, targets] = await Promise.all([
          listTeamLeadsForTarget({ actorId: user.$id }),
          listMonthlyTargets({ actorId: user.$id, monthKey }),
        ]);
        if (cancelled) return;
        setTeamLeads(tls);
        const map: Record<string, number> = {};
        for (const t of targets) map[t.teamLeadId] = t.totalAmount;
        setExistingTargets(map);
        setLoaded(true);
      } catch (err) {
        if (cancelled) return;
        toast({
          variant: "destructive",
          title: "Failed to load team leads",
          description: err instanceof Error ? err.message : String(err),
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user.$id, monthKey, toast]);

  const handleSelect = (id: string) => {
    setTeamLeadId(id);
    setAmount(
      id && existingTargets[id] !== undefined ? String(existingTargets[id]) : "",
    );
  };

  const formattedTargets = useMemo(() => {
    return Object.entries(existingTargets).map(([id, amount]) => {
      const lead = teamLeads.find((t) => t.$id === id);
      return { id, name: lead?.name ?? id, amount };
    });
  }, [existingTargets, teamLeads]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!teamLeadId) {
      toast({ variant: "destructive", title: "Pick a team lead first" });
      return;
    }
    const value = Number(amount);
    if (!Number.isFinite(value) || value < 0) {
      toast({ variant: "destructive", title: "Enter a valid amount" });
      return;
    }
    try {
      setSaving(true);
      await upsertMonthlyTeamTarget({
        actorId: user.$id,
        teamLeadId,
        monthKey,
        totalAmount: value,
        note: note.trim() === "" ? null : note.trim(),
      });
      toast({ title: "Target saved" });
      setNote("");
      onSaved();
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Failed to save target",
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Set Team Target — {formatMonthKey(monthKey)}</CardTitle>
        <p className="text-xs text-muted-foreground">
          Sets the team total for the month. The TL then splits this amount across their
          agents on the report page.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <form onSubmit={submit} className="grid gap-3 sm:grid-cols-[2fr_1fr_2fr_auto]">
          <div className="space-y-1">
            <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Team lead
            </label>
            <select
              className="flex h-10 w-full rounded-md border border-input bg-background pl-3 pr-8 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              value={teamLeadId}
              onChange={(e) => handleSelect(e.target.value)}>
              <option value="">Choose team lead</option>
              {teamLeads.length === 0 ? (
                <option value="__none" disabled>
                  {loaded ? "No team leads found" : "Loading…"}
                </option>
              ) : (
                teamLeads.map((tl) => (
                  <option key={tl.$id} value={tl.$id}>
                    {tl.name}
                  </option>
                ))
              )}
            </select>
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Total amount
            </label>
            <Input
              type="number"
              inputMode="numeric"
              min={0}
              step={1}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Note
            </label>
            <Input
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Optional context for the TL"
            />
          </div>
          <div className="flex items-end">
            <Button type="submit" disabled={saving || !teamLeadId}>
              {saving ? "Saving…" : existingTargets[teamLeadId] !== undefined ? "Update" : "Save"}
            </Button>
          </div>
        </form>

        {formattedTargets.length > 0 ? (
          <div className="rounded-md border">
            <div className="border-b px-3 py-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Existing targets for {formatMonthKey(monthKey)}
            </div>
            <ul className="divide-y text-sm">
              {formattedTargets.map((row) => (
                <li key={row.id} className="flex items-center justify-between px-3 py-2">
                  <span>{row.name}</span>
                  <span className="font-medium tabular-nums">
                    {currency.format(row.amount)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            No targets set for this month yet.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
