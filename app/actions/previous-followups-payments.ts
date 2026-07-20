"use server";

import { ID, Query } from "node-appwrite";
import { readFile } from "node:fs/promises";
import { createAdminClient } from "@/lib/server/appwrite";
import { assertAuthenticatedUserId } from "@/lib/server/current-user";
import { COLLECTIONS, DATABASE_ID } from "@/lib/constants/appwrite";
import { isRoleEligibleForComponent } from "@/lib/constants/component-access";
import { listAllDocuments } from "@/lib/server/appwrite-pagination";
import { getAppwriteErrorMessage } from "@/lib/server/appwrite-errors";
import {
  FOLLOWUPS_PAYMENT_COMPANIES,
  type FollowupsPaymentCompany,
  type PreviousFollowupsPayment,
  type FollowupsPaymentStatus,
  type User,
} from "@/lib/types";

const MANUAL_FOLLOWUP_LEAD_ID_PREFIX = "manual_followup:";
const FOLLOWUPS_PAYMENT_STATUS: FollowupsPaymentStatus = "paid";
const FOLLOWUPS_LEGACY_REMARK_KEY = "remark";

async function reportFollowupDebug(
  runId: string,
  hypothesisId: string,
  location: string,
  msg: string,
  data: Record<string, unknown>,
) {
  let url = "http://127.0.0.1:7777/event";
  let sessionId = "followup-edit-error";

  try {
    const env = await readFile(".dbg/followup-edit-error.env", "utf8");
    url =
      env.match(/DEBUG_SERVER_URL=(.+)/)?.[1]?.trim() ??
      url;
    sessionId =
      env.match(/DEBUG_SESSION_ID=(.+)/)?.[1]?.trim() ??
      sessionId;
  } catch {}

  try {
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId,
        runId,
        hypothesisId,
        location,
        msg,
        data,
        ts: Date.now(),
      }),
    });
  } catch {}
}

function isUnknownAttributeError(message: string, attribute: string): boolean {
  return message.includes("Unknown attribute") && message.includes(`"${attribute}"`);
}

function buildFollowupRepairPayload(doc: Record<string, unknown>): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    leadId: typeof doc.leadId === "string" ? doc.leadId : makeManualLeadId(),
    company:
      typeof doc.company === "string"
        ? normalizeCompany(doc.company)
        : FOLLOWUPS_PAYMENT_COMPANIES[0],
    candidateName:
      typeof doc.candidateName === "string" ? doc.candidateName : "",
    amount: Math.floor(Number(doc.amount) || 0),
    date: typeof doc.date === "string" ? doc.date : "",
    status:
      typeof doc.status === "string" && doc.status.trim()
        ? doc.status
        : FOLLOWUPS_PAYMENT_STATUS,
    createdAt:
      typeof doc.createdAt === "string" && doc.createdAt.trim()
        ? doc.createdAt
        : new Date().toISOString(),
  };

  const paymentRemark =
    typeof doc.paymentRemark === "string"
      ? doc.paymentRemark
      : typeof doc.remark === "string"
        ? doc.remark
        : "";

  if (paymentRemark.trim()) {
    payload.paymentRemark = paymentRemark.trim();
  }
  if (typeof doc.updatedAt === "string" && doc.updatedAt.trim()) {
    payload.updatedAt = doc.updatedAt;
  }
  if (typeof doc.updatedById === "string" && doc.updatedById.trim()) {
    payload.updatedById = doc.updatedById;
  }
  if (typeof doc.updatedByName === "string" && doc.updatedByName.trim()) {
    payload.updatedByName = doc.updatedByName;
  }

  return payload;
}

async function replaceLegacyFollowupDocument(
  databases: Awaited<ReturnType<typeof createAdminClient>>["databases"],
  paymentId: string,
  overrides: Record<string, unknown>,
) {
  const existing = await databases.getDocument(
    DATABASE_ID,
    COLLECTIONS.PREVIOUS_FOLLOWUPS_PAYMENTS,
    paymentId,
  );
  const repairedPayload = buildFollowupRepairPayload(
    existing as unknown as Record<string, unknown>,
  );
  const replacementPayload: Record<string, unknown> = {
    ...repairedPayload,
    ...overrides,
  };

  await databases.deleteDocument(
    DATABASE_ID,
    COLLECTIONS.PREVIOUS_FOLLOWUPS_PAYMENTS,
    paymentId,
  );
  return databases.createDocument(
    DATABASE_ID,
    COLLECTIONS.PREVIOUS_FOLLOWUPS_PAYMENTS,
    paymentId,
    replacementPayload,
  );
}

