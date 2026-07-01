"use client";

import { useMemo } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import type { TechnicalPayment } from "@/lib/types";

interface TechnicalPaymentSummary {
  $id: string;
  leadId: string;
  userId: string;
  userName: string;
  amount: number;
  type: 'assessment' | 'interview';
  createdAt: string;
  leadName: string;
  leadEmail: string;
}

interface TechnicalPaymentsSectionProps {
  payments: TechnicalPaymentSummary[];
  isLoading: boolean;
  dateFilter?: {
    from?: string;
    to?: string;
  };
  rangeLabel?: string;
}

const currencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function TechnicalPaymentsSection({
  payments,
  isLoading,
  dateFilter,
  rangeLabel,
}: TechnicalPaymentsSectionProps) {
  // Filter payments by date range if provided
  const filteredPayments = useMemo(() => {
    if (!dateFilter?.from && !dateFilter?.to) return payments;
    return payments.filter((p) => {
      const paymentDate = new Date(p.createdAt);
      if (dateFilter.from) {
        const fromDate = new Date(dateFilter.from);
        if (paymentDate < fromDate) return false;
      }
      if (dateFilter.to) {
        const toDate = new Date(dateFilter.to);
        toDate.setHours(23, 59, 59, 999);
        if (paymentDate > toDate) return false;
      }
      return true;
    });
  }, [payments, dateFilter]);

  const stats = useMemo(() => {
    const assessmentTotal = filteredPayments
      .filter((p) => p.type === "assessment")
      .reduce((sum, p) => sum + p.amount, 0);
    const interviewTotal = filteredPayments
      .filter((p) => p.type === "interview")
      .reduce((sum, p) => sum + p.amount, 0);
    const assessmentCount = filteredPayments.filter(
      (p) => p.type === "assessment",
    ).length;
    const interviewCount = filteredPayments.filter(
      (p) => p.type === "interview",
    ).length;
    return {
      assessmentTotal,
      interviewTotal,
      assessmentCount,
      interviewCount,
      grandTotal: assessmentTotal + interviewTotal,
    };
  }, [filteredPayments]);

  const recentPayments = useMemo(
    () =>
      [...filteredPayments]
        .sort(
          (a, b) =>
            new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
        )
        .slice(0, 10),
    [filteredPayments],
  );

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle className="text-base sm:text-lg">
              Technical Payments
            </CardTitle>
            <CardDescription>
              Assessment and Interview upfront collections {rangeLabel && `— ${rangeLabel}`}
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="default">
              {filteredPayments.length} transactions
            </Badge>
            <Badge className="bg-emerald-600 text-white">
              {currencyFormatter.format(stats.grandTotal)}
            </Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Summary Cards */}
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {/* Assessment Card */}
          <div className="rounded-lg border border-[var(--hairline)] bg-[var(--soft-cloud)] p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">
                  Assessment
                </p>
                <p className="mt-1 text-2xl font-bold">
                  {currencyFormatter.format(stats.assessmentTotal)}
                </p>
              </div>
              <div className="text-right">
                <p className="text-xs text-muted-foreground">
                  {stats.assessmentCount} payments
                </p>
                <p className="text-xs text-muted-foreground">
                  avg{" "}
                  {stats.assessmentCount > 0
                    ? currencyFormatter.format(
                        stats.assessmentTotal / stats.assessmentCount,
                      )
                    : "$0"}
                </p>
              </div>
            </div>
          </div>

          {/* Interview Card */}
          <div className="rounded-lg border border-[var(--hairline)] bg-[var(--soft-cloud)] p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">
                  Interview
                </p>
                <p className="mt-1 text-2xl font-bold">
                  {currencyFormatter.format(stats.interviewTotal)}
                </p>
              </div>
              <div className="text-right">
                <p className="text-xs text-muted-foreground">
                  {stats.interviewCount} payments
                </p>
                <p className="text-xs text-muted-foreground">
                  avg{" "}
                  {stats.interviewCount > 0
                    ? currencyFormatter.format(
                        stats.interviewTotal / stats.interviewCount,
                      )
                    : "$0"}
                </p>
              </div>
            </div>
          </div>

          {/* Total Card */}
          <div className="rounded-lg border border-[var(--hairline)] bg-emerald-50 p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-emerald-700">Total</p>
                <p className="mt-1 text-2xl font-bold text-emerald-700">
                  {currencyFormatter.format(stats.grandTotal)}
                </p>
              </div>
              <div className="text-right">
                <p className="text-xs text-emerald-600">
                  {stats.assessmentCount + stats.interviewCount} total
                </p>
                <p className="text-xs text-emerald-600">
                  {currencyFormatter.format(
                    stats.assessmentCount + stats.interviewCount > 0
                      ? stats.grandTotal /
                          (stats.assessmentCount + stats.interviewCount)
                      : 0,
                  )}{" "}
                  avg
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Recent Transactions */}
        <div>
          <h4 className="mb-3 text-sm font-semibold">Recent Transactions</h4>
          {isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : recentPayments.length === 0 ? (
            <div className="flex h-24 items-center justify-center rounded-md border border-dashed border-[var(--hairline)] text-sm text-[var(--mute)]">
              No technical payments yet
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--hairline)] text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="py-2 pr-4 font-medium">Date</th>
                    <th className="py-2 px-4 font-medium">Type</th>
                    <th className="py-2 px-4 font-medium">Lead</th>
                    <th className="py-2 px-4 font-medium">Agent</th>
                    <th className="py-2 pl-4 font-medium text-right">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {recentPayments.map((payment) => (
                    <tr
                      key={payment.$id}
                      className="border-b border-[var(--hairline-soft)] last:border-0">
                      <td className="py-2 pr-4 text-muted-foreground">
                        {formatDate(payment.createdAt)}
                      </td>
                      <td className="py-2 px-4">
                        <Badge
                          variant="default"
                          className={
                            payment.type === "assessment"
                              ? "bg-blue-100 text-blue-800"
                              : "bg-purple-100 text-purple-800"
                          }>
                          {payment.type}
                        </Badge>
                      </td>
                      <td className="py-2 px-4">
                        {payment.leadName ?? "—"}
                      </td>
                      <td className="py-2 px-4 text-muted-foreground">
                        {payment.userName ?? "—"}
                      </td>
                      <td className="py-2 pl-4 text-right font-mono font-medium">
                        {currencyFormatter.format(payment.amount)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Type Breakdown */}
        {!isLoading && filteredPayments.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span>Type breakdown:</span>
            <Badge
              variant="default"
              className="bg-blue-100 text-blue-800">
              Assessment: {stats.assessmentCount}
            </Badge>
            <Badge
              variant="default"
              className="bg-purple-100 text-purple-800">
              Interview: {stats.interviewCount}
            </Badge>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
