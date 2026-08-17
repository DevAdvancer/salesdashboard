"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import {
  getAgentPaymentDetailsAction,
  type AgentPaymentDetailsResult,
  type AgentPaymentDetail,
} from "@/app/actions/agent-payment-details";

const currency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

// ─── Sub-components ─────────────────────────────────────────────────────────

function DetailTable({
  items,
  emptyMessage,
}: {
  items: AgentPaymentDetail[];
  emptyMessage: string;
}) {
  if (items.length === 0) {
    return (
      <p className="py-4 text-center text-sm text-muted-foreground">
        {emptyMessage}
      </p>
    );
  }
  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Candidate Name</TableHead>
            <TableHead className="text-right">Amount</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((item, idx) => (
            <TableRow key={`${item.leadId}-${idx}`}>
              <TableCell className="font-medium">{item.candidateName}</TableCell>
              <TableCell className="text-right tabular-nums">
                {currency.format(item.amount)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div className="space-y-6">
      {/* Summary card skeleton */}
      <div className="flex gap-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="flex-1 border p-4 space-y-2">
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-7 w-24" />
          </div>
        ))}
      </div>
      {/* Table skeletons */}
      {[1, 2].map((i) => (
        <div key={i} className="space-y-2">
          <Skeleton className="h-5 w-40" />
          <div className="space-y-1">
            {[1, 2, 3].map((j) => (
              <div key={j} className="flex gap-4">
                <Skeleton className="h-10 flex-1" />
                <Skeleton className="h-10 w-24" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Main dialog ────────────────────────────────────────────────────────────

export interface AgentPaymentDetailDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  agentId: string;
  agentName: string;
  monthKey: string;
  actorId: string;
}

export function AgentPaymentDetailDialog({
  open,
  onOpenChange,
  agentId,
  agentName,
  monthKey,
  actorId,
}: AgentPaymentDetailDialogProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<AgentPaymentDetailsResult | null>(null);

  const load = useCallback(async () => {
    if (!agentId || !monthKey || !actorId) return;
    try {
      setLoading(true);
      setError(null);
      const result = await getAgentPaymentDetailsAction({
        actorId,
        agentId,
        monthKey,
      });
      setData(result);
    } catch (err) {
      console.error("Failed to load agent payment details:", err);
      setError(
        err instanceof Error ? err.message : "Failed to load payment details."
      );
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [actorId, agentId, monthKey]);

  useEffect(() => {
    if (open) {
      queueMicrotask(() => {
        void load();
      });
    } else {
      // Reset on close
      queueMicrotask(() => {
        setData(null);
        setError(null);
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, agentId, monthKey]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{agentName} — Payment Details</DialogTitle>
          <DialogDescription>
            Breakdown for {monthKey}
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <LoadingSkeleton />
        ) : error ? (
          <div
            role="alert"
            className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700"
          >
            {error}
          </div>
        ) : data ? (
          <div className="space-y-6">
            {/* ── Summary cards ────────────────────────────────────── */}
            <div className="grid grid-cols-3 gap-3">
              <Card>
                <CardHeader className="pb-1">
                  <CardTitle className="text-xs font-medium text-muted-foreground">
                    Total Amount
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-lg font-semibold tabular-nums">
                    {currency.format(data.totalAmount)}
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-1">
                  <CardTitle className="text-xs font-medium text-muted-foreground">
                    Upfront
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-lg font-semibold tabular-nums">
                    {currency.format(data.upfrontTotal)}
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-1">
                  <CardTitle className="text-xs font-medium text-muted-foreground">
                    Technical & Followups
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-lg font-semibold tabular-nums">
                    {currency.format(data.technicalAndFollowupsTotal)}
                  </p>
                </CardContent>
              </Card>
            </div>

            {/* ── Upfront section ─────────────────────────────────── */}
            <div className="space-y-2">
              <h3 className="text-sm font-semibold">Upfront Payments</h3>
              <DetailTable
                items={data.upfront}
                emptyMessage="No upfront payments in this month."
              />
            </div>

            {/* ── Technical & Followups section ───────────────────── */}
            <div className="space-y-2">
              <h3 className="text-sm font-semibold">
                Technical Payment &amp; Followups
              </h3>
              <DetailTable
                items={data.technicalAndFollowups}
                emptyMessage="No technical or followup payments in this month."
              />
            </div>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
