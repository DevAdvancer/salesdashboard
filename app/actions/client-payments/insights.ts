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


/**
 * Admin-only action: fetches all client payment records with full payment plan details
 * for use in the Financial Insights dashboard.
 */
export async function listAllPaymentInsightsAction(actorId: string, dateFrom?: string | null, dateTo?: string | null): Promise<PaymentInsightRecord[]> {
    const actor = await getActor(actorId);
    if (!isAdminLikeReadRole(actor.role)) {
    throw new Error("Not authorized");
    }

    const { databases } = await createAdminClient();
    const paymentQueries: string[] = [];
    if (dateFrom) {
    // If we only want records in a time range, any payment update will bump updatedAt.
    // This dramatically reduces full collection scans.
    paymentQueries.push(Query.greaterThanEqual("updatedAt", dateFrom.trim()));
    }

    const paymentDocs = await listAllDocuments<any>({
            databases,
            databaseId: DATABASE_ID,
            collectionId: COLLECTIONS.CLIENT_PAYMENTS,
            queries: paymentQueries,
            pageLimit: 100,
            maxPages: 500,
          });
    if (paymentDocs.length === 0) return [];
    const leadIds = Array.from(
            new Set(
              paymentDocs
                .map((doc: any) => (typeof doc.leadId === "string" ? doc.leadId : ""))
                .filter(Boolean)
            )
          );
    const leadDocs: any[] = [];
    for (let i = 0; i < leadIds.length; i += 100) {
      const chunkDocs = await listAllDocuments<any>({
        databases,
        databaseId: DATABASE_ID,
        collectionId: COLLECTIONS.LEADS,
        queries: [Query.equal("$id", leadIds.slice(i, i + 100))],
        pageLimit: 100,
        maxPages: 500,
      });
      leadDocs.push(...chunkDocs);
    }
    const leadDataMap = new Map<
            string,
            {
              company: string;
              source: string;
              leadStatus: string;
              isClosed: boolean;
              closedAt: string | null;
              leadAmount: number;
            }
          >();
    for (const lead of leadDocs as any[]) {
    let company = "";
    let source = "";
    let leadAmount = 0;
    try {
      const parsed = JSON.parse(lead.data ?? "{}") as Record<string, unknown>;
      company = typeof parsed.company === "string" ? parsed.company.trim() : "";
      source =
        typeof parsed.source === "string"
          ? parsed.source.trim()
          : "";
      if (!company) {
        const first = typeof parsed.firstName === "string" ? parsed.firstName.trim() : "";
        const last = typeof parsed.lastName === "string" ? parsed.lastName.trim() : "";
        company = [first, last].filter(Boolean).join(" ");
      }
      if (!company) {
        company = typeof parsed.email === "string" ? parsed.email.trim() : "";
      }
      // Parse the full contract amount from the lead form
      const rawAmount = parsed.leadAmount ?? parsed.totalAmount ?? parsed.amount;
      if (typeof rawAmount === "number" && Number.isFinite(rawAmount)) {
        leadAmount = rawAmount;
      } else if (typeof rawAmount === "string" && rawAmount.trim() !== "") {
        const num = Number(rawAmount);
        if (Number.isFinite(num)) leadAmount = num;
      }
    } catch {
      // ignore parse errors
    }
    leadDataMap.set(lead.$id, {
      company: company || "Unknown",
      source,
      leadStatus: typeof lead.status === "string" ? lead.status : "",
      isClosed: lead.isClosed === true,
      closedAt: typeof lead.closedAt === "string" ? lead.closedAt : null,
      leadAmount,
    });
    }

    const normalizedFrom = dateFrom ? dateFrom.trim() : null;
    const normalizedTo = dateTo ? dateTo.trim() : null;
    const pendingDocs = leadIds.length > 0
              ? await listAllDocuments<any>({
                  databases,
                  databaseId: DATABASE_ID,
                  collectionId: COLLECTIONS.PENDING_AMOUNTS,
                  queries: [Query.equal("leadId", leadIds)],
                  pageLimit: 100,
                  maxPages: 500,
                })
              : [];
    const pendingMap = new Map<string, { totalPending: number; latestMonth: string | null }>();
    for (const pDoc of pendingDocs as any[]) {
    const pLeadId = typeof pDoc.leadId === "string" ? pDoc.leadId : "";
    if (!pLeadId) continue;
    const amount = Number(pDoc.pendingAmount) || 0;
    const monthKey = typeof pDoc.monthKey === "string" ? pDoc.monthKey : "";
    const existing = pendingMap.get(pLeadId) || { totalPending: 0, latestMonth: null };
    existing.totalPending += amount;
    if (monthKey && (!existing.latestMonth || monthKey > existing.latestMonth)) {
      existing.latestMonth = monthKey;
    }
    pendingMap.set(pLeadId, existing);
    }

    const followupQueries: string[] = [];
    if (dateFrom) followupQueries.push(Query.greaterThanEqual("date", dateFrom.trim().slice(0, 10)));
    if (dateTo) followupQueries.push(Query.lessThanEqual("date", dateTo.trim().slice(0, 10)));
    const followupsDocs = await listAllDocuments<any>({
            databases,
            databaseId: DATABASE_ID,
            collectionId: COLLECTIONS.PREVIOUS_FOLLOWUPS_PAYMENTS,
            queries: followupQueries,
            pageLimit: 100,
            maxPages: 500,
          });
    const followupsMap = new Map<string, { total: number; count: number; monthlyAmounts: Record<string, number> }>();
    const followupsDetailsMap = new Map<string, Array<{
            company: string;
            candidateName: string;
            amount: number;
            date: string;
            remark: string | null;
            status: string;
          }>>();
    const standaloneFollowups: Array<{
        leadId: string;
        company: string;
        candidateName: string;
        amount: number;
        date: string;
        remark: string | null;
        status: string;
        createdAt: string;
        }> = [];
    for (const fDoc of followupsDocs as any[]) {
    const fLeadId = typeof fDoc.leadId === "string" ? fDoc.leadId : "";
    const company =
      typeof fDoc.company === "string" && fDoc.company.trim()
        ? fDoc.company.trim()
        : "Unknown";
    const amount = Number(fDoc.amount) || 0;
    const date = typeof fDoc.date === "string" ? fDoc.date : "";
    const detail = {
      company,
      candidateName: fDoc.candidateName,
      amount,
      date,
      remark: fDoc.paymentRemark || fDoc.remark || null,
      status: fDoc.status || "pending",
    };

    if (!fLeadId || !leadDataMap.has(fLeadId)) {
      standaloneFollowups.push({
        leadId: fLeadId || `manual-followup-${fDoc.$id}`,
        company,
        candidateName: fDoc.candidateName,
        amount,
        date,
        remark: fDoc.paymentRemark || fDoc.remark || null,
        status: fDoc.status || "pending",
        createdAt:
          typeof fDoc.createdAt === "string"
            ? fDoc.createdAt
            : `${date || new Date().toISOString().slice(0, 10)}T00:00:00.000Z`,
      });
      continue;
    }

    const existing = followupsMap.get(fLeadId) || { total: 0, count: 0, monthlyAmounts: {} };
    existing.total += amount;
    existing.count += 1;
    if (date.length >= 7) {
      const monthKey = date.slice(0, 7);
      existing.monthlyAmounts[monthKey] = (existing.monthlyAmounts[monthKey] || 0) + amount;
    }
    followupsMap.set(fLeadId, existing);

    const details = followupsDetailsMap.get(fLeadId) || [];
    details.push(detail);
    followupsDetailsMap.set(fLeadId, details);
    }

    const results: PaymentInsightRecord[] = [];
    for (const doc of paymentDocs as any[]) {
    const leadId = typeof doc.leadId === "string" ? doc.leadId : "";
    if (!leadId) continue;

    const paymentPlan = parseJsonOr<ClientPaymentPlan>(doc.paymentPlan ?? doc.paymentPlanJson, {
      percent: 0,
      months: 0,
      upfrontAmount: 0,
    });

    const status = (doc.status as PaymentStatus) ?? "not_paid";

    // Check if the record ever had a partially_paid status in its update history
    const updates = parseJsonOr<ClientPaymentUpdate[]>(doc.updates ?? doc.updatesJson, []);
    const wasPartiallyPaid =
      status === "fully_paid" &&
      updates.some((u) => u.status === "partially_paid");

    // Sum actual paid amounts from the updates (the real money collected).
    const paidUpdates = updates.filter((u: any) => typeof u.amount === "number" && u.amount > 0);
    const totalPaid = paidUpdates.reduce((sum: number, u: any) => sum + u.amount, 0);
    const paidUpdateCount = paidUpdates.length;

    // Bucket each payment by the month it was actually received (YYYY-MM).
    // This is the single source of truth for revenue attribution: a payment
    // recorded in July belongs to July, even if the lead closed in June.
    const paidMonthlyAmounts: Record<string, number> = {};
    for (const u of paidUpdates) {
      if (!u.createdAt) continue;
      const monthKey = u.createdAt.slice(0, 7); // "YYYY-MM"
      const amount = u.amount ?? 0;
      if (amount > 0) {
        paidMonthlyAmounts[monthKey] = (paidMonthlyAmounts[monthKey] || 0) + amount;
      }
    }

    const leadMeta = leadDataMap.get(leadId);

    // Apply date range filter if dates are provided.
    // Fall back to the payment record's createdAt when the lead has no
    // closedAt — otherwise records without a closing date are silently
    // dropped and never appear in the dashboard.
    if (normalizedFrom || normalizedTo) {
      const closedDate = toComparableIsoDate(leadMeta?.closedAt)
        || toComparableIsoDate(typeof doc.$createdAt === "string" ? doc.$createdAt : null);
      
      let outOfRange = false;
      if (normalizedFrom && (!closedDate || closedDate < normalizedFrom)) {
        outOfRange = true;
      }
      if (normalizedTo && (!closedDate || closedDate > normalizedTo)) {
        outOfRange = true;
      }

      if (outOfRange) {
        // The lead closed outside the filter range. However, it might have
        // followup payments collected inside the range. We extract those and
        // yield them as standalone followups so the revenue still appears in
        // the pending column (without inflating the upfront/total contract values).
        const followups = followupsDetailsMap.get(leadId) || [];
        for (const f of followups) {
          if (normalizedFrom && f.date && f.date < normalizedFrom) continue;
          if (normalizedTo && f.date && f.date > normalizedTo) continue;

          standaloneFollowups.push({
            leadId,
            company: f.company || leadMeta?.company || "Unknown",
            candidateName: f.candidateName,
            amount: f.amount,
            date: f.date,
            remark: f.remark,
            status: f.status,
            createdAt: f.date
              ? `${f.date}T00:00:00.000Z`
              : (typeof doc.$createdAt === "string" ? doc.$createdAt : new Date().toISOString()),
          });
        }
        continue;
      }
    }

    results.push({
      leadId,
      company: leadMeta?.company ?? "Unknown",
      source: leadMeta?.source ?? "",
      leadStatus: leadMeta?.leadStatus ?? "",
      isFollowupOnly: false,
      isClosed: leadMeta?.isClosed === true,
      closedAt: leadMeta?.closedAt ?? null,
      upfrontAmount: paymentPlan.upfrontAmount,
      months: paymentPlan.months,
      percent: paymentPlan.percent,
      status,
      createdAt: typeof doc.$createdAt === "string" ? doc.$createdAt : new Date().toISOString(),
      wasPartiallyPaid,
      totalPaid: paidUpdateCount > 0 ? totalPaid : null,
      paidUpdateCount,
      pendingTotal: pendingMap.get(leadId)?.totalPending ?? null,
      latestPendingMonth: pendingMap.get(leadId)?.latestMonth ?? null,
      paidMonthlyAmounts,
      followupsMonthlyAmounts: followupsMap.get(leadId)?.monthlyAmounts ?? {},
      leadAmount: leadMeta?.leadAmount ?? 0,
      followupsTotal: followupsMap.get(leadId)?.total ?? 0,
      followupsCount: followupsMap.get(leadId)?.count ?? 0,
      followupsPayments: followupsDetailsMap.get(leadId) || [],
    });
    }

    for (const followup of standaloneFollowups) {
    if (normalizedFrom && followup.date && followup.date < normalizedFrom) {
      continue;
    }
    if (normalizedTo && followup.date && followup.date > normalizedTo) {
      continue;
    }

    results.push({
      leadId: followup.leadId,
      company: followup.company,
      source: "Followup payment",
      leadStatus: "followup_payment",
      isFollowupOnly: true,
      isClosed: false,
      closedAt: null,
      upfrontAmount: 0,
      months: 0,
      percent: 0,
      status: "fully_paid",
      createdAt: followup.createdAt,
      wasPartiallyPaid: false,
      totalPaid: followup.amount,
      paidUpdateCount: 0,
      pendingTotal: null,
      latestPendingMonth: null,
      paidMonthlyAmounts: {},
      followupsMonthlyAmounts: followup.date
        ? { [followup.date.slice(0, 7)]: followup.amount }
        : {},
      leadAmount: 0,
      followupsTotal: followup.amount,
      followupsCount: 1,
      followupsPayments: [
        {
          company: followup.company,
          candidateName: followup.candidateName,
          amount: followup.amount,
          date: followup.date,
          remark: followup.remark,
          status: followup.status,
        },
      ],
    });
    }

    return results;
}

