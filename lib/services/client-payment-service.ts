import {
  addClientPaymentUpdateAction,
  getClientPaymentRecordAction,
  listClientPaymentSummariesAction,
  updateClientPersonalDetailsAction,
  upsertClientPaymentRecordAction,
} from "@/app/actions/client-payments";
import { cacheClientRead, clearClientReadCache } from "@/lib/utils/client-read-cache";
import type { ClientPaymentPlan, ClientPaymentRecord, PaymentStatus } from "@/lib/types";

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
  return upsertClientPaymentRecordAction(input).finally(clearClientReadCache);
}

export function addClientPaymentUpdate(input: {
  actorId: string;
  leadId: string;
  status: PaymentStatus;
  note?: string | null;
}): Promise<ClientPaymentRecord> {
  return addClientPaymentUpdateAction(input).finally(clearClientReadCache);
}

export function updateClientPersonalDetails(input: {
  actorId: string;
  leadId: string;
  personalDetails: Record<string, unknown>;
}): Promise<ClientPaymentRecord> {
  return updateClientPersonalDetailsAction(input).finally(clearClientReadCache);
}

export function listClientPaymentSummaries(input: {
  actorId: string;
  leadIds: string[];
}): Promise<Array<{ leadId: string; status: PaymentStatus; personalDetails: Record<string, unknown> }>> {
  return listClientPaymentSummariesAction(input);
}
