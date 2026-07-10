"use server";

import { ID, Query } from "node-appwrite";
import { createAdminClient } from "@/lib/server/appwrite";
import { assertAuthenticatedUserId } from "@/lib/server/current-user";
import { COLLECTIONS, DATABASE_ID } from "@/lib/constants/appwrite";
import { isRoleEligibleForComponent } from "@/lib/constants/component-access";
import { listAllDocuments } from "@/lib/server/appwrite-pagination";
import {
  FOLLOWUPS_PAYMENT_COMPANIES,
  type FollowupsPaymentCompany,
  type PreviousFollowupsPayment,
  type FollowupsPaymentStatus,
  type User,
} from "@/lib/types";

const MANUAL_FOLLOWUP_LEAD_ID_PREFIX = "manual_followup:";
const FOLLOWUPS_PAYMENT_STATUS: FollowupsPaymentStatus = "paid";

async function getActor(userId: string): Promise<User> {
  await assertAuthenticatedUserId(userId);
  const { databases } = await createAdminClient();
  const doc = await databases.getDocument(DATABASE_ID, COLLECTIONS.USERS, userId);
  return {
    $id: doc.$id,
    name: doc.name,
    email: doc.email,
    role: doc.role as User["role"],
    teamLeadId: doc.teamLeadId || null,
    branchIds: doc.branchIds || [],
    branchId: doc.branchId || null,
    department: (doc.department as User["department"]) || "sales",
    $createdAt: doc.$createdAt,
    $updatedAt: doc.$updatedAt,
  };
}

function ensureComponentAccess(role: User["role"], componentKey: Parameters<typeof isRoleEligibleForComponent>[0]) {
  if (!isRoleEligibleForComponent(componentKey, role as any)) {
    throw new Error("Not authorized");
  }
}

function assertCanMutateFollowups(actor: User) {
  if (actor.role === "operations" || actor.role === "monitor") {
    throw new Error("Not authorized");
  }
}

function mapFollowupsDoc(doc: any): PreviousFollowupsPayment {
  const rawCompany = typeof doc.company === "string" ? doc.company.trim() : "";
  const company = FOLLOWUPS_PAYMENT_COMPANIES.includes(rawCompany as FollowupsPaymentCompany)
    ? (rawCompany as FollowupsPaymentCompany)
    : FOLLOWUPS_PAYMENT_COMPANIES[0];

  return {
    $id: doc.$id,
    leadId: doc.leadId,
    company,
    candidateName: doc.candidateName,
    amount: Number(doc.amount) || 0,
    date: doc.date,
    remark: doc.paymentRemark || doc.remark || null,
    status: FOLLOWUPS_PAYMENT_STATUS,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt ?? null,
    updatedById: doc.updatedById ?? null,
    updatedByName: doc.updatedByName ?? null,
  };
}

function normalizeCompany(company: string): FollowupsPaymentCompany {
  const normalized = company.trim();
  if (FOLLOWUPS_PAYMENT_COMPANIES.includes(normalized as FollowupsPaymentCompany)) {
    return normalized as FollowupsPaymentCompany;
  }

  throw new Error("Invalid company");
}

function makeManualLeadId(): string {
  return `${MANUAL_FOLLOWUP_LEAD_ID_PREFIX}${ID.unique()}`;
}

export async function createPreviousFollowupsPaymentAction(input: {
  actorId: string;
  leadId?: string | null;
  company: FollowupsPaymentCompany;
  candidateName: string;
  amount: number;
  date: string;
  remark?: string | null;
}): Promise<PreviousFollowupsPayment> {
  const actor = await getActor(input.actorId);
  ensureComponentAccess(actor.role, "followups-payments");
  assertCanMutateFollowups(actor);

  const { databases } = await createAdminClient();
  const payload: Record<string, unknown> = {
    leadId: input.leadId?.trim() || makeManualLeadId(),
    company: normalizeCompany(input.company),
    candidateName: input.candidateName.trim(),
    amount: Math.floor(Number(input.amount) || 0),
    date: input.date,
    status: FOLLOWUPS_PAYMENT_STATUS,
    createdAt: new Date().toISOString(),
  };

  const paymentRemark = input.remark?.trim();
  if (paymentRemark) {
    payload.paymentRemark = paymentRemark;
  }

  const doc = await databases.createDocument(
    DATABASE_ID,
    COLLECTIONS.PREVIOUS_FOLLOWUPS_PAYMENTS,
    ID.unique(),
    payload,
  );

  return mapFollowupsDoc(doc);
}

