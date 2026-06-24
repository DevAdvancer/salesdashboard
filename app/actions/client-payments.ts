"use server";

import crypto from "crypto";
import { ID, Query } from "node-appwrite";
import { createAdminClient } from "@/lib/server/appwrite";
import { assertAuthenticatedUserId } from "@/lib/server/current-user";
import { listAllDocuments } from "@/lib/server/appwrite-pagination";
import { COLLECTIONS, DATABASE_ID } from "@/lib/constants/appwrite";
import { isRoleEligibleForComponent } from "@/lib/constants/component-access";
import { getAppwriteErrorMessage } from "@/lib/server/appwrite-errors";
import type {
  ClientPaymentPlan,
  ClientPaymentRecord,
  ClientPaymentUpdate,
  Lead,
  PaymentStatus,
  User,
} from "@/lib/types";
import { getSpecialBranchLeadAccess } from "@/lib/constants/special-lead-access";

async function getActor(userId: string): Promise<User> {
  await assertAuthenticatedUserId(userId);
  const { databases } = await createAdminClient();
  const doc = await (async () => {
    try {
      return await databases.getDocument(DATABASE_ID, COLLECTIONS.USERS, userId);
    } catch (error) {
      throw new Error(getAppwriteErrorMessage(error));
    }
  })();
  return {
    $id: doc.$id,
    name: doc.name,
    email: doc.email,
    role: doc.role,
    teamLeadId: doc.teamLeadId || null,
    branchIds: doc.branchIds || [],
    branchId: doc.branchId || null,
    $createdAt: doc.$createdAt,
    $updatedAt: doc.$updatedAt,
  } as User;
}

function ensureComponentAccess(role: string, componentKey: Parameters<typeof isRoleEligibleForComponent>[0]) {
  if (!isRoleEligibleForComponent(componentKey, role as any)) {
    throw new Error("Not authorized");
  }
}

function isAdminLikeReadRole(role: User["role"]) {
  return role === "admin" || role === "developer" || role === "monitor" || role === "operations";
}

function assertCanMutateClientPayments(actor: User) {
  // `monitor` is allowed to close leads (and therefore upsert the matching
  // client payment record). `operations` remains read-only here.
  if (actor.role === "operations") {
    throw new Error("Not authorized");
  }
}

