import { NextResponse, type NextRequest } from "next/server";
import { Query } from "node-appwrite";
import { createAdminClient } from "@/lib/server/appwrite";
import { COLLECTIONS, DATABASE_ID } from "@/lib/constants/appwrite";
import { createNotificationsForRecipients } from "@/lib/server/notifications";
import type { LeadData, PaymentStatus } from "@/lib/types";

function getAuthorizationToken(request: NextRequest) {
  const header = request.headers.get("authorization");
  if (!header) return null;
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || null;
}

function isAuthorized(request: NextRequest) {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  const provided = getAuthorizationToken(request) ?? request.headers.get("x-cron-secret");
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
  return combined || (typeof data.legalName === "string" ? data.legalName : "") || "Client";
}

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const days = Number(process.env.PAYMENT_REMINDER_STALE_DAYS ?? "5");
  const staleMs = days * 24 * 60 * 60 * 1000;
  const now = new Date();
  const thresholdIso = new Date(now.getTime() - staleMs).toISOString();

  const { databases } = await createAdminClient();

  const admins = await databases.listDocuments(DATABASE_ID, COLLECTIONS.USERS, [
    Query.equal("role", "admin"),
    Query.limit(5000),
  ]);
  const adminIds = admins.documents.map((doc: any) => doc.$id as string);

  const paymentDocs = await databases.listDocuments(DATABASE_ID, COLLECTIONS.CLIENT_PAYMENTS, [
    Query.lessThanEqual("createdAt", thresholdIso),
    Query.limit(5000),
  ]);

  let evaluated = 0;
  let remindersSent = 0;

  for (const paymentDoc of paymentDocs.documents as any[]) {
    evaluated += 1;

    const status = (paymentDoc.status as PaymentStatus) ?? "not_paid";
    if (status === "fully_paid") continue;

    const lastActivityAtRaw = paymentDoc.updatedAt ?? paymentDoc.createdAt;
    const lastActivityAt = typeof lastActivityAtRaw === "string" ? lastActivityAtRaw : paymentDoc.createdAt;
    if (typeof lastActivityAt !== "string") continue;
    if (lastActivityAt > thresholdIso) continue;

    const lastReminderAt = typeof paymentDoc.lastReminderAt === "string" ? paymentDoc.lastReminderAt : null;
    if (lastReminderAt && lastReminderAt >= lastActivityAt) continue;

    const leadId = paymentDoc.leadId as string | undefined;
    if (!leadId) continue;

    let lead: any = null;
    try {
      lead = await databases.getDocument(DATABASE_ID, COLLECTIONS.LEADS, leadId);
    } catch {
      continue;
    }

    if (!lead?.isClosed) continue;

    const assignedToId = typeof lead.assignedToId === "string" ? lead.assignedToId : null;
    const ownerId = typeof lead.ownerId === "string" ? lead.ownerId : null;
    const agentId = assignedToId ?? ownerId;
    if (!agentId) continue;

    let agentDoc: any = null;
    try {
      agentDoc = await databases.getDocument(DATABASE_ID, COLLECTIONS.USERS, agentId);
    } catch {
      agentDoc = null;
    }

    const teamLeadId = agentDoc && typeof agentDoc.teamLeadId === "string" ? agentDoc.teamLeadId : null;
    const leadData = safeParseLeadData(lead.data);
    const leadName = formatLeadName(leadData);

    const title = "Payment update needed";
    const body = `${leadName} is closed but not fully paid. No payment update in ${days} days. Please add an update.`;

    await createNotificationsForRecipients(
      databases,
      [agentId, teamLeadId, ...adminIds],
      {
        type: "CLIENT_PAYMENT_STALE",
        title,
        body,
        targetId: leadId,
        targetType: "LEAD",
      }
    );

    await databases.updateDocument(DATABASE_ID, COLLECTIONS.CLIENT_PAYMENTS, paymentDoc.$id, {
      lastReminderAt: now.toISOString(),
    });

    remindersSent += 1;
  }

  return NextResponse.json({
    ok: true,
    thresholdIso,
    evaluated,
    remindersSent,
  });
}
