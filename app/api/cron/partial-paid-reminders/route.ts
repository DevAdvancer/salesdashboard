import { NextResponse, type NextRequest } from "next/server";
import { Query } from "node-appwrite";
import { createAdminClient } from "@/lib/server/appwrite";
import { COLLECTIONS, DATABASE_ID } from "@/lib/constants/appwrite";
import { getRequestCount, withRequestMeter } from "@/lib/server/appwrite-request-meter";
import { createNotificationsForRecipients } from "@/lib/server/notifications";
import { listAllDocuments } from "@/lib/server/appwrite-pagination";
import { listHolidayDateKeys } from "@/lib/server/holiday-calendar";
import { getTodayEst } from "@/lib/utils/est-date";
import { isWorkingDateKey } from "@/lib/utils/holiday-calendar";
import {
  loadNotificationCountsSince,
  notificationDedupKey,
} from "@/lib/server/notification-dedup";
import type { ClientPaymentRecord, LeadData, User } from "@/lib/types";

export const dynamic = "force-dynamic";

const NOTIFICATION_TYPE = "CLIENT_PAYMENT_PARTIAL_PAID_STALE";
const DAY_MS = 24 * 60 * 60 * 1000;
// Appwrite caps a single Query.equal id list at 100 values.
const ID_CHUNK_SIZE = 100;

type AdminDatabases = Awaited<ReturnType<typeof createAdminClient>>["databases"];

interface LeadReminderDoc {
  $id?: unknown;
  isClosed?: unknown;
  assignedToId?: unknown;
  ownerId?: unknown;
  data?: unknown;
}

interface AgentReminderDoc {
  $id?: unknown;
  teamLeadId?: unknown;
}

interface PendingRow {
  paymentDoc: ClientPaymentRecord;
  leadId: string;
  lastUpdateAt: string;
}

interface ReadyRow extends PendingRow {
  lead: LeadReminderDoc;
  agentId: string;
}

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

/**
 * Fetch documents by id in batches of 100 instead of one getDocument per row.
 * A missing entry in the returned map means the same thing the old per-row
 * getDocument catch meant: the document is gone or unreadable.
 */
async function loadDocumentsByIds<T>(
  databases: AdminDatabases,
  collectionId: string,
  ids: string[],
  select: string[],
) {
  const byId = new Map<string, T>();
  const uniqueIds = Array.from(new Set(ids.filter(Boolean)));

  for (let index = 0; index < uniqueIds.length; index += ID_CHUNK_SIZE) {
    const chunk = uniqueIds.slice(index, index + ID_CHUNK_SIZE);
    const documents = await listAllDocuments<Record<string, unknown>>({
      databases,
      databaseId: DATABASE_ID,
      collectionId,
      queries: [Query.equal("$id", chunk), Query.select(select)],
      pageLimit: ID_CHUNK_SIZE,
      maxPages: 5,
    });

    for (const doc of documents) {
      const id = typeof doc.$id === "string" ? doc.$id : null;
      if (id) byId.set(id, doc as T);
    }
  }

  return byId;
}

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { databases } = await createAdminClient();
  const todayKey = getTodayEst();
  const holidays = await listHolidayDateKeys({ databases, from: todayKey, to: todayKey });
  if (!isWorkingDateKey(todayKey, holidays)) {
    return NextResponse.json({ ok: true, skipped: true, reason: "Not a working day" });
  }

  // The scope has to be opened here. getRequestCount() reads the active
  // AsyncLocalStorage store, so without this wrapper the appwriteRequests field
  // in the response below reports 0 on every run.
  const { result } = await withRequestMeter(() => runPartialPaidSweep(databases));
  return result;
}

async function runPartialPaidSweep(databases: AdminDatabases) {
  const days = Number(
    process.env.PARTIAL_PAID_STALE_DAYS ?? "2",
  );
  const staleMs = days * DAY_MS;
  const now = new Date();
  const nowIso = now.toISOString();
  const thresholdIso = new Date(now.getTime() - staleMs).toISOString();
  const todayStartIso = getTodayStartIso(now);

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

  // Pass 1: apply the row filters that need no extra read, and collect the lead
  // ids so the lead documents can be fetched in batches.
  const pendingRows: PendingRow[] = [];
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

    pendingRows.push({ paymentDoc, leadId, lastUpdateAt });
  }

  const leadsById = await loadDocumentsByIds<LeadReminderDoc>(
    databases,
    COLLECTIONS.LEADS,
    pendingRows.map((row) => row.leadId),
    ["$id", "isClosed", "assignedToId", "ownerId", "data"],
  );

  // Pass 2: resolve each row against the lead map so the agent ids can also be
  // fetched in batches rather than one getDocument per row.
  const readyRows: ReadyRow[] = [];
  for (const row of pendingRows) {
    const lead = leadsById.get(row.leadId);
    if (!lead) continue;

    if (lead.isClosed) {
      // Closed-and-partial-paid is already covered by the existing
      // payment-reminders cron. This job targets OPEN partial-paid leads only.
      skippedClosed += 1;
      continue;
    }

    const assignedToId =
      typeof lead.assignedToId === "string" ? lead.assignedToId : null;
    const ownerId = typeof lead.ownerId === "string" ? lead.ownerId : null;
    const agentId = assignedToId ?? ownerId;
    if (!agentId) continue;

    readyRows.push({ ...row, lead, agentId });
  }

  const agentsById = await loadDocumentsByIds<AgentReminderDoc>(
    databases,
    COLLECTIONS.USERS,
    readyRows.map((row) => row.agentId),
    ["$id", "teamLeadId"],
  );

  // One scan of today's notifications replaces the per-recipient per-row
  // "already notified?" query. The map is kept live during the send loop so the
  // once-per-day rule still holds for repeated leads within this run.
  const notificationCounts =
    readyRows.length > 0
      ? await loadNotificationCountsSince({
          databases,
          types: [NOTIFICATION_TYPE],
          sinceIso: todayStartIso,
        })
      : new Map<string, number>();

  for (const { paymentDoc, leadId, lastUpdateAt, lead, agentId } of readyRows) {
    const agentDoc = agentsById.get(agentId) ?? null;
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
    // for this lead today. Answered from the preloaded map, no query per row.
    const dedupedRecipients: string[] = [];
    let suppressedForAnyone = false;
    for (const recipientId of recipients) {
      const key = notificationDedupKey(recipientId, NOTIFICATION_TYPE, leadId);
      const alreadySent = (notificationCounts.get(key) ?? 0) > 0;
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

    // Record the sends in memory so a second payment row for the same lead is
    // suppressed exactly as it was when the check hit the database each time.
    for (const recipientId of dedupedRecipients) {
      const key = notificationDedupKey(recipientId, NOTIFICATION_TYPE, leadId);
      notificationCounts.set(key, (notificationCounts.get(key) ?? 0) + 1);
    }

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
    // Counted only when the caller opened a meter scope; 0 otherwise.
    appwriteRequests: getRequestCount(),
  });
}
