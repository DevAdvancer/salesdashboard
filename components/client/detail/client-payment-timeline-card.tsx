"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { ClientPaymentRecord } from "@/lib/types";
import { buildClientPaymentHistory } from '@/lib/utils/client-payment-history';

interface ClientPaymentTimelineCardProps {
  paymentRecord: ClientPaymentRecord;
}

export function ClientPaymentTimelineCard({ paymentRecord }: ClientPaymentTimelineCardProps) {
  const records = [paymentRecord, ...(paymentRecord.previousRecords ?? [])];
  const entries = buildClientPaymentHistory(paymentRecord);
  const formatDate = (date: string) => Number.isFinite(Date.parse(date)) ? new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', dateStyle: 'medium', timeStyle: 'short',
  }).format(new Date(date)) : 'Date unavailable';

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
                    {update.kind === 'followup' ? 'Follow-up Amount' : 'Payment Amount'}: ${update.amount.toLocaleString("en-US", { minimumFractionDigits: 2 })}
                  </p>
                )}
                {update.reportedAmount !== undefined && (
                  <p className="text-sm text-muted-foreground">
                    Reported follow-up amount: ${update.reportedAmount.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                  </p>
                )}
                {update.paymentDate && (
                  <p className="text-xs text-muted-foreground">Follow-up date: {update.paymentDate}</p>
                )}
                {update.note && (
                  <p className="text-sm text-muted-foreground mt-1">
                    Note: {update.note}
                  </p>
                )}
                {update.creditedAgentName && (
                  <p className="text-xs text-muted-foreground">Credited to: {update.creditedAgentName}</p>
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
