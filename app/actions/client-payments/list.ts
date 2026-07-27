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


export async function listClientPaymentSummariesAction(input: {
      actorId: string;
      leadIds: string[];
    }): Promise<Array<{ leadId: string; status: PaymentStatus; personalDetails: Record<string, unknown>; paymentPlan: ClientPaymentPlan }>> {
    const actor = await getActor(input.actorId);
    ensureComponentAccess(actor.role, "history");
    const leadIds = Array.isArray(input.leadIds)
            ? Array.from(new Set(input.leadIds.filter((id) => typeof id === "string" && id.trim())))
            : [];
    if (leadIds.length === 0) return [];
    const { databases } = await createAdminClient();
    const CHUNK_SIZE = 100;
    const leadDocuments: any[] = [];
    for (let i = 0; i < leadIds.length; i += CHUNK_SIZE) {
    const chunk = leadIds.slice(i, i + CHUNK_SIZE);
    const response = await databases.listDocuments(DATABASE_ID, COLLECTIONS.LEADS, [
      Query.equal("$id", chunk),
      Query.limit(chunk.length),
    ]);
    leadDocuments.push(...response.documents);
    }

    let allowedLeadIds = new Set<string>();
    if (isAdminLikeReadRole(actor.role)) {
    allowedLeadIds = new Set(leadDocuments.map((doc: any) => doc.$id));
    } else if (actor.role === "agent" || actor.role === "lead_generation") {
    for (const lead of leadDocuments) {
      const ownerId = typeof lead.ownerId === "string" ? lead.ownerId : null;
      const assignedToId = typeof lead.assignedToId === "string" ? lead.assignedToId : null;
      const permissions = Array.isArray(lead.$permissions) ? (lead.$permissions as string[]) : [];
      if (
        ownerId === actor.$id ||
        assignedToId === actor.$id ||
        permissions.some((permission) => permission === `read("user:${actor.$id}")`)
      ) {
        allowedLeadIds.add(lead.$id);
      }
    }
    } else if (actor.role === "team_lead") {
    const agents = await databases.listDocuments(DATABASE_ID, COLLECTIONS.USERS, [
      Query.equal("teamLeadId", actor.$id),
      Query.or([Query.equal("role", "agent"), Query.equal("role", "lead_generation")]),
      Query.limit(5000),
    ]);
    const teamIds = new Set<string>([actor.$id, ...agents.documents.map((doc: any) => doc.$id)]);

    for (const lead of leadDocuments) {
      const branchId = typeof lead.branchId === "string" ? lead.branchId : null;
      const ownerId = typeof lead.ownerId === "string" ? lead.ownerId : null;
      const assignedToId = typeof lead.assignedToId === "string" ? lead.assignedToId : null;
      if (
        (ownerId ? teamIds.has(ownerId) : false) ||
        (assignedToId ? teamIds.has(assignedToId) : false) ||
        (branchId && actor.branchIds?.includes(branchId))
      ) {
        allowedLeadIds.add(lead.$id);
      }
    }
    }

    if (allowedLeadIds.size === 0) return [];
    const paymentDocuments: any[] = [];
    const allowedLeadIdsArray = Array.from(allowedLeadIds);
    for (let i = 0; i < allowedLeadIdsArray.length; i += CHUNK_SIZE) {
    const chunk = allowedLeadIdsArray.slice(i, i + CHUNK_SIZE);
    const response = await databases.listDocuments(DATABASE_ID, COLLECTIONS.CLIENT_PAYMENTS, [
      Query.equal("leadId", chunk),
      Query.limit(chunk.length),
    ]);
    paymentDocuments.push(...response.documents);
    }

    const results: Array<{ leadId: string; status: PaymentStatus; personalDetails: Record<string, unknown>; paymentPlan: ClientPaymentPlan }> = [];
    for (const doc of paymentDocuments) {
    const leadId = typeof doc.leadId === "string" ? doc.leadId : "";
    if (!leadId || !allowedLeadIds.has(leadId)) continue;
    const personalDetails = parseJsonOr<Record<string, unknown>>(doc.personalDetails ?? doc.personalDetailsJson, {});
    const paymentPlan = parseJsonOr<ClientPaymentPlan>(doc.paymentPlan ?? doc.paymentPlanJson, { percent: 0, months: 0, upfrontAmount: 0 });
    const status = (doc.status as PaymentStatus) ?? "not_paid";
    results.push({ leadId, status, personalDetails, paymentPlan });
    }

    return results;
}

/**
 * Returns the total amount actually collected (sum of `updates[].amount`)
 * for each of the actor's accessible leads. Used by the dashboard referral
 * split so the non-referral / referral totals reflect real money received,
 * not the planned `leadAmount` from the lead form.
 *
 * Access mirrors `listClientPaymentSummariesAction`: admins and team leads
 * see records for their team / branches; agents and lead_generation only
 * see their own leads.
 */