export async function updatePreviousFollowupsPaymentAction(input: {
  actorId: string;
  paymentId: string;
  company?: FollowupsPaymentCompany | null;
  candidateName?: string | null;
  amount?: number | null;
  date?: string | null;
  remark?: string | null;
}): Promise<PreviousFollowupsPayment> {
  const actor = await getActor(input.actorId);
  ensureComponentAccess(actor.role, "followups-payments");
  assertCanMutateFollowups(actor);

  const { databases } = await createAdminClient();

  await databases.getDocument(DATABASE_ID, COLLECTIONS.PREVIOUS_FOLLOWUPS_PAYMENTS, input.paymentId);

  const payload: any = {
    updatedAt: new Date().toISOString(),
    updatedById: actor.$id,
    updatedByName: actor.name,
  };

  if (input.company !== undefined && input.company !== null) payload.company = normalizeCompany(input.company);
  if (input.candidateName !== undefined) payload.candidateName = (input.candidateName || '').trim();
  if (input.amount !== undefined) payload.amount = Math.floor(Number(input.amount) || 0);
  if (input.date !== undefined) payload.date = input.date;
  if (input.remark !== undefined) payload.paymentRemark = input.remark?.trim() || null;
  payload.status = FOLLOWUPS_PAYMENT_STATUS;

  const doc = await databases.updateDocument(
    DATABASE_ID,
    COLLECTIONS.PREVIOUS_FOLLOWUPS_PAYMENTS,
    input.paymentId,
    payload
  );

  return mapFollowupsDoc(doc);
}

export async function listPreviousFollowupsPaymentsAction(input: {
  actorId: string;
  leadId?: string | null;
  company?: FollowupsPaymentCompany | null;
  dateFrom?: string | null;
  dateTo?: string | null;
  status?: string | null;
}): Promise<PreviousFollowupsPayment[]> {
  const actor = await getActor(input.actorId);
  ensureComponentAccess(actor.role, "followups-payments");

  const { databases } = await createAdminClient();
  const queries: string[] = [Query.orderDesc("createdAt")];

  if (input.leadId) {
    queries.unshift(Query.equal("leadId", input.leadId));
  }

  if (input.company) {
    queries.push(Query.equal("company", normalizeCompany(input.company)));
  }

  if (input.dateFrom) {
    queries.push(Query.greaterThanEqual("date", input.dateFrom));
  }

  if (input.dateTo) {
    queries.push(Query.lessThanEqual("date", input.dateTo));
  }

  if (input.status) {
    queries.push(Query.equal("status", input.status));
  }

  const docs = await listAllDocuments<any>({
    databases,
    databaseId: DATABASE_ID,
    collectionId: COLLECTIONS.PREVIOUS_FOLLOWUPS_PAYMENTS,
    queries,
    pageLimit: 100,
    maxPages: 500,
  });

  return docs.map(mapFollowupsDoc);
}

export async function deletePreviousFollowupsPaymentAction(input: {
  actorId: string;
  paymentId: string;
}): Promise<void> {
  const actor = await getActor(input.actorId);
  ensureComponentAccess(actor.role, "followups-payments");
  assertCanMutateFollowups(actor);

  const { databases } = await createAdminClient();
  await databases.deleteDocument(DATABASE_ID, COLLECTIONS.PREVIOUS_FOLLOWUPS_PAYMENTS, input.paymentId);
}
