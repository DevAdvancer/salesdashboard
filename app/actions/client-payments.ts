"use server";

import crypto from "crypto";
import { ID, Query } from "node-appwrite";
import { createAdminClient } from "@/lib/server/appwrite";
import { assertAuthenticatedUserId } from "@/lib/server/current-user";
import { COLLECTIONS, DATABASE_ID } from "@/lib/constants/appwrite";
import { isRoleEligibleForComponent } from "@/lib/constants/component-access";
import { getAppwriteErrorMessage } from "@/lib/server/appwrite-errors";
import type {
  ClientPaymentPlan,
  ClientPaymentRecord,
  ClientPaymentUpdate,
  PaymentStatus,
  User,
} from "@/lib/types";

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
    managerId: doc.managerId || null,
    managerIds: doc.managerIds || [],
    assistantManagerId: doc.assistantManagerId || null,
    assistantManagerIds: doc.assistantManagerIds || [],
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

  if (actor.role === "admin") return true;

  const branchId = typeof lead.branchId === "string" ? lead.branchId : null;
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
      (branchId ? (actor.branchIds ?? []).includes(branchId) : false)
    );
  }

  if (actor.role === "manager" || actor.role === "assistant_manager") {
    return (
      ownerId === actor.$id ||
      assignedToId === actor.$id ||
      (branchId ? (actor.branchIds ?? []).includes(branchId) : false)
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

  if (!(await canActorAccessLead(actor, input.leadId))) {
    throw new Error("Not authorized");
  }

  const { databases } = await createAdminClient();
  const now = new Date().toISOString();
  const existing = await findRecordByLeadId(input.leadId);

  const status = input.initialStatus ?? (existing?.status as PaymentStatus) ?? "not_paid";
  const updates = existing ? parseJsonOr<ClientPaymentUpdate[]>(existing.updates, []) : [];
  const shouldCreateInitialUpdate = updates.length === 0;
  const nextUpdates = shouldCreateInitialUpdate
    ? [
        {
          id: crypto.randomUUID(),
          status,
          note: "Initialized",
          actorId: actor.$id,
          actorName: actor.name,
          createdAt: now,
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
}): Promise<ClientPaymentRecord> {
  const actor = await getActor(input.actorId);
  ensureComponentAccess(actor.role, "history");

  if (!(await canActorAccessLead(actor, input.leadId))) {
    throw new Error("Not authorized");
  }

  const existing = await findRecordByLeadId(input.leadId);
  if (!existing) {
    throw new Error("Payment record not found");
  }

  const updates = parseJsonOr<ClientPaymentUpdate[]>(existing.updates, []);
  const now = new Date().toISOString();
  const nextUpdates: ClientPaymentUpdate[] = [
    {
      id: crypto.randomUUID(),
      status: input.status,
      note: input.note ?? null,
      actorId: actor.$id,
      actorName: actor.name,
      createdAt: now,
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
}): Promise<Array<{ leadId: string; status: PaymentStatus; personalDetails: Record<string, unknown> }>> {
  const actor = await getActor(input.actorId);
  ensureComponentAccess(actor.role, "history");

  const leadIds = Array.isArray(input.leadIds)
    ? Array.from(new Set(input.leadIds.filter((id) => typeof id === "string" && id.trim())))
    : [];
  if (leadIds.length === 0) return [];

  const { databases } = await createAdminClient();
  const leadsResponse = await databases.listDocuments(DATABASE_ID, COLLECTIONS.LEADS, [
    Query.equal("$id", leadIds),
    Query.limit(Math.min(5000, leadIds.length)),
  ]);

  let allowedLeadIds = new Set<string>();

  if (actor.role === "admin") {
    allowedLeadIds = new Set(leadsResponse.documents.map((doc: any) => doc.$id));
  } else if (actor.role === "agent" || actor.role === "lead_generation") {
    for (const lead of leadsResponse.documents as any[]) {
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

    for (const lead of leadsResponse.documents as any[]) {
      const branchId = typeof lead.branchId === "string" ? lead.branchId : null;
      const ownerId = typeof lead.ownerId === "string" ? lead.ownerId : null;
      const assignedToId = typeof lead.assignedToId === "string" ? lead.assignedToId : null;
      if (
        (ownerId ? teamIds.has(ownerId) : false) ||
        (assignedToId ? teamIds.has(assignedToId) : false) ||
        (branchId ? (actor.branchIds ?? []).includes(branchId) : false)
      ) {
        allowedLeadIds.add(lead.$id);
      }
    }
  } else if (actor.role === "manager" || actor.role === "assistant_manager") {
    for (const lead of leadsResponse.documents as any[]) {
      const branchId = typeof lead.branchId === "string" ? lead.branchId : null;
      const ownerId = typeof lead.ownerId === "string" ? lead.ownerId : null;
      const assignedToId = typeof lead.assignedToId === "string" ? lead.assignedToId : null;
      if (
        ownerId === actor.$id ||
        assignedToId === actor.$id ||
        (branchId ? (actor.branchIds ?? []).includes(branchId) : false)
      ) {
        allowedLeadIds.add(lead.$id);
      }
    }
  }

  if (allowedLeadIds.size === 0) return [];

  const paymentsResponse = await databases.listDocuments(DATABASE_ID, COLLECTIONS.CLIENT_PAYMENTS, [
    Query.equal("leadId", Array.from(allowedLeadIds)),
    Query.limit(5000),
  ]);

  const results: Array<{ leadId: string; status: PaymentStatus; personalDetails: Record<string, unknown> }> = [];
  for (const doc of paymentsResponse.documents as any[]) {
    const leadId = typeof doc.leadId === "string" ? doc.leadId : "";
    if (!leadId || !allowedLeadIds.has(leadId)) continue;
    const personalDetails = parseJsonOr<Record<string, unknown>>(doc.personalDetails ?? doc.personalDetailsJson, {});
    const status = (doc.status as PaymentStatus) ?? "not_paid";
    results.push({ leadId, status, personalDetails });
  }
  return results;
}
