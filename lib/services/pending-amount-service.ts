"use client";

import {
  upsertPendingAmountAction,
  listPendingAmountsByLeadAction,
  listPendingAmountsByLeadIdsAction,
} from "@/app/actions/pending-amounts";
import { cacheClientRead, clearClientReadCache } from "@/lib/utils/client-read-cache";
import { clearDashboardDataCache } from "@/lib/services/dashboard-data-service";
import type { PendingAmount, PendingAmountStatus } from "@/lib/types";

export function listPendingAmountsByLead(
  actorId: string,
  leadId: string
): Promise<PendingAmount[]> {
  return cacheClientRead(
    "pendingAmounts:listByLead",
    [actorId, leadId],
    () => listPendingAmountsByLeadAction({ actorId, leadId }),
    60 * 1000, // 1 minute cache
  );
}

export function listPendingAmountsByLeadIds(
  actorId: string,
  leadIds: string[]
): Promise<Map<string, PendingAmount[]>> {
  return cacheClientRead(
    "pendingAmounts:listByLeadIds",
    [actorId, [...leadIds].sort()],
    () => listPendingAmountsByLeadIdsAction({ actorId, leadIds }),
    60 * 1000, // 1 minute cache
  );
}

export function upsertPendingAmount(input: {
  actorId: string;
  leadId: string;
  paymentRecordId: string;
  monthKey: string;
  pendingAmount: number;
}): Promise<PendingAmount> {
  return upsertPendingAmountAction(input).finally(() => {
    clearClientReadCache("pendingAmounts:listByLead");
    clearClientReadCache("pendingAmounts:listByLeadIds");
    clearDashboardDataCache();
  });
}
