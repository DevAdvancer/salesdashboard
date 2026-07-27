import crypto from "crypto";
import { upsertPendingAmountAction } from "@/app/actions/pending-amounts";
import { ID, Query } from "node-appwrite";
import { createAdminClient } from "@/lib/server/appwrite";
import { assertAuthenticatedUserId } from "@/lib/server/current-user";
import { listAllDocuments } from "@/lib/server/appwrite-pagination";
import { COLLECTIONS, DATABASE_ID } from "@/lib/constants/appwrite";
import { isRoleEligibleForComponent } from "@/lib/constants/component-access";
import { getAppwriteErrorMessage } from "@/lib/server/appwrite-errors";
import type { ClientPaymentPlan, ClientPaymentRecord, ClientPaymentUpdate, Lead, PaymentStatus, User } from "@/lib/types";
import { getSpecialBranchLeadAccess } from "@/lib/constants/special-lead-access";
import { getActor, ensureComponentAccess, isAdminLikeReadRole, assertCanMutateClientPayments, parseJsonOr, canActorAccessLead, mapRecord, findRecordByLeadId, mapLeadDocumentToLead, buildSyntheticLead, toComparableIsoDate, PaymentInsightRecord, AdminClientHistoryRow, PaymentsReportRow } from "./shared";

"use server";

export async function getClientPaymentRecordAction(actorId: string, leadId: string): Promise<ClientPaymentRecord | null> {
    const actor = await getActor(actorId);
    ensureComponentAccess(actor.role, "history");
    if (!(await canActorAccessLead(actor, leadId))) {
    throw new Error("Not authorized");
    }

    const record = await findRecordByLeadId(leadId);
    return record ? mapRecord(record) : null;
}

export async function upsertClientPaymentRecordAction(input: {
      actorId: string;
      leadId: string;
      personalDetails: Record<string, unknown>;
      paymentPlan: ClientPaymentPlan;
      initialStatus?: PaymentStatus;
    }): Promise<ClientPaymentRecord> {
    const actor = await getActor(input.actorId);
    ensureComponentAccess(actor.role, "leads");
    assertCanMutateClientPayments(actor);
    if (!(await canActorAccessLead(actor, input.leadId))) {
    throw new Error("Not authorized");
    }

    const { databases } = await createAdminClient();
    const now = new Date().toISOString();
    const existing = await findRecordByLeadId(input.leadId);
    const status = input.initialStatus ?? (existing?.status as PaymentStatus) ?? "not_paid";
    const updates = existing ? parseJsonOr<ClientPaymentUpdate[]>(existing.updates, []) : [];
    const shouldCreateInitialUpdate = updates.length === 0;
    const initialAmount = typeof input.paymentPlan?.upfrontAmount === "number" &&
            Number.isFinite(input.paymentPlan.upfrontAmount) &&
            input.paymentPlan.upfrontAmount > 0
              ? input.paymentPlan.upfrontAmount
              : null;
    const nextUpdates = shouldCreateInitialUpdate
            ? [
                {
                  id: crypto.randomUUID(),
                  status,
                  note: "Initialized",
                  actorId: actor.$id,
                  actorName: actor.name,
                  createdAt: now,
                  amount: initialAmount,
                } satisfies ClientPaymentUpdate,
              ]
            : updates;
    const payload = {
            leadId: input.leadId,
            personalDetails: JSON.stringify(input.personalDetails ?? {}),
            paymentPlan: JSON.stringify(input.paymentPlan ?? { percent: 0, months: 0, upfrontAmount: 0 }),
            status,
            updates: JSON.stringify(nextUpdates),
            createdAt: existing?.createdAt ?? now,
            updatedAt: now,
            updatedById: actor.$id,
            updatedByName: actor.name,
          };
    const doc = existing
            ? await databases.updateDocument(DATABASE_ID, COLLECTIONS.CLIENT_PAYMENTS, existing.$id, payload)
            : await databases.createDocument(DATABASE_ID, COLLECTIONS.CLIENT_PAYMENTS, ID.unique(), payload);
    return mapRecord(doc);
}

export async function addClientPaymentUpdateAction(input: {
      actorId: string;
      leadId: string;
      status: PaymentStatus;
      note?: string | null;
      amount?: number | null;
      /** Remaining balance after this update — written to pending_amounts for the
       * current calendar month. Null / 0 means no pending balance. */
      pendingAmount?: number | null;
    }): Promise<ClientPaymentRecord> {
    const actor = await getActor(input.actorId);
    ensureComponentAccess(actor.role, "history");
    assertCanMutateClientPayments(actor);
    if (!(await canActorAccessLead(actor, input.leadId))) {
    throw new Error("Not authorized");
    }

    const existing = await findRecordByLeadId(input.leadId);
    if (!existing) {
    throw new Error("Payment record not found");
    }

    const updates = parseJsonOr<ClientPaymentUpdate[]>(existing.updates, []);
    const now = new Date().toISOString();
    const sanitizedAmount = typeof input.amount === "number" && Number.isFinite(input.amount) ? input.amount : null;
    const nextUpdates: ClientPaymentUpdate[] = [
            {
              id: crypto.randomUUID(),
              status: input.status,
              note: input.note ?? null,
              actorId: actor.$id,
              actorName: actor.name,
              createdAt: now,
              amount: sanitizedAmount,
            },
            ...updates,
          ];
    const { databases } = await createAdminClient();
    const doc = await databases.updateDocument(DATABASE_ID, COLLECTIONS.CLIENT_PAYMENTS, existing.$id, {
            updates: JSON.stringify(nextUpdates),
            status: input.status,
            updatedAt: now,
            updatedById: actor.$id,
            updatedByName: actor.name,
          });
    const pendingAmount = typeof input.pendingAmount === "number" && Number.isFinite(input.pendingAmount)
              ? Math.max(0, Math.floor(input.pendingAmount))
              : 0;
    if (pendingAmount >= 0) {
    const monthKey = now.slice(0, 7); // YYYY-MM
    try {
      await upsertPendingAmountAction({
        actorId: input.actorId,
        leadId: input.leadId,
        paymentRecordId: existing.$id,
        monthKey,
        pendingAmount,
      });
    } catch (err) {
      console.error("Failed to write pending_amounts row:", err);
      // Don't fail the whole payment update — pending tracking is best-effort.
    }
    }

    return mapRecord(doc);
}

export async function updateClientPersonalDetailsAction(input: {
      actorId: string;
      leadId: string;
      personalDetails: Record<string, unknown>;
    }): Promise<ClientPaymentRecord> {
    const actor = await getActor(input.actorId);
    ensureComponentAccess(actor.role, "history");
    assertCanMutateClientPayments(actor);
    if (!(await canActorAccessLead(actor, input.leadId))) {
    throw new Error("Not authorized");
    }

    const existing = await findRecordByLeadId(input.leadId);
    if (!existing) {
    throw new Error("Payment record not found");
    }

    const { databases } = await createAdminClient();
    const now = new Date().toISOString();
    const doc = await databases.updateDocument(DATABASE_ID, COLLECTIONS.CLIENT_PAYMENTS, existing.$id, {
            personalDetails: JSON.stringify(input.personalDetails ?? {}),
            updatedAt: now,
            updatedById: actor.$id,
            updatedByName: actor.name,
          });
    return mapRecord(doc);
}