async function updateFollowupsDocumentWithFallback(
  databases: Awaited<ReturnType<typeof createAdminClient>>["databases"],
  paymentId: string,
  payload: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const nextPayload: Record<string, unknown> = { ...payload };
  let repairedLegacyRemarkDoc = false;

  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      // #region debug-point A:update-attempt
      await reportFollowupDebug(
        "pre-fix",
        "A",
        "app/actions/previous-followups-payments.ts:updateFollowupsDocumentWithFallback",
        "[DEBUG] followup update attempt",
        {
          paymentId,
          attempt,
          payloadKeys: Object.keys(nextPayload),
          date: nextPayload.date ?? null,
          hasPaymentRemark: Object.prototype.hasOwnProperty.call(nextPayload, "paymentRemark"),
          hasLegacyRemark: Object.prototype.hasOwnProperty.call(nextPayload, FOLLOWUPS_LEGACY_REMARK_KEY),
        },
      );
      // #endregion
      return await databases.updateDocument(
        DATABASE_ID,
        COLLECTIONS.PREVIOUS_FOLLOWUPS_PAYMENTS,
        paymentId,
        nextPayload,
      );
    } catch (error) {
      const message = getAppwriteErrorMessage(error);
      let changed = false;

      // #region debug-point B:update-error
      await reportFollowupDebug(
        "pre-fix",
        "B",
        "app/actions/previous-followups-payments.ts:updateFollowupsDocumentWithFallback",
        "[DEBUG] followup update error",
        {
          paymentId,
          attempt,
          message,
          payloadKeys: Object.keys(nextPayload),
        },
      );
      // #endregion

      if (isUnknownAttributeError(message, "paymentRemark")) {
        const remarkValue = nextPayload.paymentRemark;
        delete nextPayload.paymentRemark;
        if (remarkValue !== undefined) {
          nextPayload[FOLLOWUPS_LEGACY_REMARK_KEY] = remarkValue;
        }
        changed = true;
      }

      if (isUnknownAttributeError(message, FOLLOWUPS_LEGACY_REMARK_KEY)) {
        if (!repairedLegacyRemarkDoc) {
          // #region debug-point E:repair-legacy-doc
          await reportFollowupDebug(
            "pre-fix",
            "E",
            "app/actions/previous-followups-payments.ts:updateFollowupsDocumentWithFallback",
            "[DEBUG] repairing legacy followup document",
            {
              paymentId,
              attempt,
            },
          );
          // #endregion
          repairedLegacyRemarkDoc = true;
          return replaceLegacyFollowupDocument(databases, paymentId, nextPayload);
        }
        delete nextPayload[FOLLOWUPS_LEGACY_REMARK_KEY];
        changed = true;
      }

      for (const attribute of ["updatedAt", "updatedById", "updatedByName"]) {
        if (isUnknownAttributeError(message, attribute)) {
          delete nextPayload[attribute];
          changed = true;
        }
      }

      if (!changed) {
        throw new Error(message);
      }
    }
  }

  throw new Error("Failed to update followup payment");
}

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
    createdById: doc.createdById ?? null,
    createdByName: doc.createdByName ?? null,
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
    createdById: actor.$id,
    createdByName: actor.name,
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
  leadId?: string | null;
  company?: FollowupsPaymentCompany | null;
  candidateName?: string | null;
  amount?: number | null;
  date?: string | null;
  remark?: string | null;
}): Promise<PreviousFollowupsPayment> {
  // #region debug-point C:action-entry
  await reportFollowupDebug(
    "pre-fix",
    "C",
    "app/actions/previous-followups-payments.ts:updatePreviousFollowupsPaymentAction",
    "[DEBUG] followup action entry",
    {
      paymentId: input.paymentId,
      actorId: input.actorId,
      company: input.company ?? null,
      candidateName: input.candidateName ?? null,
      amount: input.amount ?? null,
      date: input.date ?? null,
      remarkLength:
        typeof input.remark === "string" ? input.remark.length : null,
    },
  );
  // #endregion
  const actor = await getActor(input.actorId);
  ensureComponentAccess(actor.role, "followups-payments");
  assertCanMutateFollowups(actor);

  const { databases } = await createAdminClient();

  await databases.getDocument(DATABASE_ID, COLLECTIONS.PREVIOUS_FOLLOWUPS_PAYMENTS, input.paymentId);

  const payload: Record<string, unknown> = {
    updatedAt: new Date().toISOString(),
    updatedById: actor.$id,
    updatedByName: actor.name,
  };

  if (input.leadId !== undefined) payload.leadId = input.leadId?.trim() || makeManualLeadId();
  if (input.company !== undefined && input.company !== null) payload.company = normalizeCompany(input.company);
  if (input.candidateName !== undefined) payload.candidateName = (input.candidateName || '').trim();
  if (input.amount !== undefined) payload.amount = Math.floor(Number(input.amount) || 0);
  if (input.date !== undefined) payload.date = input.date;
  if (input.remark !== undefined) payload.paymentRemark = input.remark?.trim() || "";
  payload.status = FOLLOWUPS_PAYMENT_STATUS;

  const doc = await updateFollowupsDocumentWithFallback(
    databases,
    input.paymentId,
    payload,
  );

  // #region debug-point D:action-success
  await reportFollowupDebug(
    "pre-fix",
    "D",
    "app/actions/previous-followups-payments.ts:updatePreviousFollowupsPaymentAction",
    "[DEBUG] followup action success",
    {
      paymentId: input.paymentId,
      docId: doc.$id ?? null,
      returnedDate: doc.date ?? null,
      returnedRemark: doc.paymentRemark ?? doc.remark ?? null,
    },
  );
  // #endregion

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

  if (actor.role === "agent" || actor.role === "lead_generation") {
    queries.push(Query.equal("createdById", actor.$id));
  } else if (actor.role === "team_lead") {
    const { getAgentsByTeamLead } = await import("@/lib/services/user-service");
    const agents = await getAgentsByTeamLead(actor.$id, "sales");
    const teamIds = [actor.$id, ...agents.map((a) => a.$id)];
    queries.push(Query.equal("createdById", teamIds));
  }

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