export async function listAdminClientHistoryRowsAction(actorId: string): Promise<AdminClientHistoryRow[]> {
    const actor = await getActor(actorId);
    ensureComponentAccess(actor.role, "history");
    if (!isAdminLikeReadRole(actor.role)) {
    throw new Error("Not authorized");
    }

    const { databases } = await createAdminClient();
    const paymentDocs = await listAllDocuments<any>({
            databases,
            databaseId: DATABASE_ID,
            collectionId: COLLECTIONS.CLIENT_PAYMENTS,
            queries: [],
            pageLimit: 100,
            maxPages: 500,
          });
    if (paymentDocs.length === 0) return [];
    const leadIds = Array.from(
            new Set(
              paymentDocs
                .map((doc: any) =>
                  typeof doc.leadId === "string" ? doc.leadId.trim() : "",
                )
                .filter(Boolean),
            ),
          );
    const leadDocs: any[] = [];
    for (let i = 0; i < leadIds.length; i += 100) {
      const chunkDocs = await listAllDocuments<any>({
        databases,
        databaseId: DATABASE_ID,
        collectionId: COLLECTIONS.LEADS,
        queries: [Query.equal("$id", leadIds.slice(i, i + 100))],
        pageLimit: 100,
        maxPages: 500,
      });
      leadDocs.push(...chunkDocs);
    }
    const leadMap = new Map<string, Lead>();
    for (const leadDoc of leadDocs as any[]) {
    leadMap.set(leadDoc.$id, mapLeadDocumentToLead(leadDoc));
    }

    const rows: AdminClientHistoryRow[] = [];
    for (const doc of paymentDocs as any[]) {
    const leadId =
      typeof doc.leadId === "string" ? doc.leadId.trim() : "";
    const createdAt =
      typeof doc.$createdAt === "string"
        ? doc.$createdAt
        : new Date().toISOString();
    const personalDetails = parseJsonOr<Record<string, unknown>>(
      doc.personalDetails ?? doc.personalDetailsJson,
      {},
    );
    const paymentPlan = parseJsonOr<ClientPaymentPlan>(
      doc.paymentPlan ?? doc.paymentPlanJson,
      {
        percent: 0,
        months: 0,
        upfrontAmount: 0,
      },
    );
    const status = (doc.status as PaymentStatus) ?? "not_paid";
    const updates = parseJsonOr<ClientPaymentUpdate[]>(
      doc.updates ?? doc.updatesJson,
      [],
    );
    let totalPaid = 0;
    let paidUpdateCount = 0;
    for (const update of updates) {
      if (
        typeof update?.amount === "number" &&
        Number.isFinite(update.amount)
      ) {
        totalPaid += update.amount;
        paidUpdateCount += 1;
      }
    }

    const lead = leadId
      ? (leadMap.get(leadId) ??
        buildSyntheticLead(leadId, personalDetails, createdAt))
      : buildSyntheticLead(String(doc.$id ?? crypto.randomUUID()), personalDetails, createdAt);

    rows.push({
      rowId: typeof doc.$id === "string" ? doc.$id : crypto.randomUUID(),
      leadId: lead.$id,
      lead,
      paymentStatus: status,
      personalDetails,
      paymentPlan,
      createdAt,
      totalPaid: paidUpdateCount > 0 ? totalPaid : null,
      canOpenLead: leadMap.has(lead.$id),
    });
    }

    return rows;
}

