"use server";

import { Query, ID } from "node-appwrite";
import { createAdminClient } from "@/lib/server/appwrite";
import { assertAuthenticatedUserId } from "@/lib/server/current-user";
import { COLLECTIONS, DATABASE_ID } from "@/lib/constants/appwrite";
import { createNotificationsForRecipients } from "@/lib/server/notifications";
import { getAppwriteErrorMessage } from "@/lib/server/appwrite-errors";
import { listAllDocuments } from "@/lib/server/appwrite-pagination";
import { sendDuplicateAlertEmail } from "@/lib/server/email-service";

type DuplicateLeadField = "email" | "phone" | "linkedinProfileUrl";

const DUPLICATE_FIELD_LABELS: Record<DuplicateLeadField, string> = {
  email: "email",
  phone: "phone",
  linkedinProfileUrl: "LinkedIn profile URL",
};

/** Returns how many DUPLICATE_ATTEMPT audit logs exist for the given existing lead ID */
async function getDuplicateAttemptCount(
  databases: any,
  existingLeadId: string,
): Promise<number> {
  try {
    const docs = await listAllDocuments<{ $id: string }>(({
      databases,
      databaseId: DATABASE_ID,
      collectionId: COLLECTIONS.AUDIT_LOGS,
      queries: [
        Query.equal("action", "DUPLICATE_ATTEMPT"),
        Query.equal("targetId", existingLeadId),
        Query.orderAsc("$id"),
      ],
      pageLimit: 100,
      maxPages: 50,
    } as any));
    return docs.length;
  } catch {
    return 0;
  }
}

/** Logs a DUPLICATE_ATTEMPT entry to audit_logs */
async function logDuplicateAttempt(
  databases: any,
  actorId: string,
  actorName: string,
  existingLeadId: string,
  context: "create" | "update",
): Promise<void> {
  try {
    await databases.createDocument(
      DATABASE_ID,
      COLLECTIONS.AUDIT_LOGS,
      ID.unique(),
      {
        action: "DUPLICATE_ATTEMPT",
        actorId,
        actorName,
        targetId: existingLeadId,
        targetType: "LEAD",
        metadata: JSON.stringify({ context }),
        performedAt: new Date().toISOString(),
      },
    );
  } catch (err) {
    console.error("[lead-duplicates] Failed to log duplicate attempt:", err);
  }
}

interface AdminAndTLUser {
  $id: string;
  role?: string;
  email?: string;
  name?: string;
}

/** Fetch all admin + team_lead users and return their Appwrite IDs + email addresses */
async function getAdminAndTLUsers(
  databases: any,
): Promise<AdminAndTLUser[]> {
  const users = await listAllDocuments<AdminAndTLUser>(({
    databases,
    databaseId: DATABASE_ID,
    collectionId: COLLECTIONS.USERS,
    queries: [
      Query.or([Query.equal("role", "admin"), Query.equal("role", "team_lead"), Query.equal("role", "developer")]),
      Query.orderAsc("$id"),
    ],
    pageLimit: 100,
    maxPages: 50,
  } as any));
  return users.filter((doc) => doc.role === "admin" || doc.role === "team_lead" || doc.role === "developer");
}

// ─────────────────────────────────────────────────────────────────────────────
// SHARED INTERNAL HANDLER
// ─────────────────────────────────────────────────────────────────────────────

interface DuplicateNotifyInput {
  actorId: string;
  actorName: string;
  actorEmail?: string;
  /** The lead being created / edited (may not exist yet on create — pass empty string) */
  leadId: string;
  /** All duplicate warnings found */
  duplicateWarnings: Array<{
    field: DuplicateLeadField;
    existingLeadId: string;
    existingBranchId?: string;
  }>;
  /** Client data for the email body */
  clientName?: string;
  clientEmail?: string;
  clientPhone?: string;
  clientLinkedinUrl?: string;
  context: "create" | "update";
}

