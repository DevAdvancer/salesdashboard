import { NextResponse, type NextRequest } from "next/server";
import { Query } from "node-appwrite";
import { createAdminClient } from "@/lib/server/appwrite";
import { COLLECTIONS, DATABASE_ID } from "@/lib/constants/appwrite";
import { getCurrentEasternIsoDate } from "@/lib/utils/eastern-date";
import { sendNotificationEmail } from "@/lib/server/email-service";
import { listAllDocuments } from "@/lib/server/appwrite-pagination";
import { buildTargetReport } from "@/lib/utils/monthly-target-report";
import { computeAgentStatsForDate } from "@/lib/server/stats-aggregator";

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

function monthBounds(monthKey: string) {
  const [yearStr, monthStr] = monthKey.split("-");
  const year = Number(yearStr);
  const month = Number(monthStr);
  const start = new Date(Date.UTC(year, month - 1, 1));
  const end = new Date(Date.UTC(year, month, 0));
  return {
    from: start.toISOString().slice(0, 10),
    to: end.toISOString().slice(0, 10),
  };
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

  const todayIso = getCurrentEasternIsoDate(); // e.g. "2026-09-01T15:00:00.000Z"
  // Compute eastern date
  const now = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
  const is15th = now.getDate() === 15;
  const isLastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate() === now.getDate();

  if (!is15th && !isLastDay) {
    return NextResponse.json({ ok: true, skipped: true, reason: "Not 15th or last day of month" });
  }

  const { databases } = await createAdminClient();
  const todayKey = now.toISOString().slice(0, 10);
  const monthKey = todayKey.slice(0, 7); // e.g. "2026-09"

  // Fetch Admins
  const admins = await databases.listDocuments(DATABASE_ID, COLLECTIONS.USERS, [
    Query.equal("role", "admin"),
    Query.limit(500),
  ]);
  const adminEmails = admins.documents.map((doc: any) => doc.email).filter(Boolean);
  
  if (adminEmails.length === 0) {
    return NextResponse.json({ ok: false, reason: "No admin emails found" });
  }

  const targets = await listAllDocuments<any>({
    databases,
    databaseId: DATABASE_ID,
    collectionId: COLLECTIONS.MONTHLY_TARGETS,
    queries: [Query.equal("monthKey", monthKey)],
    pageLimit: 100,
    maxPages: 100,
  });

  let assignments: any[] = [];
  if (targets.length > 0) {
    assignments = await listAllDocuments<any>({
      databases,
      databaseId: DATABASE_ID,
      collectionId: COLLECTIONS.MONTHLY_TARGET_ASSIGNMENTS,
      queries: [
        Query.equal(
          "monthlyTargetId",
          targets.map((t) => t.$id)
        ),
      ],
      pageLimit: 100,
      maxPages: 100,
    });
  }

  const assignmentsByTargetId: Record<string, any[]> = {};
  targets.forEach((t) => {
    assignmentsByTargetId[t.$id] = [];
  });
  assignments.forEach((a) => {
    if (assignmentsByTargetId[a.monthlyTargetId]) {
      assignmentsByTargetId[a.monthlyTargetId].push(a);
    }
  });

  const allUsers = await listAllDocuments<any>({
    databases,
    databaseId: DATABASE_ID,
    collectionId: COLLECTIONS.USERS,
    queries: [Query.equal("department", "sales")],
    pageLimit: 100,
    maxPages: 200,
  });

  const usersByAgentId = new Map<string, any>();
  allUsers.forEach((u) => usersByAgentId.set(u.$id, u));
  const readableAgentIds = allUsers.map((u) => u.$id);

  const { from: monthFromIso, to: monthToIso } = monthBounds(monthKey);
  const monthStartIso = `${monthFromIso}T00:00:00.000Z`;
  const monthEndIso = `${monthToIso}T23:59:59.999Z`;

  const agentStatsByUserId: Record<string, any> = {};
  const CHUNK = 100;
  for (let i = 0; i < readableAgentIds.length; i += CHUNK) {
    const chunk = readableAgentIds.slice(i, i + CHUNK);
    const docs = await listAllDocuments<any>({
      databases,
      databaseId: DATABASE_ID,
      collectionId: COLLECTIONS.AGENT_DAILY_STATS,
      queries: [
        Query.equal("agentId", chunk),
        Query.greaterThanEqual("dateKey", monthFromIso),
        Query.lessThanEqual(
          "dateKey",
          monthToIso >= todayIso ? (() => {
            const d = new Date(todayIso);
            d.setUTCDate(d.getUTCDate() - 1);
            return d.toISOString().slice(0, 10);
          })() : monthToIso
        ),
        Query.orderAsc("$id"),
      ],
      pageLimit: 100,
      maxPages: 200,
    });
    for (const doc of docs) {
      if (!agentStatsByUserId[doc.agentId]) {
        agentStatsByUserId[doc.agentId] = { achieved: 0, leadCount: 0, referralExcludedCount: 0, notInterestedCount: 0 };
      }
      agentStatsByUserId[doc.agentId].leadCount += doc.leadsGenerated || 0;
      agentStatsByUserId[doc.agentId].referralExcludedCount += doc.referralsGenerated || 0;
      agentStatsByUserId[doc.agentId].notInterestedCount += doc.notInterestedMarked || 0;
    }
  }

  if (monthFromIso <= todayIso && monthToIso >= todayIso) {
    const todayStats = await computeAgentStatsForDate(todayIso);
    for (const doc of todayStats) {
      if (readableAgentIds.includes(doc.agentId)) {
        if (!agentStatsByUserId[doc.agentId]) {
          agentStatsByUserId[doc.agentId] = { achieved: 0, leadCount: 0, referralExcludedCount: 0, notInterestedCount: 0 };
        }
        agentStatsByUserId[doc.agentId].leadCount += doc.leadsGenerated || 0;
        agentStatsByUserId[doc.agentId].referralExcludedCount += doc.referralsGenerated || 0;
        agentStatsByUserId[doc.agentId].notInterestedCount += doc.notInterestedMarked || 0;
      }
    }
  }

  const followupsByAgentId: Record<string, number> = {};
  const readableSet = new Set(readableAgentIds);
  
  const followupsDocs = await listAllDocuments<any>({
    databases,
    databaseId: DATABASE_ID,
    collectionId: COLLECTIONS.PREVIOUS_FOLLOWUPS_PAYMENTS,
    queries: [
      Query.greaterThanEqual("date", monthFromIso),
      Query.lessThanEqual("date", monthToIso),
    ],
    pageLimit: 100,
    maxPages: 100,
  });

  const followupLeadIds = Array.from(new Set(
    followupsDocs
      .map((d) => typeof d.leadId === "string" ? d.leadId : "")
      .filter((id) => id && !id.startsWith("manual_followup:"))
  ));
  
  const followupLeadById = new Map<string, any>();
  if (followupLeadIds.length > 0) {
    for (let i = 0; i < followupLeadIds.length; i += CHUNK) {
      const chunk = followupLeadIds.slice(i, i + CHUNK);
      const ldocs = await listAllDocuments<any>({
        databases,
        databaseId: DATABASE_ID,
        collectionId: COLLECTIONS.LEADS,
        queries: [Query.equal("$id", chunk), Query.limit(CHUNK)],
        pageLimit: CHUNK,
        maxPages: 1,
      });
      for (const d of ldocs) followupLeadById.set(d.$id as string, d);
    }
  }

  for (const doc of followupsDocs) {
    const leadId = typeof doc.leadId === "string" ? doc.leadId : "";
    const amount = typeof doc.amount === "number" ? doc.amount : 0;
    if (!leadId || amount <= 0) continue;

    let targetAgentId = "";
    const creditedAgentId = typeof doc.creditedAgentId === "string" && doc.creditedAgentId.trim() !== "" ? doc.creditedAgentId : null;

    if (leadId.startsWith("manual_followup:")) {
      const createdById = typeof doc.createdById === "string" ? doc.createdById : "";
      targetAgentId = creditedAgentId || createdById;
    } else {
      const lead = followupLeadById.get(leadId);
      if (lead) {
        const ownerId = typeof lead.ownerId === "string" ? lead.ownerId : "";
        const assignedToId = typeof lead.assignedToId === "string" ? lead.assignedToId : "";
        targetAgentId = creditedAgentId || assignedToId || ownerId;
      }
    }
    
    if (!targetAgentId || !readableSet.has(targetAgentId)) continue;
    followupsByAgentId[targetAgentId] = (followupsByAgentId[targetAgentId] ?? 0) + amount;
  }

  const clientPayments = await listAllDocuments<any>({
    databases,
    databaseId: DATABASE_ID,
    collectionId: COLLECTIONS.CLIENT_PAYMENTS,
    queries: [
      Query.greaterThanEqual("updatedAt", monthStartIso),
      Query.lessThanEqual("updatedAt", monthEndIso),
    ],
    pageLimit: 100,
    maxPages: 200,
  });

  const cpLeadIds = Array.from(new Set(clientPayments.map((p) => typeof p.leadId === "string" ? p.leadId : "").filter(Boolean)));
  const cpLeadById = new Map<string, any>();
  if (cpLeadIds.length > 0) {
    for (let i = 0; i < cpLeadIds.length; i += CHUNK) {
      const chunk = cpLeadIds.slice(i, i + CHUNK);
      const ldocs = await listAllDocuments<any>({
        databases,
        databaseId: DATABASE_ID,
        collectionId: COLLECTIONS.LEADS,
        queries: [Query.equal("$id", chunk), Query.limit(CHUNK)],
        pageLimit: CHUNK,
        maxPages: 1,
      });
      for (const d of ldocs) cpLeadById.set(d.$id as string, d);
    }
  }

  for (const cp of clientPayments) {
    const leadId = cp.leadId as string;
    const lead = cpLeadById.get(leadId);
    if (!lead) continue;

    const ownerId = lead.ownerId as string | undefined;
    const assignedToId = lead.assignedToId as string | undefined;
    const attributedTo = assignedToId || ownerId;

    const leadCreated = (lead.closedAt as string) || (lead.$createdAt as string) || (lead.createdAt as string);
    if (leadCreated && leadCreated < monthStartIso) {
      continue;
    }

    let updates: any[] = [];
    try {
      const raw = cp.updates ?? cp.updatesJson;
      updates = JSON.parse(typeof raw === "string" ? raw : "[]");
      if (!Array.isArray(updates)) updates = [];
    } catch {
      updates = [];
    }

    let totalForLead = 0;
    const agentTotals = new Map<string, number>();

    for (const u of updates) {
      if (
        u.createdAt &&
        u.createdAt >= monthStartIso &&
        u.createdAt <= monthEndIso &&
        (u.status === "partially_paid" || u.status === "fully_paid")
      ) {
        if (attributedTo) {
          const amount = Number(u.amount) || 0;
          if (amount > 0) {
            agentTotals.set(attributedTo, (agentTotals.get(attributedTo) ?? 0) + amount);
            totalForLead += amount;
          }
        }
      }
    }

    if (totalForLead === 0 && updates.length === 0) {
      const createdAt = cp.createdAt as string | undefined;
      if (
        createdAt &&
        createdAt >= monthStartIso &&
        createdAt <= monthEndIso &&
        ((cp.status as string) === "partially_paid" || (cp.status as string) === "fully_paid")
      ) {
        if (attributedTo) {
          let plan: any = {};
          try {
            plan = JSON.parse(typeof (cp.paymentPlan ?? cp.paymentPlanJson) === "string" ? (cp.paymentPlan ?? cp.paymentPlanJson) as string : "{}");
          } catch {}
          const amount = Number(plan.upfrontAmount) || 0;
          if (amount > 0) {
            agentTotals.set(attributedTo, (agentTotals.get(attributedTo) ?? 0) + amount);
          }
        }
      }
    }

    const followupsForThisLead = followupsDocs
      .filter((doc) => doc.leadId === leadId)
      .reduce((sum, doc) => sum + (Number(doc.amount) || 0), 0);

    for (let [agentId, amount] of agentTotals.entries()) {
      amount -= followupsForThisLead;
      if (amount < 0) amount = 0;
      
      if (amount > 0 && readableAgentIds.includes(agentId)) {
        if (!agentStatsByUserId[agentId]) {
          agentStatsByUserId[agentId] = { achieved: 0, leadCount: 0, referralExcludedCount: 0, notInterestedCount: 0 };
        }
        agentStatsByUserId[agentId].achieved += amount;
      }
    }
  }

  const technicalPaymentsByAgentId: Record<string, number> = {};
  const techPayments = await listAllDocuments<any>({
    databases,
    databaseId: DATABASE_ID,
    collectionId: COLLECTIONS.TECHNICAL_PAYMENTS,
    queries: [Query.greaterThanEqual("createdAt", monthStartIso), Query.lessThanEqual("createdAt", monthEndIso)],
    pageLimit: 100,
    maxPages: 100,
  });
  techPayments.forEach((p) => {
    const actorId = p.actorId;
    if (actorId && readableAgentIds.includes(actorId)) {
      technicalPaymentsByAgentId[actorId] = (technicalPaymentsByAgentId[actorId] || 0) + (Number(p.amount) || 0);
    }
  });

  for (const [agentId, amount] of Object.entries(technicalPaymentsByAgentId)) {
    if (readableAgentIds.includes(agentId)) {
      if (!agentStatsByUserId[agentId]) {
        agentStatsByUserId[agentId] = { achieved: 0, leadCount: 0, referralExcludedCount: 0, notInterestedCount: 0 };
      }
      agentStatsByUserId[agentId].achieved += amount;
    }
  }

  const branchMap = new Map<string, string>();

  const result = buildTargetReport({
    monthKey,
    targets,
    assignmentsByTargetId,
    usersByAgentId,
    agentStatsByUserId,
    followupsByAgentId,
    technicalPaymentsByAgentId,
    branchMap,
  });

  const isMonthOver = isLastDay;
  
  let html = `<h2>Target Report - ${monthKey}</h2>`;
  
  html += `<table border="1" cellpadding="5" cellspacing="0" style="border-collapse: collapse; width: 100%; max-width: 800px;">
    <tr style="background-color: #f9fafb;">
      <th style="text-align: left;">TL / Agent</th>
      <th style="text-align: right;">Target</th>
      <th style="text-align: right;">Achieved</th>
      <th style="text-align: right;">Percent</th>
      ${isMonthOver ? `<th style="text-align: center;">Status</th>` : ''}
    </tr>`;

  for (const row of result.rows) {
    const pct = row.percent !== null ? (row.percent * 100).toFixed(1) + "%" : "-";
    const status = (row.percent !== null && row.percent >= 1) ? "Met" : "Not Met";
    const statusColor = status === "Met" ? "green" : "red";
    
    html += `<tr style="font-weight: bold; background-color: #f3f4f6;">
      <td>${row.teamLeadName} (Team Total)</td>
      <td style="text-align: right;">${currencyFormatter.format(row.target)}</td>
      <td style="text-align: right;">${currencyFormatter.format(row.achieved)}</td>
      <td style="text-align: right;">${pct}</td>
      ${isMonthOver ? `<td style="text-align: center; color: ${statusColor}">${status}</td>` : ''}
    </tr>`;

    for (const agent of row.agents) {
      const apct = agent.percent !== null ? (agent.percent * 100).toFixed(1) + "%" : "-";
      const astatus = (agent.percent !== null && agent.percent >= 1) ? "Met" : "Not Met";
      const astatusColor = astatus === "Met" ? "green" : "red";

      html += `<tr>
        <td style="padding-left: 20px;">${agent.userName}${agent.userId === row.teamLeadId ? ' (Personal)' : ''}</td>
        <td style="text-align: right;">${currencyFormatter.format(agent.target)}</td>
        <td style="text-align: right;">${currencyFormatter.format(agent.achieved)}</td>
        <td style="text-align: right;">${apct}</td>
        ${isMonthOver ? `<td style="text-align: center; color: ${astatusColor}">${astatus}</td>` : ''}
      </tr>`;
    }
  }

  const tpct = result.totals.percent !== null ? (result.totals.percent * 100).toFixed(1) + "%" : "-";
  html += `<tr style="font-weight: bold; border-top: 2px solid #e5e7eb;">
    <td>Grand Total</td>
    <td style="text-align: right;">${currencyFormatter.format(result.totals.target)}</td>
    <td style="text-align: right;">${currencyFormatter.format(result.totals.achieved)}</td>
    <td style="text-align: right;">${tpct}</td>
    ${isMonthOver ? `<td></td>` : ''}
  </tr>`;

  html += `</table>`;

  html += `<br><p style="font-size: 12px; color: #6b7280;">You are receiving this because of a new notification in the CRM. This email and any attachments are confidential and intended solely for the addressee.<br />This is sent from crm.silverspaceinc.tech. Please don't reply to this mail.</p>`;

  const toEmails = adminEmails.join(",");
  const subject = `Target Report - ${monthKey}`;
  
  await sendNotificationEmail({ to: toEmails, subject, html });

  return NextResponse.json({ ok: true, sentTo: adminEmails.length });
}
