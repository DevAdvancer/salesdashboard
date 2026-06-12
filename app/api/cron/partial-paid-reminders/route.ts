import { NextResponse, type NextRequest } from "next/server";
import { Query } from "node-appwrite";
import { createAdminClient } from "@/lib/server/appwrite";
import { COLLECTIONS, DATABASE_ID } from "@/lib/constants/appwrite";
import { createNotificationsForRecipients } from "@/lib/server/notifications";
import type { ClientPaymentRecord, LeadData, User } from "@/lib/types";

export const dynamic = "force-dynamic";

const NOTIFICATION_TYPE = "CLIENT_PAYMENT_PARTIAL_PAID_STALE";
const DAY_MS = 24 * 60 * 60 * 1000;

function getAuthorizationToken(request: NextRequest) {
  const header = request.headers.get("authorization");
  if (!header) return null;
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || null;
}

function isAuthorized(request: NextRequest) {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  const provided =
    getAuthorizationToken(request) ?? request.headers.get("x-cron-secret");
  return Boolean(provided) && provided === expected;
}

function safeParseLeadData(raw: unknown): LeadData {
  if (typeof raw !== "string") return {};
  try {
    return JSON.parse(raw) as LeadData;
  } catch {
    return {};
  }
}

function formatLeadName(data: LeadData) {
  const first = typeof data.firstName === "string" ? data.firstName : "";
  const last = typeof data.lastName === "string" ? data.lastName : "";
  const combined = `${first} ${last}`.trim();
  return (
    combined ||
    (typeof data.legalName === "string" ? data.legalName : "") ||
    "Client"
  );
}

function getTodayStartIso(now: Date) {
  return new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
      0,
      0,
      0,
      0,
    ),
  ).toISOString();
}

async function getAdminAndOpsRecipientIds(
  databases: Awaited<ReturnType<typeof createAdminClient>>["databases"],
) {
  const response = await databases.listDocuments(DATABASE_ID, COLLECTIONS.USERS, [
    Query.equal("role", ["admin", "operations"]),
    Query.limit(5000),
  ]);

  return (response.documents as unknown as User[])
    .filter(
      (user) => (user as unknown as { isActive?: unknown }).isActive !== false,
    )
    .map((user) => user.$id);
}

