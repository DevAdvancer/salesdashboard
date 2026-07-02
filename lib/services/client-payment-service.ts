import {
  addClientPaymentUpdateAction,
  listAdminClientHistoryRowsAction,
  getClientPaymentRecordAction,
  listClientPaymentSummariesAction,
  listAllPaymentInsightsAction,
  listPaymentsReportAction,
  updateClientPersonalDetailsAction,
  upsertClientPaymentRecordAction,
  type AdminClientHistoryRow,
  type PaymentInsightRecord,
  type PaymentsReportRow,
} from "@/app/actions/client-payments";
import { cacheClientRead, clearClientReadCache } from "@/lib/utils/client-read-cache";
import { clearDashboardDataCache } from "@/lib/services/dashboard-data-service";
import type { ClientPaymentPlan, ClientPaymentRecord, PaymentStatus } from "@/lib/types";

// Re-export the action-layer type so consumers don't need a separate import
// path just to read the shape.
export type { PaymentInsightRecord };
export type { AdminClientHistoryRow };

export function getClientPaymentRecord(
  actorId: string,
  leadId: string
): Promise<ClientPaymentRecord | null> {
  return cacheClientRead("clientPayments:get", [actorId, leadId], () =>
    getClientPaymentRecordAction(actorId, leadId)
  );
}

export function upsertClientPaymentRecord(input: {
  actorId: string;
  leadId: string;
  personalDetails: Record<string, unknown>;
  paymentPlan: ClientPaymentPlan;
  initialStatus?: PaymentStatus;
}): Promise<ClientPaymentRecord> {
  return upsertClientPaymentRecordAction(input).finally(() => {
    clearClientReadCache();
    clearDashboardDataCache();
  });
}

export function addClientPaymentUpdate(input: {
  actorId: string;
  leadId: string;
  status: PaymentStatus;
  note?: string | null;
  amount?: number | null;
  /** Remaining balance after this update — written to pending_amounts. */
  pendingAmount?: number | null;
}): Promise<ClientPaymentRecord> {
  return addClientPaymentUpdateAction(input).finally(() => {
    clearClientReadCache();
    clearDashboardDataCache();
  });
}

export function updateClientPersonalDetails(input: {
  actorId: string;
  leadId: string;
  personalDetails: Record<string, unknown>;
}): Promise<ClientPaymentRecord> {
  return updateClientPersonalDetailsAction(input).finally(() => {
    clearClientReadCache();
    clearDashboardDataCache();
  });
}

export function listClientPaymentSummaries(input: {
  actorId: string;
  leadIds: string[];
}): Promise<Array<{ leadId: string; status: PaymentStatus; personalDetails: Record<string, unknown> }>> {
  return cacheClientRead(
    "clientPayments:listSummaries",
    [input.actorId, [...input.leadIds].sort()],
    () => listClientPaymentSummariesAction(input),
  );
}

export function listPaymentsReport(input: {
  actorId: string;
  dateFrom?: string;
  dateTo?: string;
}): Promise<PaymentsReportRow[]> {
  return listPaymentsReportAction(input);
}

export function listAllPaymentInsights(actorId: string): Promise<PaymentInsightRecord[]> {
  return cacheClientRead(
    "clientPayments:listAllInsights",
    [actorId],
    () => listAllPaymentInsightsAction(actorId),
  );
}

export function listAdminClientHistoryRows(
  actorId: string,
): Promise<AdminClientHistoryRow[]> {
  return cacheClientRead(
    "clientPayments:listAdminHistoryRows",
    [actorId],
    () => listAdminClientHistoryRowsAction(actorId),
  );
}
