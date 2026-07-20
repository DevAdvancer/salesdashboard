"use client";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { PreviousFollowupsPayment } from "@/lib/types";
import { formatEasternCalendarDate } from "@/lib/utils/eastern-date";

interface FollowupsPaymentTableProps {
  payments: PreviousFollowupsPayment[];
  isLoading: boolean;
  onEdit: (payment: PreviousFollowupsPayment) => void;
  onDelete?: (payment: PreviousFollowupsPayment) => void;
  canEdit?: boolean;
}

export function FollowupsPaymentTable({
  payments,
  isLoading,
  onEdit,
  onDelete,
  canEdit = true,
}: FollowupsPaymentTableProps) {
  if (isLoading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-12 bg-muted animate-pulse rounded" />
        ))}
      </div>
    );
  }

  if (payments.length === 0) {
    return (
      <div className="flex h-32 items-center justify-center rounded-md border border-dashed border-border text-sm text-muted-foreground">
        No followup payments recorded yet
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Date</TableHead>
            <TableHead>Company</TableHead>
            <TableHead>Candidate Name</TableHead>
            <TableHead>Remark</TableHead>
            <TableHead className="text-right">Amount</TableHead>
            <TableHead>Status</TableHead>
            {canEdit && <TableHead className="text-right">Actions</TableHead>}
          </TableRow>
        </TableHeader>
        <TableBody>
          {payments.map((payment) => (
            <TableRow key={payment.$id}>
              <TableCell className="text-muted-foreground">
                {formatEasternCalendarDate(payment.date)}
              </TableCell>
              <TableCell className="text-muted-foreground">
                {payment.company}
              </TableCell>
              <TableCell className="font-medium">
                {payment.candidateName}
              </TableCell>
              <TableCell className="text-muted-foreground max-w-[300px] truncate">
                {payment.remark || "—"}
              </TableCell>
              <TableCell className="text-right font-mono font-medium">
                {payment.amount.toLocaleString()}
              </TableCell>
              <TableCell>
                <Badge
                  variant="secondary"
                  className="bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-400">
                  Paid
                </Badge>
              </TableCell>
              {canEdit && (
                <TableCell className="text-right">
                  <div className="flex justify-end gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => onEdit(payment)}>
                      Edit
                    </Button>
                    {onDelete && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => onDelete(payment)}
                        className="text-red-600 hover:text-red-700 dark:text-red-500 dark:hover:text-red-400">
                        Delete
                      </Button>
                    )}
                  </div>
                </TableCell>
              )}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
