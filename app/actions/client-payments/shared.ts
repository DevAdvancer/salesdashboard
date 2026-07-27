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

export async function getActor(userId: string): Promise<User> {
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

export function ensureComponentAccess(role: string, componentKey: Parameters<typeof isRoleEligibleForComponent>[0]) {
    if (!isRoleEligibleForComponent(componentKey, role as any)) {
    throw new Error("Not authorized");
    }
}

export function isAdminLikeReadRole(role: User["role"]) {
    return role === "admin" || role === "developer" || role === "monitor" || role === "operations";
}

export function assertCanMutateClientPayments(actor: User) {
    if (actor.role === "operations") {
    throw new Error("Not authorized");
    }
}

export function parseJsonOr<T>(value: unknown, fallback: T): T {
    if (typeof value !== "string") return fallback;
    try {
    return JSON.parse(value) as T;
    } catch {
    return fallback;
    }
}

export async function canActorAccessLead(actor: User, leadId: string): Promise<boolean> {
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

export function mapRecord(doc: any): ClientPaymentRecord {
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

export async function findRecordByLeadId(leadId: string) {
    const { databases } = await createAdminClient();
    const response = await databases.listDocuments(DATABASE_ID, COLLECTIONS.CLIENT_PAYMENTS, [
            Query.equal("leadId", leadId),
            Query.limit(1),
          ]);
    return response.documents[0] ?? null;
}

export function mapLeadDocumentToLead(doc: any): Lead {
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

export function buildSyntheticLead(leadId: string, personalDetails: Record<string, unknown>, createdAt: string): Lead {
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

export function toComparableIsoDate(value: string | null | undefined): string | null {
    if (typeof value !== "string") return null;
    const trimmed = value.trim();
    if (!trimmed) return null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
    const parsed = new Date(trimmed);
    if (Number.isNaN(parsed.getTime())) return null;
    return parsed.toISOString().slice(0, 10);
}

export interface PaymentInsightRecord {
    leadId: string;
    company: string;
    source: string;
    leadStatus: string;
    /** Synthetic records created from standalone followup payments only. */
    isFollowupOnly?: boolean;
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
    /** Sum of all pending amounts across months for this lead. Null when no pending row exists. */
    pendingTotal: number | null;
    /** Most recent month-key (YYYY-MM) that has a pending row for this lead, or null. */
    latestPendingMonth: string | null;
    /**
     * Bucketed actual paid amounts by payment-update month (YYYY-MM → total).
     * Used by the monthly payments report to attribute revenue to the correct
     * calendar month rather than the lead's close date.
     */
    paidMonthlyAmounts: Record<string, number>;
    /** Bucketed followup payments by the payment entry date month (YYYY-MM → total). */
    followupsMonthlyAmounts: Record<string, number>;
    /** Full contract amount from the lead form (leadAmount / totalAmount / amount). */
    leadAmount: number;
    /** Followup payments total for this lead from previous_followups_payments */
    followupsTotal: number;
    /** Number of followup payment entries for this lead */
    followupsCount: number;
    /** Individual followups payment entries with candidate name and date */
    followupsPayments: Array<{
        company: string;
        candidateName: string;
        amount: number;
        date: string;
        remark: string | null;
        status: string;
        }>;
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
