"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { ClientPaymentRecord, PaymentStatus } from "@/lib/types";

interface ClientPaymentTimelineCardProps {
  paymentRecord: ClientPaymentRecord;
}

export function ClientPaymentTimelineCard({ paymentRecord }: ClientPaymentTimelineCardProps) {
  const formatPaymentStatusLabel = (status: PaymentStatus) => {
    if (status === "fully_paid") return "Fully Paid";
    if (status === "partially_paid") return "Partially Paid";
    if (status === "non_upfront") return "Non-Upfront";
    if (status === "refunded") return "Refunded";
    return "Not Paid";
  };
  const records = [paymentRecord, ...(paymentRecord.previousRecords ?? [])];
  const entries = records
    .flatMap((record) => record.updates.map((update) => ({
      ...update,
      title: `Status changed to ${formatPaymentStatusLabel(update.status)}`,
      cycle: record.createdAt,
    })))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const formatDate = (date: string) => new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', dateStyle: 'medium', timeStyle: 'short',
  }).format(new Date(date));

  return (
    <Card>
      <CardHeader>
        <CardTitle>Payment History</CardTitle>
      </CardHeader>
      <CardContent>
        {entries.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No updates recorded yet.
          </p>
        ) : (
          <div className="space-y-4">
            {entries.map((update) => (
              <div
                key={update.id}
                className="flex flex-col space-y-1 border-l-2 border-primary pl-4 py-2">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-sm">
                    {update.title}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {formatDate(update.createdAt)} ET
                  </span>
                </div>
                {records.length > 1 && update.cycle && (
                  <p className="text-xs text-muted-foreground">Payment cycle: {formatDate(update.cycle)} ET</p>
                )}
                {update.amount !== undefined && update.amount !== null && (
                  <p className="text-sm text-emerald-600 font-medium">
                    Payment Amount: ${update.amount.toLocaleString("en-US", { minimumFractionDigits: 2 })}
                  </p>
                )}
                {update.note && (
                  <p className="text-sm text-muted-foreground mt-1">
                    Note: {update.note}
                  </p>
                )}
                <p className="text-xs text-muted-foreground mt-1">
                  Updated by: {update.actorName}
                </p>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
