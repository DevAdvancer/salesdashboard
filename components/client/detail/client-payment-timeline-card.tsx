"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { format } from "date-fns";
import type { ClientPaymentRecord, PaymentStatus } from "@/lib/types";

interface ClientPaymentTimelineCardProps {
  paymentRecord: ClientPaymentRecord;
}

export function ClientPaymentTimelineCard({ paymentRecord }: ClientPaymentTimelineCardProps) {
  const formatPaymentStatusLabel = (status: PaymentStatus) => {
    if (status === "fully_paid") return "Fully Paid";
    if (status === "partially_paid") return "Partially Paid";
    if (status === "non_upfront") return "Non-Upfront";
    return "Not Paid";
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Payment History</CardTitle>
      </CardHeader>
      <CardContent>
        {paymentRecord.updates.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No updates recorded yet.
          </p>
        ) : (
          <div className="space-y-4">
            {paymentRecord.updates.map((update) => (
              <div
                key={update.id}
                className="flex flex-col space-y-1 border-l-2 border-primary pl-4 py-2">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-sm">
                    Status changed to{" "}
                    {formatPaymentStatusLabel(update.status)}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {format(new Date(update.createdAt), "MMM d, yyyy h:mm a")}
                  </span>
                </div>
                {update.amount !== undefined && update.amount !== null && (
                  <p className="text-sm text-emerald-600 font-medium">
                    Payment Amount: ${update.amount.toLocaleString(undefined, { minimumFractionDigits: 2 })}
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