export async function listLeadPaidAmountsAction(input: {
      actorId: string;
      leadIds?: string[];
    }): Promise<Record<string, number>> {
    const actor = await getActor(input.actorId);
    ensureComponentAccess(actor.role, "history");
    const { databases } = await createAdminClient();
    const CHUNK_SIZE = 100;
    const requestedIds = Array.isArray(input.leadIds)
            ? Array.from(new Set(input.leadIds.filter((id) => typeof id === "string" && id.trim())))
            : null;
    let allowedLeadIds: Set<string>;
    if (isAdminLikeReadRole(actor.role)) {
    if (requestedIds && requestedIds.length > 0) {
      allowedLeadIds = new Set(requestedIds);
    } else {
      // No filter: every lead the actor could conceivably see. The
      // caller's intent here is to populate a lookup map for the
      // dashboard, so a global view is appropriate.
      const allLeads = await listAllDocuments<any>({
        databases,
        databaseId: DATABASE_ID,
        collectionId: COLLECTIONS.LEADS,
        queries: [Query.select(["$id"]), Query.limit(200)],
        pageLimit: 200,
        maxPages: 100,
      });
      allowedLeadIds = new Set(allLeads.map((doc) => doc.$id));
    }
    } else {
    // Non-admin roles require an explicit list of leadIds — they can't
    // pull "all leads" because they wouldn't have access anyway.
    if (!requestedIds || requestedIds.length === 0) return {};
    allowedLeadIds = new Set();

    const leadDocuments: any[] = [];
    for (let i = 0; i < requestedIds.length; i += CHUNK_SIZE) {
      const chunk = requestedIds.slice(i, i + CHUNK_SIZE);
      const response = await databases.listDocuments(DATABASE_ID, COLLECTIONS.LEADS, [
        Query.equal("$id", chunk),
        Query.limit(chunk.length),
      ]);
      leadDocuments.push(...response.documents);
    }

    if (actor.role === "agent" || actor.role === "lead_generation") {
      for (const lead of leadDocuments) {
        const ownerId = typeof lead.ownerId === "string" ? lead.ownerId : null;
        const assignedToId = typeof lead.assignedToId === "string" ? lead.assignedToId : null;
        const permissions = Array.isArray(lead.$permissions) ? (lead.$permissions as string[]) : [];
        if (
          ownerId === actor.$id ||
          assignedToId === actor.$id ||
          permissions.some((permission) => permission === `read("user:${actor.$id}")`)
        ) {
          allowedLeadIds.add(lead.$id);
        }
      }
    } else if (actor.role === "team_lead") {
      const agents = await databases.listDocuments(DATABASE_ID, COLLECTIONS.USERS, [
        Query.equal("teamLeadId", actor.$id),
        Query.or([Query.equal("role", "agent"), Query.equal("role", "lead_generation")]),
        Query.limit(5000),
      ]);
      const teamIds = new Set<string>([actor.$id, ...agents.documents.map((doc: any) => doc.$id)]);

      for (const lead of leadDocuments) {
        const branchId = typeof lead.branchId === "string" ? lead.branchId : null;
        const ownerId = typeof lead.ownerId === "string" ? lead.ownerId : null;
        const assignedToId = typeof lead.assignedToId === "string" ? lead.assignedToId : null;
        if (
          (ownerId ? teamIds.has(ownerId) : false) ||
          (assignedToId ? teamIds.has(assignedToId) : false) ||
          (branchId && actor.branchIds?.includes(branchId))
        ) {
          allowedLeadIds.add(lead.$id);
        }
      }
    }
    }

    if (allowedLeadIds.size === 0) return {};
    const paymentDocuments: any[] = [];
    const allowedIdsArray = Array.from(allowedLeadIds);
    for (let i = 0; i < allowedIdsArray.length; i += CHUNK_SIZE) {
    const chunk = allowedIdsArray.slice(i, i + CHUNK_SIZE);
    const response = await databases.listDocuments(DATABASE_ID, COLLECTIONS.CLIENT_PAYMENTS, [
      Query.equal("leadId", chunk),
      Query.limit(chunk.length),
    ]);
    paymentDocuments.push(...response.documents);
    }

    const out: Record<string, number> = {};
    for (const doc of paymentDocuments) {
    const leadId = typeof doc.leadId === "string" ? doc.leadId : "";
    if (!leadId || !allowedLeadIds.has(leadId)) continue;
    const updates = parseJsonOr<ClientPaymentUpdate[]>(doc.updates ?? doc.updatesJson, []);
    const paid = updates.reduce((sum, u) => {
      if (u && typeof u.amount === "number" && Number.isFinite(u.amount) && u.amount > 0) {
        return sum + u.amount;
      }
      return sum;
    }, 0);
    if (paid > 0) {
      out[leadId] = (out[leadId] ?? 0) + paid;
    }
    }

    return out;
}