async function handleDuplicateNotifications(
  input: DuplicateNotifyInput,
): Promise<void> {
  const { databases } = await createAdminClient();

  // Fetch all admin + TL users
  const users = await getAdminAndTLUsers(databases);
  const recipientIds = users.map((u) => u.$id).filter(Boolean);
  const recipientEmails = users
    .map((u) => u.email)
    .filter((e): e is string => Boolean(e));

  // Build notification body
  const fieldLabels = input.duplicateWarnings
    .map((w) => DUPLICATE_FIELD_LABELS[w.field])
    .join(", ");
  const existingIds = input.duplicateWarnings
    .map((w) => w.existingLeadId)
    .join(", ");

  const inAppBody =
    `${input.actorName} attempted to ${input.context === "create" ? "create" : "save"} a lead with duplicate ${fieldLabels}.\n\n` +
    `Existing lead(s): ${existingIds}` +
    (input.clientEmail ? `\nClient email: ${input.clientEmail}` : "") +
    (input.clientPhone ? `\nClient phone: ${input.clientPhone}` : "");

  // ── In-app notifications ──
  try {
    await createNotificationsForRecipients(databases, recipientIds, {
      type: "LEAD_DUPLICATE_ATTEMPT",
      title: `Duplicate lead ${input.context === "create" ? "creation" : "update"} blocked`,
      body: inAppBody,
      targetId: input.duplicateWarnings[0]?.existingLeadId ?? input.leadId,
      targetType: "LEAD",
    });
  } catch (err) {
    console.error("[lead-duplicates] Failed to create in-app notifications:", err);
  }

  // ── Log attempt count for each existing lead hit ──
  // We use the first (primary) existingLeadId for the count display
  const primaryExistingLeadId = input.duplicateWarnings[0]?.existingLeadId;
  if (primaryExistingLeadId) {
    await logDuplicateAttempt(
      databases,
      input.actorId,
      input.actorName,
      primaryExistingLeadId,
      input.context,
    );
    // Count is AFTER logging so it reflects the current attempt
    const attemptCount =
      (await getDuplicateAttemptCount(databases, primaryExistingLeadId)) + 0;

    // ── Email via Microsoft Graph ──
    if (input.actorEmail) {
      try {
        await sendDuplicateAlertEmail({
          actorEmail: input.actorEmail,
          actorName: input.actorName,
          leadId: input.leadId,
          clientName: input.clientName,
          clientEmail: input.clientEmail,
          clientPhone: input.clientPhone,
          clientLinkedinUrl: input.clientLinkedinUrl,
          duplicateFields: input.duplicateWarnings.map((w) => ({
            field: w.field,
            existingLeadId: w.existingLeadId,
          })),
          attemptCount,
          recipientEmails,
          context: input.context,
        });
      } catch (err) {
        console.error("[lead-duplicates] Failed to send duplicate alert email:", err);
      }
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC SERVER ACTIONS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Notify admins + TLs when a LEAD UPDATE attempt is blocked due to duplicates.
 * Sends both in-app notification and email (from acting user's mailbox).
 */
export async function notifyDuplicateLeadUpdateAttemptAction(input: {
  actorId: string;
  actorName: string;
  actorEmail?: string;
  leadId: string;
  duplicateField: DuplicateLeadField;
  duplicateValue?: string | null;
  existingLeadId: string;
  clientName?: string;
  clientPhone?: string;
  clientLinkedinUrl?: string;
}) {
  await assertAuthenticatedUserId(input.actorId);

  try {
    await handleDuplicateNotifications({
      actorId: input.actorId,
      actorName: input.actorName,
      actorEmail: input.actorEmail,
      leadId: input.leadId,
      duplicateWarnings: [
        {
          field: input.duplicateField,
          existingLeadId: input.existingLeadId,
        },
      ],
      clientName: input.clientName,
      clientEmail:
        input.duplicateField === "email" && input.duplicateValue
          ? input.duplicateValue
          : undefined,
      clientPhone:
        input.duplicateField === "phone" && input.duplicateValue
          ? input.duplicateValue
          : input.clientPhone,
      clientLinkedinUrl:
        input.duplicateField === "linkedinProfileUrl" && input.duplicateValue
          ? input.duplicateValue
          : input.clientLinkedinUrl,
      context: "update",
    });
  } catch (error) {
    throw new Error(getAppwriteErrorMessage(error));
  }
}

/**
 * Notify admins + TLs when a LEAD CREATE attempt is blocked due to ≥2 duplicate warnings.
 * Sends both in-app notification and email (from acting user's mailbox).
 */
export async function notifyDuplicateLeadCreateAttemptAction(input: {
  actorId: string;
  actorName: string;
  actorEmail?: string;
  /** Pass empty string when the lead has not been created yet */
  leadId: string;
  duplicateWarnings: Array<{
    field: DuplicateLeadField;
    existingLeadId: string;
    existingBranchId?: string;
  }>;
  clientName?: string;
  clientEmail?: string;
  clientPhone?: string;
  clientLinkedinUrl?: string;
}) {
  await assertAuthenticatedUserId(input.actorId);

  try {
    await handleDuplicateNotifications({
      actorId: input.actorId,
      actorName: input.actorName,
      actorEmail: input.actorEmail,
      leadId: input.leadId,
      duplicateWarnings: input.duplicateWarnings,
      clientName: input.clientName,
      clientEmail: input.clientEmail,
      clientPhone: input.clientPhone,
      clientLinkedinUrl: input.clientLinkedinUrl,
      context: "create",
    });
  } catch (error) {
    throw new Error(getAppwriteErrorMessage(error));
  }
}

/** @deprecated Use notifyDuplicateLeadUpdateAttemptAction instead */
export async function notifyDuplicateLinkedinUrlUpdateAttemptAction(input: {
  actorId: string;
  actorName: string;
  leadId: string;
  linkedinProfileUrl: string;
  existingLeadId: string;
}) {
  return notifyDuplicateLeadUpdateAttemptAction({
    actorId: input.actorId,
    actorName: input.actorName,
    leadId: input.leadId,
    duplicateField: "linkedinProfileUrl",
    duplicateValue: input.linkedinProfileUrl,
    existingLeadId: input.existingLeadId,
  });
}
