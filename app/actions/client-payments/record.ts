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
import { mapFollowupHistoryUpdate } from '@/lib/utils/client-payment-history';
import { followupPaymentRecipient } from '@/lib/utils/followup-payment-attribution';
import { getFollowupsPaymentAmount } from '@/lib/utils/followups-payment-amount';
import { reconcilePaymentDocuments } from '@/lib/utils/client-payment-reconciliation';


export async function getClientPaymentRecordAction(actorId: string, leadId: string): Promise<ClientPaymentRecord | null> {
    const actor = await getActor(actorId);
    ensureComponentAccess(actor.role, "history");
    if (!(await canActorAccessLead(actor, leadId))) {
    throw new Error("Not authorized");
    }

    const { databases } = await createAdminClient();
    // Individual history reads must see writes made on other server instances.
    const historyReads = databases.uncachedReads ?? databases;
    const records = await listAllDocuments<any>({
      databases: historyReads, databaseId: DATABASE_ID, collectionId: COLLECTIONS.CLIENT_PAYMENTS,
      queries: [Query.equal('leadId', leadId), Query.orderDesc('createdAt')],
      requireComplete: true,
    });
    if (!records.length) return null;
    const [lead, followups] = await Promise.all([
      historyReads.getDocument(DATABASE_ID, COLLECTIONS.LEADS, leadId),
      listAllDocuments<Record<string, unknown>>({
        databases: historyReads, databaseId: DATABASE_ID, collectionId: COLLECTIONS.PREVIOUS_FOLLOWUPS_PAYMENTS,
        queries: [Query.equal('leadId', leadId), Query.orderDesc('createdAt')],
        requireComplete: true,
      }),
    ]);
    const creditNames = new Map<string, string>();
    const creditedIds = [...new Set(followups.map(source => followupPaymentRecipient(source, lead)))].filter(Boolean);
    for (let index = 0; index < creditedIds.length; index += 100) {
      const users = await listAllDocuments<{ $id: string; name: string }>({
        databases: historyReads, databaseId: DATABASE_ID, collectionId: COLLECTIONS.USERS,
        queries: [Query.equal('$id', creditedIds.slice(index, index + 100)), Query.select(['$id', 'name'])],
        pageLimit: 100, maxPages: 1,
      });
      for (const user of users) creditNames.set(user.$id, user.name);
    }
    const financialRecords = reconcilePaymentDocuments(records, followups);
    return {
      ...mapRecord(financialRecords[0]),
      previousRecords: financialRecords.slice(1).map(mapRecord),
      followupUpdates: followups.map(source => {
        const id = followupPaymentRecipient(source, lead);
        const name = creditNames.get(id) || (id === source.createdById ? String(source.createdByName || id) : id);
        return mapFollowupHistoryUpdate({ ...source, creditedAgentId: id, creditedAgentName: name });
      }),
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
    let financialUpdates: ClientPaymentUpdate[] | undefined;
    let reconciledSourceTotal: number | undefined;
    let sourceFollowup: Record<string, unknown> | undefined;
    let sourceRecords: Record<string, unknown>[] = [];
    let paymentDate: string | undefined;
    if (input.sourceFollowupId) {
      const { databases } = await createAdminClient();
      const source = await databases.getDocument(DATABASE_ID, COLLECTIONS.PREVIOUS_FOLLOWUPS_PAYMENTS, input.sourceFollowupId);
      if (source.leadId !== input.leadId) throw new Error('Followup does not belong to this client');
      sourceFollowup = source;
      paymentDate = source.date;
      const records = await listAllDocuments<any>({
        databases, databaseId: DATABASE_ID, collectionId: COLLECTIONS.CLIENT_PAYMENTS,
        queries: [Query.equal('leadId', input.leadId)],
      });
      const reconciled = reconcilePaymentDocuments(records, [source]);
      sourceRecords = records;
      reconciledSourceTotal = reconciled.flatMap(record => parseJsonOr<ClientPaymentUpdate[]>(record.updates, []))
        .filter(update => update.sourceFollowupId === input.sourceFollowupId).reduce((sum, update) => sum + (update.amount ?? 0), 0);
      const matched = reconciled.find(record => parseJsonOr<ClientPaymentUpdate[]>(record.updates ?? record.updatesJson, [])
        .some(update => update.sourceFollowupId === input.sourceFollowupId)) ?? existing;
      existing = records.find(record => record.$id === matched?.$id) ?? existing;
      const financialRecord = reconciled.find(record => record.$id === existing?.$id);
      financialUpdates = financialRecord ? parseJsonOr<ClientPaymentUpdate[]>(financialRecord.updates, []) : undefined;
    }
    if (!existing) {
    throw new Error("Payment record not found");
    }

    const updates = parseJsonOr<ClientPaymentUpdate[]>(existing.updates ?? existing.updatesJson, []);
    const now = new Date().toISOString();
    const suppliedAmount = typeof input.amount === "number" && Number.isFinite(input.amount)
      ? (input.status === 'refunded' ? -Math.abs(input.amount) : input.amount) : null;
    if (sourceFollowup && suppliedAmount !== null && suppliedAmount !== getFollowupsPaymentAmount(sourceFollowup)) {
      throw new Error('The followup payment changed. Reload it before updating client history.');
    }
    const previousSourceTotal = input.sourceFollowupId
      ? reconciledSourceTotal ?? updates.filter(u => u.sourceFollowupId === input.sourceFollowupId).reduce((sum, u) => sum + (u.amount ?? 0), 0)
      : 0;
    const sanitizedAmount = suppliedAmount === null ? null : suppliedAmount - previousSourceTotal;
    if (input.sourceFollowupId && sanitizedAmount === 0 && existing.status === input.status) {
      return { ...mapRecord(existing), updates: financialUpdates ?? updates };
    }
    const nextUpdates: ClientPaymentUpdate[] = [
            {
              id: crypto.randomUUID(),
              ...(input.sourceFollowupId ? { sourceFollowupId: input.sourceFollowupId } : {}),
              ...(paymentDate ? { paymentDate } : {}),
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

    if (sourceFollowup) {
      const reconciled = reconcilePaymentDocuments(sourceRecords.map(record => record.$id === doc.$id ? doc as unknown as Record<string, unknown> : record), [sourceFollowup]);
      return mapRecord(reconciled.find(record => record.$id === doc.$id) ?? doc);
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
