"use server";
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
import { getActor, ensureComponentAccess, isAdminLikeReadRole, assertCanMutateClientPayments, parseJsonOr, canActorAccessLead, mapRecord, findRecordByLeadId, mapLeadDocumentToLead, buildSyntheticLead, toComparableIsoDate, PaymentInsightRecord, AdminClientHistoryRow, PaymentsReportRow } from "./shared";
import { logger } from '@/lib/utils/logger';
import { mergeLockedClientContactDetails } from '@/lib/utils/lead-contact-lock';
import type { LeadData } from '@/lib/types';
import { getLeadLifecycleEvents, getPaymentCycleId, snapshotPaymentPlan } from '@/lib/utils/lead-payment-cycle';


export async function getClientPaymentRecordAction(actorId: string, leadId: string): Promise<ClientPaymentRecord | null> {
    const actor = await getActor(actorId);
    ensureComponentAccess(actor.role, "history");
    if (!(await canActorAccessLead(actor, leadId))) {
    throw new Error("Not authorized");
    }

    const { databases } = await createAdminClient();
    const records = await listAllDocuments<any>({
      databases, databaseId: DATABASE_ID, collectionId: COLLECTIONS.CLIENT_PAYMENTS,
      queries: [Query.equal('leadId', leadId), Query.orderDesc('createdAt')],
    });
    if (!records.length) return null;
    const lead = await databases.getDocument(DATABASE_ID, COLLECTIONS.LEADS, leadId);
    return {
      ...mapRecord(records[0]),
      previousRecords: records.slice(1).map(mapRecord),
      lifecycleEvents: getLeadLifecycleEvents(JSON.parse(lead?.data || '{}')),
    };
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
    const latest = await findRecordByLeadId(input.leadId);
    const lead = await databases.getDocument(DATABASE_ID, COLLECTIONS.LEADS, input.leadId) as unknown as Lead;
    const leadData = JSON.parse(lead.data || '{}') as LeadData;
    const cycleId = getPaymentCycleId(leadData);
    const latestPlan = parseJsonOr<ClientPaymentPlan>(latest?.paymentPlan ?? latest?.paymentPlanJson, { percent: 0, months: 0, upfrontAmount: 0 });
    const existing = latest && (latestPlan.cycleId ?? 'initial') === cycleId ? latest : null;
    const savedClientDetails = latest
      ? parseJsonOr<Record<string, unknown>>(latest.personalDetails ?? latest.personalDetailsJson, {})
      : {};
    const personalDetails = mergeLockedClientContactDetails(
      leadData, savedClientDetails, input.personalDetails ?? {},
    );
    const status = input.initialStatus ?? (existing?.status as PaymentStatus) ?? "not_paid";
    const updates = existing ? parseJsonOr<ClientPaymentUpdate[]>(existing.updates ?? existing.updatesJson, []) : [];
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
            personalDetails: JSON.stringify(personalDetails),
            paymentPlan: JSON.stringify({
              ...snapshotPaymentPlan(input.paymentPlan, lead, leadData, lead.isClosed ? (lead.closedAt || now) : now),
              ...(existing && latestPlan.closure ? { closure: latestPlan.closure } : {}),
            }),
            status,
            updates: JSON.stringify(nextUpdates),
            createdAt: existing?.createdAt ?? now,
            updatedAt: now,
            updatedById: actor.$id,
            updatedByName: actor.name,
          };
    // One stable ID per closure cycle makes a retried/concurrent close safe.
    const recordId = `cp_${crypto.createHash('sha256').update(`${input.leadId}:${cycleId}`).digest('hex').slice(0, 32)}`;
    let doc;
    if (existing) {
      doc = await databases.updateDocument(DATABASE_ID, COLLECTIONS.CLIENT_PAYMENTS, existing.$id, payload);
    } else {
      try {
        doc = await databases.createDocument(DATABASE_ID, COLLECTIONS.CLIENT_PAYMENTS, recordId, payload);
      } catch (error) {
        if ((error as { code?: number }).code !== 409) throw error;
        doc = await databases.getDocument(DATABASE_ID, COLLECTIONS.CLIENT_PAYMENTS, recordId);
      }
    }
    return mapRecord(doc);
}

export async function addClientPaymentUpdateAction(input: {
      actorId: string;
      leadId: string;
      status: PaymentStatus;
      note?: string | null;
      amount?: number | null;
      sourceFollowupId?: string;
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

    let existing = await findRecordByLeadId(input.leadId);
    if (input.sourceFollowupId) {
      const { databases } = await createAdminClient();
      const records = await listAllDocuments<any>({
        databases, databaseId: DATABASE_ID, collectionId: COLLECTIONS.CLIENT_PAYMENTS,
        queries: [Query.equal('leadId', input.leadId)],
      });
      existing = records.find(record => parseJsonOr<ClientPaymentUpdate[]>(record.updates ?? record.updatesJson, [])
        .some(update => update.sourceFollowupId === input.sourceFollowupId)) ?? existing;
    }
    if (!existing) {
    throw new Error("Payment record not found");
    }

    const updates = parseJsonOr<ClientPaymentUpdate[]>(existing.updates ?? existing.updatesJson, []);
    const now = new Date().toISOString();
    const suppliedAmount = typeof input.amount === "number" && Number.isFinite(input.amount)
      ? (input.status === 'refunded' ? -Math.abs(input.amount) : input.amount) : null;
    const previousSourceTotal = input.sourceFollowupId
      ? updates.filter(u => u.sourceFollowupId === input.sourceFollowupId).reduce((sum, u) => sum + (u.amount ?? 0), 0)
      : 0;
    const sanitizedAmount = suppliedAmount === null ? null : suppliedAmount - previousSourceTotal;
    if (input.sourceFollowupId && sanitizedAmount === 0 && existing.status === input.status) return mapRecord(existing);
    const nextUpdates: ClientPaymentUpdate[] = [
            {
              id: crypto.randomUUID(),
              ...(input.sourceFollowupId ? { sourceFollowupId: input.sourceFollowupId } : {}),
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
      logger.error("Failed to write pending_amounts row:", err);
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
    const lead = await databases.getDocument(DATABASE_ID, COLLECTIONS.LEADS, input.leadId) as unknown as Lead;
    const leadData = JSON.parse(lead.data || '{}') as LeadData;
    const savedClientDetails = parseJsonOr<Record<string, unknown>>(
      existing.personalDetails ?? existing.personalDetailsJson, {},
    );
    const personalDetails = mergeLockedClientContactDetails(
      leadData, savedClientDetails, input.personalDetails ?? {},
    );
    const now = new Date().toISOString();
    const doc = await databases.updateDocument(DATABASE_ID, COLLECTIONS.CLIENT_PAYMENTS, existing.$id, {
            personalDetails: JSON.stringify(personalDetails),
            updatedAt: now,
            updatedById: actor.$id,
            updatedByName: actor.name,
          });
    return mapRecord(doc);
}