async function hasNotificationToday(
  databases: Awaited<ReturnType<typeof createAdminClient>>["databases"],
  recipientId: string,
  leadId: string,
  todayStartIso: string,
) {
  const response = await databases.listDocuments(
    DATABASE_ID,
    COLLECTIONS.NOTIFICATIONS,
    [
      Query.equal("recipientId", recipientId),
      Query.equal("type", NOTIFICATION_TYPE),
      Query.equal("targetId", leadId),
      Query.greaterThanEqual("createdAt", todayStartIso),
      Query.limit(1),
    ],
  );

  return (response.total ?? response.documents.length) > 0;
}

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const days = Number(
    process.env.PARTIAL_PAID_STALE_DAYS ?? "2",
  );
  const staleMs = days * DAY_MS;
  const now = new Date();
  const nowIso = now.toISOString();
  const thresholdIso = new Date(now.getTime() - staleMs).toISOString();
  const todayStartIso = getTodayStartIso(now);

  const { databases } = await createAdminClient();
  const adminAndOpsIds = await getAdminAndOpsRecipientIds(databases);

  const response = await databases.listDocuments(
    DATABASE_ID,
    COLLECTIONS.CLIENT_PAYMENTS,
    [
      Query.equal("status", "partially_paid"),
      Query.lessThanEqual("updatedAt", thresholdIso),
      Query.limit(5000),
    ],
  );

  let evaluated = 0;
  let skippedClosed = 0;
  let skippedDailyCap = 0;
  let remindersSent = 0;

  for (const paymentDoc of response.documents as unknown as ClientPaymentRecord[]) {
    evaluated += 1;

    const lastUpdateAt =
      typeof paymentDoc.updatedAt === "string"
        ? paymentDoc.updatedAt
        : paymentDoc.createdAt;
    if (!lastUpdateAt) continue;
    if (lastUpdateAt > thresholdIso) continue;

    const leadId = paymentDoc.leadId;
    if (!leadId) continue;

    let lead: Awaited<ReturnType<typeof databases.getDocument>> | null = null;
    try {
      lead = await databases.getDocument(DATABASE_ID, COLLECTIONS.LEADS, leadId);
    } catch {
      continue;
    }

    if (lead?.isClosed) {
      // Closed-and-partial-paid is already covered by the existing
      // payment-reminders cron. This job targets OPEN partial-paid leads only.
      skippedClosed += 1;
      continue;
    }

    const assignedToId =
      typeof lead?.assignedToId === "string" ? lead.assignedToId : null;
    const ownerId = typeof lead?.ownerId === "string" ? lead.ownerId : null;
    const agentId = assignedToId ?? ownerId;
    if (!agentId) continue;

    let agentDoc: Awaited<ReturnType<typeof databases.getDocument>> | null = null;
    try {
      agentDoc = await databases.getDocument(
        DATABASE_ID,
        COLLECTIONS.USERS,
        agentId,
      );
    } catch {
      agentDoc = null;
    }

    const teamLeadId =
      agentDoc && typeof agentDoc.teamLeadId === "string"
        ? agentDoc.teamLeadId
        : null;

    const leadData = safeParseLeadData(lead.data);
    const leadName = formatLeadName(leadData);

    const daysSinceUpdate = Math.max(
      1,
      Math.floor((now.getTime() - new Date(lastUpdateAt).getTime()) / DAY_MS),
    );

    const title = "Partial paid lead needs an update";
    const body = `${leadName} is partially paid with no update in ${daysSinceUpdate} day${daysSinceUpdate === 1 ? "" : "s"}. Please add an update with the current payment status.`;

    const recipients = [agentId, teamLeadId, ...adminAndOpsIds].filter(
      (id): id is string => Boolean(id),
    );

    // Per-day dedup: skip any recipient who already received this notification
    // for this lead today. Process sequentially to keep query count bounded.
    const dedupedRecipients: string[] = [];
    let suppressedForAnyone = false;
    for (const recipientId of recipients) {
      const alreadySent = await hasNotificationToday(
        databases,
        recipientId,
        leadId,
        todayStartIso,
      );
      if (alreadySent) {
        suppressedForAnyone = true;
        continue;
      }
      dedupedRecipients.push(recipientId);
    }

    if (dedupedRecipients.length === 0) {
      skippedDailyCap += 1;
      continue;
    }

    await createNotificationsForRecipients(
      databases,
      dedupedRecipients,
      {
        type: NOTIFICATION_TYPE,
        title,
        body,
        targetId: leadId,
        targetType: "LEAD",
      },
    );

    // Refresh the throttle marker so a future run on the same stale window
    // (before any payment update) doesn't re-evaluate the lead.
    try {
      await databases.updateDocument(
        DATABASE_ID,
        COLLECTIONS.CLIENT_PAYMENTS,
        paymentDoc.$id,
        { lastReminderAt: nowIso },
      );
    } catch (error) {
      console.error(
        `Failed to update lastReminderAt for client_payment ${paymentDoc.$id}:`,
        error,
      );
    }

    remindersSent += 1;
    // Surface in logs whether we also suppressed some recipients on the same lead.
    if (suppressedForAnyone) {
      console.log(
        `Partial-paid reminder for lead ${leadId} sent to ${dedupedRecipients.length} of ${recipients.length} recipients (others already notified today).`,
      );
    }
  }

  return NextResponse.json({
    ok: true,
    thresholdIso,
    todayStartIso,
    days,
    evaluated,
    skippedClosed,
    skippedDailyCap,
    remindersSent,
  });
}