/**
 * Operations/admin/developer/monitor report: lists every client payment record
 * with the most recent update's metadata (note, actor, timestamp, amount paid)
 * and the agreed payment plan. Powers the /payments-report page.
 */
export async function listPaymentsReportAction(input: {
    actorId: string;
    dateFrom?: string;
    dateTo?: string;
    }): Promise<PaymentsReportRow[]> {
    const actor = await getActor(input.actorId);
    if (!isAdminLikeReadRole(actor.role)) {
    throw new Error("Not authorized");
    }

    const { databases } = await createAdminClient();
    const paymentDocs = await listAllDocuments<any>({
            databases,
            databaseId: DATABASE_ID,
            collectionId: COLLECTIONS.CLIENT_PAYMENTS,
            queries: [],
            pageLimit: 100,
            maxPages: 500,
          });
    if (paymentDocs.length === 0) return [];
    const leadIds = Array.from(
            new Set(
              paymentDocs
                .map((doc: any) => (typeof doc.leadId === "string" ? doc.leadId : ""))
                .filter(Boolean)
            )
          );
    const leadDocs: any[] = [];
    for (let i = 0; i < leadIds.length; i += 100) {
      const chunkDocs = await listAllDocuments<any>({
        databases,
        databaseId: DATABASE_ID,
        collectionId: COLLECTIONS.LEADS,
        queries: [Query.equal("$id", leadIds.slice(i, i + 100))],
        pageLimit: 100,
        maxPages: 500,
      });
      leadDocs.push(...chunkDocs);
    }
    const leadDataMap = new Map<string, string>();
    const leadLegalNameMap = new Map<string, string>();
    const leadAmountMap = new Map<string, number>();
    const leadClosedAtMap = new Map<string, string | null>();
    const leadOwnerIdMap = new Map<string, string | null>();
    const allAgentIds = new Set<string>();

    for (const lead of leadDocs as any[]) {
    let company = "";
    let legalName = "";
    let leadAmount = 0;
    try {
      const parsed = JSON.parse(lead.data ?? "{}") as Record<string, unknown>;
      const fromCompany = typeof parsed.company === "string" ? parsed.company.trim() : "";
      const first = typeof parsed.firstName === "string" ? parsed.firstName.trim() : "";
      const last = typeof parsed.lastName === "string" ? parsed.lastName.trim() : "";
      const fromName = [first, last].filter(Boolean).join(" ");
      const fromEmail = typeof parsed.email === "string" ? parsed.email.trim() : "";
      company = fromCompany || fromName || fromEmail;
      if (typeof parsed.legalName === "string") {
        legalName = parsed.legalName.trim();
      }
      // The lead form stores the total amount on the leadAmount key. Some
      // legacy leads may have been written under "totalAmount" — accept that
      // too so the report keeps working for previously-saved leads.
      const rawAmount =
        parsed.leadAmount ?? parsed.totalAmount ?? parsed.amount;
      if (typeof rawAmount === "number" && Number.isFinite(rawAmount)) {
        leadAmount = rawAmount;
      } else if (typeof rawAmount === "string" && rawAmount.trim() !== "") {
        const num = Number(rawAmount);
        if (Number.isFinite(num)) leadAmount = num;
      }
    } catch {
      // ignore parse errors
    }
    leadDataMap.set(lead.$id, company || "Unknown");
    leadLegalNameMap.set(lead.$id, legalName);
    leadAmountMap.set(lead.$id, leadAmount);
    leadClosedAtMap.set(
      lead.$id,
      typeof lead.closedAt === "string" ? lead.closedAt : null,
    );
    const ownerId = typeof lead.ownerId === "string" ? lead.ownerId : typeof lead.assignedToId === "string" ? lead.assignedToId : null;
    leadOwnerIdMap.set(lead.$id, ownerId);
    if (ownerId) allAgentIds.add(ownerId);
    }

    // Fetch user names
    const userNameMap = new Map<string, string>();
    const agentIdsArray = Array.from(allAgentIds);
    for (let i = 0; i < agentIdsArray.length; i += 100) {
      const chunkIds = agentIdsArray.slice(i, i + 100);
      const userDocs = await listAllDocuments<any>({
        databases,
        databaseId: DATABASE_ID,
        collectionId: COLLECTIONS.USERS,
        queries: [Query.equal("$id", chunkIds), Query.select(["$id", "name"])],
        pageLimit: 100,
        maxPages: 5,
      });
      for (const u of userDocs) {
        userNameMap.set(u.$id, u.name);
      }
    }

    const normalizedFrom = toComparableIsoDate(input.dateFrom);
    const normalizedTo = toComparableIsoDate(input.dateTo);
    const rows: PaymentsReportRow[] = [];
    for (const doc of paymentDocs as any[]) {
    const leadId = typeof doc.leadId === "string" ? doc.leadId : "";
    if (!leadId) continue;

    const paymentPlan = parseJsonOr<ClientPaymentPlan>(doc.paymentPlan ?? doc.paymentPlanJson, {
      percent: 0,
      months: 0,
      upfrontAmount: 0,
    });
    const status = (doc.status as PaymentStatus) ?? "not_paid";
    const updates = parseJsonOr<ClientPaymentUpdate[]>(doc.updates ?? doc.updatesJson, []);
    const head = updates[0] ?? null;
    const closedAt = leadClosedAtMap.get(leadId) ?? null;
    // Fall back to the payment record's createdAt when the lead has no
    // closedAt — otherwise records without a closing date are silently
    // dropped and never appear in the report.
    const closedDate = toComparableIsoDate(closedAt)
      || toComparableIsoDate(typeof doc.$createdAt === "string" ? doc.$createdAt : null);

    if (normalizedFrom && (!closedDate || closedDate < normalizedFrom)) {
      continue;
    }
    if (normalizedTo && (!closedDate || closedDate > normalizedTo)) {
      continue;
    }

    // Sum the `amount` of every update. This is the running total actually
    // collected so far across every status change on this record.
    let totalPaid = 0;
    let paidUpdateCount = 0;
    for (const u of updates) {
      if (typeof u?.amount === "number" && Number.isFinite(u.amount)) {
        totalPaid += u.amount;
        paidUpdateCount += 1;
      }
    }

    rows.push({
      $id: doc.$id,
      leadId,
      company: leadDataMap.get(leadId) ?? "Unknown",
      legalName: leadLegalNameMap.get(leadId) ?? "",
      agentId: leadOwnerIdMap.get(leadId) ?? null,
      agentName: userNameMap.get(leadOwnerIdMap.get(leadId) || "") ?? null,
      closedAt,
      status,
      paymentPlan,
      leadAmount: leadAmountMap.get(leadId) ?? 0,
      totalPaid: paidUpdateCount > 0 ? totalPaid : null,
      paidUpdateCount,
      createdAt: typeof doc.$createdAt === "string" ? doc.$createdAt : new Date().toISOString(),
      lastUpdate: head
        ? {
            id: head.id,
            createdAt: head.createdAt,
            actorName: head.actorName,
            note: head.note ?? null,
            amount:
              typeof head.amount === "number" && Number.isFinite(head.amount) ? head.amount : null,
          }
        : null,
    });
    }

    return rows;
}
