"use server";

import { ID, Query } from "node-appwrite";
import { createAdminClient } from "@/lib/server/appwrite";
import { assertAuthenticatedUserId } from "@/lib/server/current-user";
import { COLLECTIONS, DATABASE_ID } from "@/lib/constants/appwrite";
import { isRoleEligibleForComponent } from "@/lib/constants/component-access";
import { listAllDocuments } from "@/lib/server/appwrite-pagination";
import type { PendingAmount, PendingAmountStatus, User } from "@/lib/types";

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

function isAdminLikeReadRole(role: User["role"]) {
  return role === "admin" || role === "developer" || role === "monitor" || role === "operations";
}

function mapPendingDoc(doc: any): PendingAmount {
  return {
    $id: doc.$id,
    leadId: doc.leadId,
    paymentRecordId: doc.paymentRecordId,
    monthKey: doc.monthKey,
    pendingAmount: Number(doc.pendingAmount) || 0,
    status: (doc.status as PendingAmountStatus) || "pending",
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt ?? null,
    updatedById: doc.updatedById ?? null,
    updatedByName: doc.updatedByName ?? null,
  };
}

/**
 * Write or update a pending-amount row for (leadId, monthKey).
 * If a row already exists for this lead + month it is updated in-place;
 * otherwise a new row is created. When pendingAmount is 0 the status is
 * set to "cleared".
 */
export async function upsertPendingAmountAction(input: {
  actorId: string;
  leadId: string;
  paymentRecordId: string;
  monthKey: string;
  pendingAmount: number;
}): Promise<PendingAmount> {
  const actor = await getActor(input.actorId);
  ensureComponentAccess(actor.role, "history");

  const { databases } = await createAdminClient();
  const now = new Date().toISOString();
  const safeAmount = Math.max(0, Math.floor(Number(input.pendingAmount) || 0));
  const status: PendingAmountStatus = safeAmount === 0 ? "cleared" : "pending";

  // Check for an existing row for this lead + month
  const existingList = await databases.listDocuments(DATABASE_ID, COLLECTIONS.PENDING_AMOUNTS, [
    Query.equal("leadId", input.leadId),
    Query.equal("monthKey", input.monthKey),
    Query.limit(1),
  ]);

  const payload = {
    leadId: input.leadId,
    paymentRecordId: input.paymentRecordId,
    monthKey: input.monthKey,
    pendingAmount: safeAmount,
    status,
    updatedAt: now,
    updatedById: actor.$id,
    updatedByName: actor.name,
  };

  let doc: any;
  if (existingList.documents.length > 0) {
    const existingId = existingList.documents[0].$id;
    doc = await databases.updateDocument(DATABASE_ID, COLLECTIONS.PENDING_AMOUNTS, existingId, payload);
  } else {
    doc = await databases.createDocument(DATABASE_ID, COLLECTIONS.PENDING_AMOUNTS, ID.unique(), {
      ...payload,
      createdAt: now,
    });
  }

  return mapPendingDoc(doc);
}

/**
 * Fetch all pending-amount rows for a given lead, ordered by month descending.
 */
export async function listPendingAmountsByLeadAction(input: {
  actorId: string;
  leadId: string;
}): Promise<PendingAmount[]> {
  const actor = await getActor(input.actorId);
  ensureComponentAccess(actor.role, "history");

  const { databases } = await createAdminClient();
  const docs = await listAllDocuments<any>({
    databases,
    databaseId: DATABASE_ID,
    collectionId: COLLECTIONS.PENDING_AMOUNTS,
    queries: [
      Query.equal("leadId", input.leadId),
      Query.orderDesc("monthKey"),
    ],
    pageLimit: 100,
    maxPages: 100,
  });

  return docs.map(mapPendingDoc);
}

/**
 * Fetch pending-amount rows for multiple leads in one call.
 * Returns a map of leadId -> PendingAmount[].
 */
export async function listPendingAmountsByLeadIdsAction(input: {
  actorId: string;
  leadIds: string[];
}): Promise<Map<string, PendingAmount[]>> {
  const actor = await getActor(input.actorId);
  ensureComponentAccess(actor.role, "history");

  if (!input.leadIds.length) return new Map();

  const { databases } = await createAdminClient();
  const CHUNK = 100;
  const allDocs: any[] = [];
  for (let i = 0; i < input.leadIds.length; i += CHUNK) {
    const chunk = input.leadIds.slice(i, i + CHUNK);
    const response = await databases.listDocuments(DATABASE_ID, COLLECTIONS.PENDING_AMOUNTS, [
      Query.equal("leadId", chunk),
      Query.limit(chunk.length),
    ]);
    allDocs.push(...response.documents);
  }

  const result = new Map<string, PendingAmount[]>();
  for (const doc of allDocs) {
    const leadId = doc.leadId;
    const existing = result.get(leadId) || [];
    existing.push(mapPendingDoc(doc));
    result.set(leadId, existing);
  }
  return result;
}
