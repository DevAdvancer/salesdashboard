"use client";

import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/use-toast";
import {
  listMonthlyTargets,
  listMonthlyTargetAssignments,
  listTeamAgentsForTarget,
  replaceMonthlyTargetAssignments,
} from "@/lib/services/target-report-service";
import type { AgentOption } from "@/app/actions/monthly-targets";
import type { MonthlyTarget, User } from "@/lib/types";

interface TlSplitFormProps {
  user: User;
  monthKey: string;
  /** Notify the parent (dashboard) when the split was saved so it can
   *  refetch. */
  onSaved: () => void;
}

interface DraftRow {
  agentId: string;
  amount: number;
}

const currency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

export function TlSplitForm({ user, monthKey, onSaved }: TlSplitFormProps) {
  const [agents, setAgents] = useState<AgentOption[]>([]);
  const [target, setTarget] = useState<MonthlyTarget | null>(null);
  const [draft, setDraft] = useState<Record<string, number>>({});
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [agentsList, targets] = await Promise.all([
          listTeamAgentsForTarget({ actorId: user.$id }),
          listMonthlyTargets({ actorId: user.$id, monthKey }),
        ]);
        if (cancelled) return;
        setAgents(agentsList);
        const myTarget =
          targets.find((t) => t.teamLeadId === user.$id) ?? null;
        setTarget(myTarget);
        if (myTarget) {
          const assignments = await listMonthlyTargetAssignments({
            actorId: user.$id,
            monthlyTargetId: myTarget.$id,
          });
          if (cancelled) return;
          const map: Record<string, number> = {};
          for (const a of assignments) map[a.agentId] = a.amount;
          setDraft(map);
        } else {
          setDraft({});
        }
      } catch (err) {
        toast({
          variant: "destructive",
          title: "Failed to load split data",
          description: err instanceof Error ? err.message : String(err),
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user.$id, monthKey, toast]);

  const draftRows = useMemo<DraftRow[]>(() => {
    return agents.map((a) => ({
      agentId: a.$id,
      amount: draft[a.$id] ?? 0,
    }));
  }, [agents, draft]);

  const draftTotal = useMemo(
    () => draftRows.reduce((sum, r) => sum + (Number.isFinite(r.amount) ? r.amount : 0), 0),
    [draftRows],
  );

  const teamTotal = target?.totalAmount ?? 0;
  const balance = teamTotal - draftTotal;

  const updateAmount = (agentId: string, value: string) => {
    const parsed = Number(value);
    setDraft((prev) => ({
      ...prev,
      [agentId]: Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : 0,
    }));
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!target) {
      toast({
        variant: "destructive",
        title: "No team target set for this month",
        description: "Ask an admin to set the team total first.",
      });
      return;
    }
    const cleaned = draftRows
      .map((r) => ({ agentId: r.agentId, amount: Math.max(0, Math.round(r.amount)) }))
      .filter((r) => r.amount > 0);
    try {
      setSaving(true);
      await replaceMonthlyTargetAssignments({
        actorId: user.$id,
        monthlyTargetId: target.$id,
        assignments: cleaned,
      });
      toast({ title: "Split saved" });
      onSaved();
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Failed to save split",
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setSaving(false);
    }
  };

  const distributeRemaining = () => {
    if (teamTotal <= 0) return;
    const remaining = Math.max(0, teamTotal - draftTotal);
    if (remaining === 0) return;
    if (agents.length === 0) return;
    const share = Math.floor(remaining / agents.length);
    setDraft((prev) => {
      const next: Record<string, number> = { ...prev };
      const leftover = remaining - share * agents.length;
      for (const a of agents) {
        next[a.$id] = (next[a.$id] ?? 0) + share;
      }
      if (leftover > 0) {
        next[agents[0].$id] = (next[agents[0].$id] ?? 0) + leftover;
      }
      return next;
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Split Team Target — {monthKey}</CardTitle>
        <p className="text-xs text-muted-foreground">
          Distribute the team total across your agents. You can save without it
          matching the total — the report uses each row as the per-agent denominator.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {!target ? (
          <p className="text-sm text-muted-foreground">
            No team target set for {monthKey}. Ask an admin to set the team total.
          </p>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-4 rounded-md border bg-muted/30 px-3 py-2 text-sm">
              <div>
                <div className="text-xs uppercase tracking-wider text-muted-foreground">
                  Team total
                </div>
                <div className="font-semibold">{currency.format(teamTotal)}</div>
              </div>
              <div>
                <div className="text-xs uppercase tracking-wider text-muted-foreground">
                  Split total
                </div>
                <div className="font-semibold">{currency.format(draftTotal)}</div>
              </div>
              <div>
                <div className="text-xs uppercase tracking-wider text-muted-foreground">
                  {balance >= 0 ? "Remaining" : "Over by"}
                </div>
                <div
                  className={`font-semibold ${
                    balance < 0 ? "text-red-600" : "text-emerald-600"
                  }`}>
                  {currency.format(Math.abs(balance))}
                </div>
              </div>
              <div className="ml-auto flex items-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={distributeRemaining}
                  disabled={teamTotal <= 0 || agents.length === 0}>
                  Distribute remaining evenly
                </Button>
                <Button type="submit" size="sm" onClick={submit} disabled={saving}>
                  {saving ? "Saving…" : "Save split"}
                </Button>
              </div>
            </div>

            <form onSubmit={submit}>
              {agents.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No agents are assigned to you yet. Ask an admin to set up your team.
                </p>
              ) : (
                <ul className="divide-y rounded-md border">
                  {agents.map((a) => (
                    <li
                      key={a.$id}
                      className="flex items-center gap-3 px-3 py-2 text-sm">
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-medium">{a.name}</div>
                        <div className="truncate text-xs text-muted-foreground">{a.email}</div>
                      </div>
                      <div className="w-40">
                        <Input
                          type="number"
                          min={0}
                          step={1}
                          value={draft[a.$id] ?? 0}
                          onChange={(e) => updateAmount(a.$id, e.target.value)}
                          aria-label={`Target for ${a.name}`}
                        />
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </form>
          </>
        )}
      </CardContent>
    </Card>
  );
}
