import { NextResponse, type NextRequest } from "next/server";
import { Query } from "node-appwrite";
import { createAdminClient } from "@/lib/server/appwrite";
import { COLLECTIONS, DATABASE_ID } from "@/lib/constants/appwrite";
import { listHolidayDateKeys } from "@/lib/server/holiday-calendar";
import { getTodayEst } from "@/lib/utils/est-date";
import { isWorkingDateKey } from "@/lib/utils/holiday-calendar";
import { sendNotificationEmail } from "@/lib/server/email-service";
import { listAllDocuments } from "@/lib/server/appwrite-pagination";

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

const currencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

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

  // 1. Fetch Admins
  const admins = await databases.listDocuments(DATABASE_ID, COLLECTIONS.USERS, [
    Query.equal("role", "admin"),
    Query.limit(500),
  ]);
  const adminEmails = admins.documents.map((doc: any) => doc.email).filter(Boolean);
  
  if (adminEmails.length === 0) {
    return NextResponse.json({ ok: false, reason: "No admin emails found" });
  }
  
  const startIso = `${todayKey}T00:00:00.000Z`;
  const endIso = `${todayKey}T23:59:59.999Z`;

  // 2. Fetch leads generated today
  const createdLeads = await listAllDocuments<any>({
    databases,
    databaseId: DATABASE_ID,
    collectionId: COLLECTIONS.LEADS,
    queries: [
      Query.greaterThanEqual("$createdAt", startIso),
      Query.lessThanEqual("$createdAt", endIso),
    ],
    pageLimit: 100,
    maxPages: 500,
  });

  // 3. Fetch leads closed today
  const closedLeads = await listAllDocuments<any>({
    databases,
    databaseId: DATABASE_ID,
    collectionId: COLLECTIONS.LEADS,
    queries: [
      Query.equal("isClosed", true),
      Query.greaterThanEqual("$updatedAt", startIso),
    ],
    pageLimit: 100,
    maxPages: 500,
  });
  
  const validClosed = closedLeads.filter((l: any) => {
    const c = l.closedAt ?? l.$updatedAt;
    return c >= startIso && c <= endIso;
  });

  // Follow-ups today
  const followupQueries = [
    Query.greaterThanEqual("date", todayKey),
    Query.lessThanEqual("date", todayKey)
  ];
  const followupsDocs = await listAllDocuments<any>({
    databases,
    databaseId: DATABASE_ID,
    collectionId: COLLECTIONS.PREVIOUS_FOLLOWUPS_PAYMENTS,
    queries: followupQueries,
    pageLimit: 100,
    maxPages: 500,
  });

  // Users mapping
  const allUserIds = new Set<string>();
  createdLeads.forEach((l: any) => {
    if (l.ownerId) allUserIds.add(l.ownerId);
    if (l.assignedToId) allUserIds.add(l.assignedToId);
    try {
      const data = JSON.parse(l.data || "{}");
      if (data.creatorId) allUserIds.add(data.creatorId);
    } catch {}
  });
  validClosed.forEach((l: any) => {
    if (l.ownerId) allUserIds.add(l.ownerId);
    if (l.assignedToId) allUserIds.add(l.assignedToId);
  });
  
  // Need leads for followups to find agent ID
  const followupLeadIds = Array.from(new Set(followupsDocs.map((f: any) => f.leadId).filter(Boolean)));
  let followupLeads: any[] = [];
  for (let i = 0; i < followupLeadIds.length; i += 100) {
    const chunk = followupLeadIds.slice(i, i + 100);
    const docs = await listAllDocuments<any>({
      databases, databaseId: DATABASE_ID, collectionId: COLLECTIONS.LEADS,
      queries: [Query.equal("$id", chunk)]
    });
    followupLeads.push(...docs);
  }
  const followupLeadActorMap = new Map<string, string>();
  followupLeads.forEach((l: any) => {
    const actorId = l.assignedToId || l.ownerId;
    if (actorId) {
      followupLeadActorMap.set(l.$id, actorId);
      allUserIds.add(actorId);
    }
  });

  const usersMap = new Map<string, string>();
  if (allUserIds.size > 0) {
    const ids = Array.from(allUserIds);
    for (let i = 0; i < ids.length; i += 100) {
      const chunk = ids.slice(i, i + 100);
      const docs = await databases.listDocuments(DATABASE_ID, COLLECTIONS.USERS, [
        Query.equal("$id", chunk),
      ]);
      docs.documents.forEach((d: any) => usersMap.set(d.$id, d.name));
    }
  }

  // Leads Generated Map
  const generatedMap = new Map<string, number>();
  createdLeads.forEach((l: any) => {
    let data: any = {};
    try { data = JSON.parse(l.data || "{}"); } catch {}
    const creatorId = data.creatorId || l.ownerId;
    if (creatorId) {
      generatedMap.set(creatorId, (generatedMap.get(creatorId) || 0) + 1);
    }
  });

  // Agent Performance Today (Closed Leads & Follow-ups)
  const agentStats = new Map<string, { leadsClosedCount: number; followupsCount: number; revenueTotal: number }>();

  const closedLeadIds = validClosed.map((l: any) => l.$id);
  let closedLeadPayments: any[] = [];
  if (closedLeadIds.length > 0) {
    for (let i = 0; i < closedLeadIds.length; i += 100) {
      const chunk = closedLeadIds.slice(i, i + 100);
      const docs = await listAllDocuments<any>({
        databases, databaseId: DATABASE_ID, collectionId: COLLECTIONS.CLIENT_PAYMENTS,
        queries: [Query.equal("leadId", chunk)]
      });
      closedLeadPayments.push(...docs);
    }
  }
  const upfrontMap = new Map<string, number>();
  for (const p of closedLeadPayments) {
    try {
      const plan = JSON.parse(p.paymentPlan ?? p.paymentPlanJson ?? "{}");
      upfrontMap.set(p.leadId, Number(plan.upfrontAmount) || 0);
    } catch {}
  }

  validClosed.forEach((l: any) => {
    const actorId = l.assignedToId || l.ownerId;
    if (actorId) {
      const stat = agentStats.get(actorId) || { leadsClosedCount: 0, followupsCount: 0, revenueTotal: 0 };
      stat.leadsClosedCount += 1;
      stat.revenueTotal += (upfrontMap.get(l.$id) || 0);
      agentStats.set(actorId, stat);
    }
  });

  followupsDocs.forEach((f: any) => {
    const leadId = f.leadId;
    const actorId = followupLeadActorMap.get(leadId);
    if (actorId) {
      const stat = agentStats.get(actorId) || { leadsClosedCount: 0, followupsCount: 0, revenueTotal: 0 };
      stat.followupsCount += 1;
      stat.revenueTotal += (Number(f.amount) || 0);
      agentStats.set(actorId, stat);
    }
  });
  
  const paymentDocs = await listAllDocuments<any>({
    databases,
    databaseId: DATABASE_ID,
    collectionId: COLLECTIONS.CLIENT_PAYMENTS,
    queries: [Query.greaterThanEqual("updatedAt", startIso)],
    pageLimit: 100,
    maxPages: 500,
  });

  const allPaymentLeadIds = Array.from(new Set(paymentDocs.map((doc: any) => (typeof doc.leadId === "string" ? doc.leadId : "")).filter(Boolean)));
  const allPaymentLeadDocs: any[] = [];
  for (let i = 0; i < allPaymentLeadIds.length; i += 100) {
    const chunkDocs = await listAllDocuments<any>({
      databases,
      databaseId: DATABASE_ID,
      collectionId: COLLECTIONS.LEADS,
      queries: [Query.equal("$id", allPaymentLeadIds.slice(i, i + 100))],
      pageLimit: 100,
      maxPages: 500,
    });
    allPaymentLeadDocs.push(...chunkDocs);
  }
  
  const leadDataMap = new Map<string, { company: string, leadStatus: string, leadAmount: number, closedAt: string | null }>();
  for (const lead of allPaymentLeadDocs) {
    let company = "";
    let leadAmount = 0;
    try {
      const parsed = JSON.parse(lead.data ?? "{}") as any;
      company = parsed.company?.trim() || "";
      if (!company) {
        const first = parsed.firstName?.trim() || "";
        const last = parsed.lastName?.trim() || "";
        company = [first, last].filter(Boolean).join(" ");
      }
      if (!company) company = parsed.email?.trim() || "";
      const rawAmount = parsed.leadAmount ?? parsed.totalAmount ?? parsed.amount;
      if (typeof rawAmount === "number" && Number.isFinite(rawAmount)) {
        leadAmount = rawAmount;
      } else if (typeof rawAmount === "string" && rawAmount.trim() !== "") {
        const num = Number(rawAmount);
        if (Number.isFinite(num)) leadAmount = num;
      }
    } catch {}
    leadDataMap.set(lead.$id, { company, leadStatus: lead.status || "", leadAmount, closedAt: lead.closedAt || null });
  }
  
  const companyMap = new Map<string, { company: string, total: number, upfront: number, pending: number, remaining: number, count: number }>();
  
  // Group followups by lead for the payments table
  const leadFollowupsMap = new Map<string, number>();
  for (const fDoc of followupsDocs) {
    const fLeadId = fDoc.leadId || "";
    if (fLeadId) {
      leadFollowupsMap.set(fLeadId, (leadFollowupsMap.get(fLeadId) || 0) + (Number(fDoc.amount) || 0));
    }
  }

  for (const doc of paymentDocs) {
    const leadId = doc.leadId || "";
    if (!leadId) continue;
    
    let paymentPlan = { upfrontAmount: 0 };
    try { paymentPlan = JSON.parse(doc.paymentPlan ?? doc.paymentPlanJson ?? "{}"); } catch {}
    
    const meta = leadDataMap.get(leadId);
    
    const displayCompany = meta?.company?.trim() ? meta.company : "Unspecified";
    const key = displayCompany.trim().toLowerCase().replace(/[^\w\s]/g, " ").replace(/\s+/g, " ");
    
    const ex = companyMap.get(key) ?? { company: displayCompany || "Unspecified", total: 0, upfront: 0, pending: 0, remaining: 0, count: 0 };
    const followupsCollected = Math.max(0, leadFollowupsMap.get(leadId) ?? 0);
    
    const statusNorm = meta?.leadStatus?.trim().toLowerCase().replace(/\s+/g, "") ?? "";
    if (statusNorm === "backedout" || statusNorm === "backout" || statusNorm === "notinterested") {
      ex.pending += followupsCollected;
      companyMap.set(key, ex);
      continue;
    }

    let outOfRange = false;
    let closedDate = meta?.closedAt ? meta.closedAt.slice(0, 10) : doc.$createdAt?.slice(0, 10);
    if (!closedDate) closedDate = "";
    if (closedDate < todayKey || closedDate > todayKey) {
      outOfRange = true;
    }

    if (outOfRange) {
      if (followupsCollected > 0) {
        ex.pending += followupsCollected;
        companyMap.set(key, ex);
      }
      continue;
    }
    
    ex.pending += followupsCollected;
    const leadAmount = Math.round(meta?.leadAmount ?? 0);
    const upfront = Math.round(paymentPlan.upfrontAmount ?? 0);
    const remaining = Math.max(0, leadAmount - upfront - followupsCollected);
    ex.total += leadAmount;
    ex.upfront += upfront;
    ex.remaining += remaining;
    ex.count += 1;
    companyMap.set(key, ex);
  }
  
  const techPayments = await listAllDocuments<any>({
    databases,
    databaseId: DATABASE_ID,
    collectionId: COLLECTIONS.TECHNICAL_PAYMENTS,
    queries: [Query.greaterThanEqual("createdAt", startIso), Query.lessThanEqual("createdAt", endIso)],
    pageLimit: 100,
    maxPages: 500,
  });
  const techTotal = techPayments.reduce((sum: number, p: any) => sum + (Number(p.amount) || 0), 0);

  const displayRows = Array.from(companyMap.values()).sort((a, b) => b.total - a.total);
  const grandTotals = displayRows.reduce(
    (acc, row) => ({
      total: acc.total + row.total,
      upfront: acc.upfront + row.upfront,
      pending: acc.pending + row.pending,
      remaining: acc.remaining + row.remaining,
      count: acc.count + row.count,
    }),
    { total: 0, upfront: 0, pending: 0, remaining: 0, count: 0 }
  );

  let html = `<h2>Daily Report Summary - ${todayKey}</h2>`;
  
  html += `<h3>Leads Generated Today</h3>`;
  if (generatedMap.size === 0) {
    html += `<p>No leads generated today.</p>`;
  } else {
    html += `<table border="1" cellpadding="5" cellspacing="0" style="border-collapse: collapse;">
      <tr><th>Agent / TL</th><th>Leads Generated</th></tr>`;
    for (const [agentId, count] of generatedMap.entries()) {
      html += `<tr><td>${usersMap.get(agentId) || 'Unknown'}</td><td>${count}</td></tr>`;
    }
    html += `</table>`;
  }

  html += `<h3>Agent Performance Today</h3>`;
  if (agentStats.size === 0) {
    html += `<p>No leads closed or follow-ups collected today.</p>`;
  } else {
    html += `<table border="1" cellpadding="5" cellspacing="0" style="border-collapse: collapse;">
      <tr><th>Agent / TL</th><th>Follow-ups / Leads Closed</th><th>Upfront & Follow-ups Amount</th></tr>`;
    for (const [agentId, stat] of agentStats.entries()) {
      html += `<tr>
        <td>${usersMap.get(agentId) || 'Unknown'}</td>
        <td style="text-align: center;">${stat.followupsCount} / ${stat.leadsClosedCount}</td>
        <td style="text-align: right;">${currencyFormatter.format(stat.revenueTotal)}</td>
      </tr>`;
    }
    html += `</table>`;
  }

  html += `<h3>Payments</h3>`;
  if (displayRows.length === 0 && techTotal === 0) {
    html += `<p>No payments recorded today.</p>`;
  } else {
    html += `<table border="1" cellpadding="5" cellspacing="0" style="border-collapse: collapse; width: 100%; max-width: 800px;">
      <tr style="background-color: #f9fafb;">
        <th style="text-align: left;">Company</th>
        <th style="text-align: right;">Records</th>
        <th style="text-align: right;">Total</th>
        <th style="text-align: right;">Upfront</th>
        <th style="text-align: right;">Pending</th>
        <th style="text-align: right;">Remaining</th>
      </tr>`;
    for (const row of displayRows) {
      html += `<tr>
        <td>${row.company}</td>
        <td style="text-align: right;">${row.count}</td>
        <td style="text-align: right;">${currencyFormatter.format(row.total)}</td>
        <td style="text-align: right;">${currencyFormatter.format(row.upfront)}</td>
        <td style="text-align: right; color: #1d4ed8;">${currencyFormatter.format(row.pending)}</td>
        <td style="text-align: right; color: #b45309;">${currencyFormatter.format(row.remaining)}</td>
      </tr>`;
    }
    html += `<tr style="font-weight: bold; border-top: 2px solid #e5e7eb;">
        <td>Grand total</td>
        <td style="text-align: right;">${grandTotals.count}</td>
        <td style="text-align: right;">${currencyFormatter.format(grandTotals.total)}</td>
        <td style="text-align: right;">${currencyFormatter.format(grandTotals.upfront)}</td>
        <td style="text-align: right; color: #1d4ed8;">${currencyFormatter.format(grandTotals.pending)}</td>
        <td style="text-align: right; color: #b45309;">${currencyFormatter.format(grandTotals.remaining)}</td>
      </tr>`;
    html += `<tr style="color: #1d4ed8; font-weight: 600;">
        <td colspan="3">Technical paid (Assessments & Interviews)</td>
        <td style="text-align: right;">${currencyFormatter.format(techTotal)}</td>
        <td colspan="2"></td>
      </tr>`;
    html += `<tr style="font-weight: bold; color: #047857; border-top: 2px solid #e5e7eb;">
        <td colspan="3">Total Revenue (Upfront + Pending + Technical)</td>
        <td style="text-align: right;">${currencyFormatter.format(grandTotals.upfront + techTotal)}</td>
        <td style="text-align: right;">${currencyFormatter.format(grandTotals.pending)}</td>
        <td style="text-align: right;">${currencyFormatter.format(grandTotals.upfront + grandTotals.pending + techTotal)}</td>
      </tr>`;
    html += `</table>`;
  }

  html += `<br><p style="font-size: 12px; color: #6b7280;">You are receiving this because of a new notification in the CRM. This email and any attachments are confidential and intended solely for the addressee.<br />This is sent from crm.silverspaceinc.tech. Please don't reply to this mail.</p>`;

  const toEmails = adminEmails.join(",");
  const subject = `Daily Report Summary - ${todayKey}`;
  
  await sendNotificationEmail({ to: toEmails, subject, html });

  return NextResponse.json({ ok: true, sentTo: adminEmails.length });
}