function parseJsonOr<T>(value: unknown, fallback: T): T {
  if (typeof value !== "string") return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

async function canActorAccessLead(actor: User, leadId: string): Promise<boolean> {
  const { databases } = await createAdminClient();
  const lead = (await databases.getDocument(DATABASE_ID, COLLECTIONS.LEADS, leadId)) as any;

  if (isAdminLikeReadRole(actor.role)) return true;

  const branchId = typeof lead.branchId === "string" ? lead.branchId : null;
  const specialBranchId = getSpecialBranchLeadAccess(actor.email);
  if (specialBranchId && branchId === specialBranchId) {
    return true;
  }
  const ownerId = typeof lead.ownerId === "string" ? lead.ownerId : null;
  const assignedToId = typeof lead.assignedToId === "string" ? lead.assignedToId : null;
  const permissions = Array.isArray(lead.$permissions) ? (lead.$permissions as string[]) : [];

  if (actor.role === "agent" || actor.role === "lead_generation") {
    return (
      ownerId === actor.$id ||
      assignedToId === actor.$id ||
      permissions.some((permission) => permission === `read("user:${actor.$id}")`)
    );
  }

  if (actor.role === "team_lead") {
    const agents = await databases.listDocuments(DATABASE_ID, COLLECTIONS.USERS, [
      Query.equal("teamLeadId", actor.$id),
      Query.or([Query.equal("role", "agent"), Query.equal("role", "lead_generation")]),
      Query.limit(5000),
    ]);
    const teamIds = new Set<string>([actor.$id, ...agents.documents.map((doc: any) => doc.$id)]);
    return (
      (ownerId ? teamIds.has(ownerId) : false) ||
      (assignedToId ? teamIds.has(assignedToId) : false) ||
      (branchId && actor.branchIds?.includes(branchId))
    );
  }

    return false;
}

function mapRecord(doc: any): ClientPaymentRecord {
  const personalDetails = parseJsonOr<Record<string, unknown>>(doc.personalDetails ?? doc.personalDetailsJson, {});
  const paymentPlan = parseJsonOr<ClientPaymentPlan>(doc.paymentPlan ?? doc.paymentPlanJson, {
    percent: 0,
    months: 0,
    upfrontAmount: 0,
  });
  const updates = parseJsonOr<ClientPaymentUpdate[]>(doc.updates ?? doc.updatesJson, []);
  const status = (doc.status as PaymentStatus) ?? "not_paid";

  return {
    $id: doc.$id,
    leadId: doc.leadId,
    personalDetails,
    paymentPlan,
    status,
    updates,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt ?? null,
    lastReminderAt: doc.lastReminderAt ?? null,
    updatedById: doc.updatedById ?? null,
    updatedByName: doc.updatedByName ?? null,
  };
}

async function findRecordByLeadId(leadId: string) {
  const { databases } = await createAdminClient();
  const response = await databases.listDocuments(DATABASE_ID, COLLECTIONS.CLIENT_PAYMENTS, [
    Query.equal("leadId", leadId),
    Query.limit(1),
  ]);
  return response.documents[0] ?? null;
}

export async function getClientPaymentRecordAction(
  actorId: string,
  leadId: string
): Promise<ClientPaymentRecord | null> {
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
  // When the record is first created, the planned upfrontAmount represents
  // the first payment — store it on the initial update so the running
  // total of paid amounts reflects what the user entered.
  const initialAmount =
    typeof input.paymentPlan?.upfrontAmount === "number" &&
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
  const sanitizedAmount =
    typeof input.amount === "number" && Number.isFinite(input.amount) ? input.amount : null;
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

  // Resolve which leads the actor is allowed to see.
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

export interface PaymentInsightRecord {
  leadId: string;
  company: string;
  source: string;
  leadStatus: string;
  isClosed: boolean;
  closedAt: string | null;
  upfrontAmount: number;
  months: number;
  percent: number;
  status: PaymentStatus;
  /** ISO timestamp when the payment record was created */
  createdAt: string;
  /** Whether the client transitioned from partially_paid to fully_paid at some point */
  wasPartiallyPaid: boolean;
  /** Sum of every update's `amount` field — the real money collected so far. Null when no update carried an amount. */
  totalPaid: number | null;
  /** Number of updates that carried an `amount`. */
  paidUpdateCount: number;
}

export interface AdminClientHistoryRow {
  rowId: string;
  leadId: string;
  lead: Lead;
  paymentStatus: PaymentStatus;
  personalDetails: Record<string, unknown>;
  paymentPlan: ClientPaymentPlan;
  createdAt: string;
  totalPaid: number | null;
  canOpenLead: boolean;
}

/**
 * Admin-only action: fetches all client payment records with full payment plan details
 * for use in the Financial Insights dashboard.
 */
export async function listAllPaymentInsightsAction(
  actorId: string
): Promise<PaymentInsightRecord[]> {
  const actor = await getActor(actorId);

  if (!isAdminLikeReadRole(actor.role)) {
    throw new Error("Not authorized");
  }

  const { databases } = await createAdminClient();

  // Fetch all payment records (admin sees everything) using cursor
  // pagination so we never silently cap at 5000.
  const paymentDocs = await listAllDocuments<any>({
    databases,
    databaseId: DATABASE_ID,
    collectionId: COLLECTIONS.CLIENT_PAYMENTS,
    queries: [],
    pageLimit: 100,
    maxPages: 500,
  });

  if (paymentDocs.length === 0) return [];

  // Batch-fetch all lead documents to get company names
  const leadIds = Array.from(
    new Set(
      paymentDocs
        .map((doc: any) => (typeof doc.leadId === "string" ? doc.leadId : ""))
        .filter(Boolean)
    )
  );

  const leadDocs =
    leadIds.length > 0
      ? await listAllDocuments<any>({
          databases,
          databaseId: DATABASE_ID,
          collectionId: COLLECTIONS.LEADS,
          queries: [Query.equal("$id", leadIds)],
          pageLimit: 100,
          maxPages: 500,
        })
      : [];

  const leadDataMap = new Map<
    string,
    {
      company: string;
      source: string;
      leadStatus: string;
      isClosed: boolean;
      closedAt: string | null;
    }
  >();
  for (const lead of leadDocs as any[]) {
    let company = "";
    let source = "";
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
    } catch {
      // ignore parse errors
    }
    leadDataMap.set(lead.$id, {
      company: company || "Unknown",
      source,
      leadStatus: typeof lead.status === "string" ? lead.status : "",
      isClosed: lead.isClosed === true,
      closedAt: typeof lead.closedAt === "string" ? lead.closedAt : null,
    });
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

    const leadMeta = leadDataMap.get(leadId);

    results.push({
      leadId,
      company: leadMeta?.company ?? "Unknown",
      source: leadMeta?.source ?? "",
      leadStatus: leadMeta?.leadStatus ?? "",
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
    });
  }

  return results;
}

function mapLeadDocumentToLead(doc: any): Lead {
  return {
    $id: doc.$id,
    data: typeof doc.data === "string" ? doc.data : "{}",
    status: typeof doc.status === "string" ? doc.status : "",
    ownerId: typeof doc.ownerId === "string" ? doc.ownerId : "",
    assignedToId:
      typeof doc.assignedToId === "string" ? doc.assignedToId : null,
    branchId: typeof doc.branchId === "string" ? doc.branchId : null,
    isClosed: doc.isClosed === true,
    closedAt: typeof doc.closedAt === "string" ? doc.closedAt : null,
    nextFollowUpAt:
      typeof doc.nextFollowUpAt === "string" ? doc.nextFollowUpAt : null,
    nextAction: typeof doc.nextAction === "string" ? doc.nextAction : null,
    lastContactedAt:
      typeof doc.lastContactedAt === "string" ? doc.lastContactedAt : null,
    followUpStatus:
      typeof doc.followUpStatus === "string" ? doc.followUpStatus : null,
    $createdAt: typeof doc.$createdAt === "string" ? doc.$createdAt : undefined,
    $updatedAt: typeof doc.$updatedAt === "string" ? doc.$updatedAt : undefined,
    $permissions: Array.isArray(doc.$permissions) ? doc.$permissions : [],
  };
}

function buildSyntheticLead(
  leadId: string,
  personalDetails: Record<string, unknown>,
  createdAt: string,
): Lead {
  return {
    $id: leadId,
    data: JSON.stringify(personalDetails ?? {}),
    status: "Unknown",
    ownerId: "",
    assignedToId: null,
    branchId: null,
    isClosed: true,
    closedAt: null,
    $createdAt: createdAt,
    $updatedAt: createdAt,
    $permissions: [],
  };
}

export async function listAdminClientHistoryRowsAction(
  actorId: string,
): Promise<AdminClientHistoryRow[]> {
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

  const leadDocs =
    leadIds.length > 0
      ? await listAllDocuments<any>({
          databases,
          databaseId: DATABASE_ID,
          collectionId: COLLECTIONS.LEADS,
          queries: [Query.equal("$id", leadIds)],
          pageLimit: 100,
          maxPages: 500,
        })
      : [];

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

export interface PaymentsReportRow {
  $id: string;
  leadId: string;
  company: string;
  legalName: string;
  closedAt: string | null;
  status: PaymentStatus;
  paymentPlan: ClientPaymentPlan;
  /** Most recent ClientPaymentUpdate entry, or null if the record has no updates. */
  lastUpdate: {
    id: string;
    createdAt: string;
    actorName: string;
    note: string | null;
    amount: number | null;
  } | null;
  /** Total amount to be paid for this lead, from the lead form. */
  leadAmount: number;
  /**
   * Sum of every update's `amount` field on this record (i.e. the running
   * total actually collected so far). Null when no update carried an amount.
   */
  totalPaid: number | null;
  /** Number of updates on this record that carried an `amount`. */
  paidUpdateCount: number;
  createdAt: string;
}

function toComparableIsoDate(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

/**
 * Operations/admin/developer/monitor report: lists every client payment record
 * with the most recent update's metadata (note, actor, timestamp, amount paid)
 * and the agreed payment plan. Powers the /payments-report page.
 */
export async function listPaymentsReportAction(
  input: {
    actorId: string;
    dateFrom?: string;
    dateTo?: string;
  }
): Promise<PaymentsReportRow[]> {
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

  const leadDocs =
    leadIds.length > 0
      ? await listAllDocuments<any>({
          databases,
          databaseId: DATABASE_ID,
          collectionId: COLLECTIONS.LEADS,
          queries: [Query.equal("$id", leadIds)],
          pageLimit: 100,
          maxPages: 500,
        })
      : [];

  const leadDataMap = new Map<string, string>();
  const leadLegalNameMap = new Map<string, string>();
  const leadAmountMap = new Map<string, number>();
  const leadClosedAtMap = new Map<string, string | null>();
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
    const closedDate = toComparableIsoDate(closedAt);

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
