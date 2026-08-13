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
  teamLeadId?: string;
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

export function TlSplitForm({ user, monthKey, teamLeadId, onSaved }: TlSplitFormProps) {
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
          listTeamAgentsForTarget({ actorId: user.$id, teamLeadId }),
          listMonthlyTargets({ actorId: user.$id, monthKey }),
        ]);
        if (cancelled) return;
        setAgents(agentsList);
        const tlToLookup = teamLeadId ?? user.$id;
        const myTarget =
          targets.find((t) => t.teamLeadId === tlToLookup) ?? null;
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
  }, [user.$id, monthKey, teamLeadId, toast]);

  const tlId = teamLeadId ?? user.$id;

  const agentsDraftRows = useMemo<DraftRow[]>(() => {
    return agents.filter(a => a.$id !== tlId).map((a) => ({
      agentId: a.$id,
      amount: draft[a.$id] ?? 0,
    }));
  }, [agents, draft, tlId]);

  const agentsTotal = useMemo(
    () => agentsDraftRows.reduce((sum, r) => sum + (Number.isFinite(r.amount) ? r.amount : 0), 0),
    [agentsDraftRows],
  );

  const teamTotal = target?.totalAmount ?? 0;
  const tlRemainder = Math.max(0, teamTotal - agentsTotal);
  const overBy = Math.max(0, agentsTotal - teamTotal);

  const updateAmount = (agentId: string, value: string) => {
    if (agentId === tlId) return; // TL is read-only
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
    const cleaned = agentsDraftRows
      .map((r) => ({ agentId: r.agentId, amount: Math.max(0, Math.round(r.amount)) }))
      .filter((r) => r.amount > 0);
    // Explicitly append the TL's remainder if it's > 0, so it's saved in the DB
    if (tlRemainder > 0) {
      cleaned.push({ agentId: tlId, amount: tlRemainder });
    }
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
    const remaining = Math.max(0, teamTotal - agentsTotal);
    if (remaining === 0) return;
    const normalAgents = agents.filter(a => a.$id !== tlId);
    if (normalAgents.length === 0) return;
    const share = Math.floor(remaining / normalAgents.length);
    setDraft((prev) => {
      const next: Record<string, number> = { ...prev };
      const leftover = remaining - share * normalAgents.length;
      for (const a of normalAgents) {
        next[a.$id] = (next[a.$id] ?? 0) + share;
      }
      if (leftover > 0) {
        next[normalAgents[0].$id] = (next[normalAgents[0].$id] ?? 0) + leftover;
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
                  Agents total
                </div>
                <div className="font-semibold">{currency.format(agentsTotal)}</div>
              </div>
              <div>
                <div className="text-xs uppercase tracking-wider text-muted-foreground">
                  TL Remainder
                </div>
                <div className="font-semibold text-emerald-600">
                  {currency.format(tlRemainder)}
                </div>
              </div>
              {overBy > 0 && (
                <div>
                  <div className="text-xs uppercase tracking-wider text-muted-foreground">
                    Over by
                  </div>
                  <div className="font-semibold text-red-600">
                    {currency.format(overBy)}
                  </div>
                </div>
              )}
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
                        {a.$id === tlId ? (
                          <div className="flex h-10 w-full items-center justify-end rounded-md border border-transparent px-3 py-2 text-sm font-semibold tabular-nums text-muted-foreground">
                            {currency.format(tlRemainder)}
                          </div>
                        ) : (
                          <Input
                            type="number"
                            min={0}
                            step={1}
                            value={draft[a.$id] ?? 0}
                            onChange={(e) => updateAmount(a.$id, e.target.value)}
                            aria-label={`Target for ${a.name}`}
                          />
                        )}
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
