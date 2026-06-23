"use client";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Users, UserPlus } from "lucide-react";
import type { ReferralSplit } from "@/lib/utils/dashboard-referral";

const currencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

interface ReferralSectionProps {
  data: ReferralSplit | null;
  isLoading: boolean;
  monthLabel: string;
}

export function ReferralSection({
  data,
  isLoading,
  monthLabel,
}: ReferralSectionProps) {
  return (
    <Card id="tour-referral-section">
      <CardHeader>
        <CardTitle className="text-base sm:text-lg">Referral split</CardTitle>
        <CardDescription>Current month — {monthLabel}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid gap-4 md:grid-cols-2">
          <NonReferralCard
            count={data?.nonReferral.count ?? null}
            totalAmount={data?.nonReferral.totalAmount ?? null}
            fullyPaidAmount={data?.nonReferral.fullyPaidAmount ?? null}
            partiallyPaidAmount={data?.nonReferral.partiallyPaidAmount ?? null}
            isLoading={isLoading}
          />
          <ReferralCard
            count={data?.referral.count ?? null}
            totalAmount={data?.referral.totalAmount ?? null}
            fullyPaidAmount={data?.referral.fullyPaidAmount ?? null}
            partiallyPaidAmount={data?.referral.partiallyPaidAmount ?? null}
            isLoading={isLoading}
          />
        </div>
      </CardContent>
    </Card>
  );
}

function NonReferralCard({
  count,
  totalAmount,
  fullyPaidAmount,
  partiallyPaidAmount,
  isLoading,
}: {
  count: number | null;
  totalAmount: number | null;
  fullyPaidAmount: number | null;
  partiallyPaidAmount: number | null;
  isLoading: boolean;
}) {
  return (
    <div className="rounded-2xl border border-[var(--hairline)] bg-[var(--soft-cloud)]/40 p-4">
      <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
        <Users className="h-4 w-4" />
        Non-Referral
      </div>
      <div className="mt-3 grid grid-cols-2 gap-4">
        <div>
          <div className="text-xs uppercase tracking-wide text-muted-foreground">
            Clients
          </div>
          {isLoading || count === null ? (
            <Skeleton className="mt-1 h-7 w-16" />
          ) : (
            <div className="mt-1 text-2xl font-bold tabular-nums">{count}</div>
          )}
        </div>
        <div>
          <div className="text-xs uppercase tracking-wide text-muted-foreground">
            Amount
          </div>
          {isLoading ||
          totalAmount === null ||
          fullyPaidAmount === null ||
          partiallyPaidAmount === null ? (
            <Skeleton className="mt-1 h-7 w-24" />
          ) : (
            <>
              <div className="mt-1 text-2xl font-bold tabular-nums">
                {currencyFormatter.format(totalAmount)}
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                Uses payment upfront totals for eligible clients
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function ReferralCard({
  count,
  totalAmount,
  fullyPaidAmount,
  partiallyPaidAmount,
  isLoading,
}: {
  count: number | null;
  totalAmount: number | null;
  fullyPaidAmount: number | null;
  partiallyPaidAmount: number | null;
  isLoading: boolean;
}) {
  return (
    <div className="rounded-2xl border border-emerald-700/60 bg-emerald-950/25 p-4">
      <div className="flex items-center gap-2 text-sm font-medium text-emerald-400">
        <UserPlus className="h-4 w-4" />
        Referral
      </div>
      <div className="mt-3 grid grid-cols-2 gap-4">
        <div>
          <div className="text-xs uppercase tracking-wide text-emerald-400/70">
            Clients
          </div>
          {isLoading || count === null ? (
            <Skeleton className="mt-1 h-7 w-16" />
          ) : (
            <div className="mt-1 text-2xl font-bold tabular-nums">{count}</div>
          )}
        </div>
        <div>
          <div className="text-xs uppercase tracking-wide text-emerald-400/70">
            Amount
          </div>
          {isLoading ||
          totalAmount === null ||
          fullyPaidAmount === null ||
          partiallyPaidAmount === null ? (
            <Skeleton className="mt-1 h-7 w-24" />
          ) : (
            <>
              <div className="mt-1 text-2xl font-bold tabular-nums">
                {currencyFormatter.format(totalAmount)}
              </div>
              <div className="mt-1 text-xs text-emerald-300/80">
                Uses payment upfront totals for eligible clients
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
