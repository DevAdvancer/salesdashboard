import { targetReportBranchOwners } from '@/lib/server/target-report-branch-owners';
import { targetReportBranchSplits } from '@/lib/utils/target-report-branch-splits';
import { easternDayBounds } from '@/lib/utils/reporting-period';
import { followupPaymentRecipient, isIndependentFollowup } from '@/lib/utils/followup-payment-attribution';
import { followupsPaymentCategory } from '@/lib/utils/followups-payment-category';
import { getFollowupsPaymentAmount } from "@/lib/utils/followups-payment-amount";
import { readCurrentReportingPeriod } from "@/lib/server/reporting-calendar";
import { NextResponse, type NextRequest } from "next/server";
import { targetUpfrontAmounts } from "@/lib/utils/target-payment-attribution";
import { Query } from "node-appwrite";
import { createAdminClient } from "@/lib/server/appwrite";
import { COLLECTIONS, DATABASE_ID } from "@/lib/constants/appwrite";
import { getCurrentEasternIsoDate } from "@/lib/utils/eastern-date";
import { sendNotificationEmail } from "@/lib/server/email-service";
import { getReportEmails } from "@/lib/server/report-email-settings";
import { listAllDocuments } from "@/lib/server/appwrite-pagination";
import { buildTargetReport } from "@/lib/utils/monthly-target-report";
import { computeAgentStatsForDate } from "@/lib/server/stats-aggregator";
import { targetReportEmailDates, targetReportEmailSchedule, targetReportEmailSubject } from '@/lib/utils/target-report-email';

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

  const now = new Date();
  const todayIso = getCurrentEasternIsoDate(now);

  const { databases } = await createAdminClient();
  const reportingPeriod = await readCurrentReportingPeriod(now);
  const monthKey = reportingPeriod.monthKey;
  const { shouldSend, isFinal } = targetReportEmailSchedule(reportingPeriod, now);
  if (!shouldSend) {
    return NextResponse.json({ ok: true, skipped: true, reason: 'Not a weekly or final report date' });
  }

  const reportEmails = await getReportEmails(databases);
  if (reportEmails.length === 0) {
    return NextResponse.json({ ok: true, skipped: true, reason: "No report recipients configured" });
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

  const leadsAndPaymentsFromIso = reportingPeriod.leadsFromIso;
  const leadsAndPaymentsToIso = reportingPeriod.leadsToIso;

  const { from: leadsAndPaymentsStartIso, to: leadsAndPaymentsEndIso } = easternDayBounds(leadsAndPaymentsFromIso, leadsAndPaymentsToIso);


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
        Query.greaterThanEqual("dateKey", leadsAndPaymentsFromIso),
        Query.lessThanEqual(
          "dateKey",
          leadsAndPaymentsToIso >= todayIso ? (() => {
            const d = new Date(todayIso);
            d.setUTCDate(d.getUTCDate() - 1);
            return d.toISOString().slice(0, 10);
          })() : leadsAndPaymentsToIso
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

  if (leadsAndPaymentsFromIso <= todayIso && leadsAndPaymentsToIso >= todayIso) {
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

  let unassignedFollowupsAmount = 0;
  const followupsByAgentId: Record<string, number> = {};
  const bgcByAgentId: Record<string, number> = {};
  const otherByAgentId: Record<string, number> = {};
  const readableSet = new Set(readableAgentIds);
  const contributorIds = new Set<string>(allUsers.filter(user => user.role === 'admin' || user.role === 'monitor').map(user => user.$id));
  const followupsDocs = await listAllDocuments<any>({
    databases,
    databaseId: DATABASE_ID,
    collectionId: COLLECTIONS.PREVIOUS_FOLLOWUPS_PAYMENTS,
    // Older financial mirrors can have an audit date in a different month.
    // Read their sources across dates; apply the business window below.
    queries: [Query.orderAsc("$id")],
    requireComplete: true,
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
    if (typeof doc.date !== 'string' || doc.date < leadsAndPaymentsFromIso || doc.date > leadsAndPaymentsToIso) continue;
    const leadId = typeof doc.leadId === "string" ? doc.leadId : "";
    const amount = getFollowupsPaymentAmount(doc);
    if (amount === 0) continue;

    const targetAgentId = followupPaymentRecipient(doc, followupLeadById.get(leadId));
    if (!targetAgentId && isIndependentFollowup(leadId)) { unassignedFollowupsAmount += amount; continue; }
    if (!targetAgentId || !readableSet.has(targetAgentId)) continue;
    followupsByAgentId[targetAgentId] = (followupsByAgentId[targetAgentId] ?? 0) + amount;
    if (followupsPaymentCategory(leadId) === 'other') {
      otherByAgentId[targetAgentId] = (otherByAgentId[targetAgentId] ?? 0) + amount;
    }
    if (followupsPaymentCategory(leadId) === 'bgc') {
      bgcByAgentId[targetAgentId] = (bgcByAgentId[targetAgentId] ?? 0) + amount;
    }
  }

  const clientPayments = await listAllDocuments<any>({
    databases,
    databaseId: DATABASE_ID,
    collectionId: COLLECTIONS.CLIENT_PAYMENTS,
    requireComplete: true,
    queries: [
      Query.orderAsc("$id"),
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
    const lead = cpLeadById.get(leadId) ?? {};

    const agentTotals = targetUpfrontAmounts({ payment: cp, lead,
      from: leadsAndPaymentsFromIso, to: leadsAndPaymentsToIso, contributorIds, followups: followupsDocs });
    for (const [agentId, amount] of agentTotals) {
      if (amount !== 0 && readableSet.has(agentId)) {
        agentStatsByUserId[agentId] ??= { achieved: 0, leadCount: 0, referralExcludedCount: 0, notInterestedCount: 0 };
        agentStatsByUserId[agentId].achieved += amount;
      }
    }
  }

  const technicalPaymentsByAgentId: Record<string, number> = {};
  const techPayments = await listAllDocuments<any>({
    databases,
    databaseId: DATABASE_ID,
    collectionId: COLLECTIONS.TECHNICAL_PAYMENTS,
    queries: [Query.greaterThanEqual("createdAt", leadsAndPaymentsStartIso), Query.lessThanEqual("createdAt", leadsAndPaymentsEndIso)],
    pageLimit: 100,
    maxPages: 100,
  });
  techPayments.forEach((p) => {
    const actorId = p.userId;
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

  const branchDocs = await listAllDocuments<any>({ databases, databaseId: DATABASE_ID, collectionId: COLLECTIONS.BRANCHES,
    queries: [Query.select(['$id', 'name'])], requireComplete: true });
  const branchMap = new Map<string, string>(branchDocs.map(branch => [branch.$id, branch.name]));

  const result = buildTargetReport({
    monthKey,
    targets,
    assignmentsByTargetId,
    usersByAgentId,
    agentStatsByUserId,
    followupsByAgentId,
    bgcByAgentId,
    otherByAgentId,
    unassignedFollowupsAmount,
    technicalPaymentsByAgentId,
    branchMap,
  });

  const branchLeads = new Map([...followupLeadById, ...cpLeadById]);
  const branchOwners = await targetReportBranchOwners(databases, usersByAgentId, branchLeads, clientPayments);
  result.branchSplits = targetReportBranchSplits({ result, users: branchOwners, branches: branchMap,
    payments: clientPayments, leads: branchLeads, followups: followupsDocs,
    contributorIds, from: leadsAndPaymentsFromIso, to: leadsAndPaymentsToIso });
  const isMonthOver = isFinal;
  let html = `<p>${isFinal ? 'Final' : 'Weekly'} target report</p>`;
  html += `<p>${targetReportEmailDates(reportingPeriod)}</p>`;
  html += `<table border="1" cellpadding="5" cellspacing="0" style="border-collapse: collapse; width: 100%; max-width: 800px;">
    <tr style="background-color: #18181b;">
      <th style="text-align: left;">TL / Agent</th>
      <th style="text-align: right;">Target</th>
      <th style="text-align: right;">Achieved</th>
      <th style="text-align: right;">Percent</th>
      ${isMonthOver ? `<th style="text-align: center;">Status</th>` : ''}
    </tr>`;

  for (const row of result.rows) {
    const pct = row.percent !== null ? (row.percent * 100).toFixed(1) + "%" : "-";
    const status = (row.percent !== null && row.percent >= 1) ? "Met" : "Not Met";
    const statusColor = status === "Met" ? "#1eaa52" : "#f87171";
    
    html += `<tr style="font-weight: bold; background-color: #18181b;">
      <td>${row.teamLeadName} (Team Total)</td>
      <td style="text-align: right;">${currencyFormatter.format(row.target)}</td>
      <td style="text-align: right;">${currencyFormatter.format(row.achieved)}</td>
      <td style="text-align: right;">${pct}</td>
      ${isMonthOver ? `<td style="text-align: center; color: ${statusColor}">${status}</td>` : ''}
    </tr>`;

    for (const agent of row.agents) {
      const apct = agent.percent !== null ? (agent.percent * 100).toFixed(1) + "%" : "-";
      const astatus = (agent.percent !== null && agent.percent >= 1) ? "Met" : "Not Met";
      const astatusColor = astatus === "Met" ? "#1eaa52" : "#f87171";

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
  html += `<tr style="font-weight: bold; border-top: 2px solid #39393b;">
    <td>Grand Total</td>
    <td style="text-align: right;">${currencyFormatter.format(result.totals.target)}</td>
    <td style="text-align: right;">${currencyFormatter.format(result.totals.achieved)}</td>
    <td style="text-align: right;">${tpct}</td>
    ${isMonthOver ? `<td></td>` : ''}
  </tr>`;

  for (const split of result.branchSplits) {
    html += `<tr><td>${split.branchName.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!)} Split</td><td></td><td style="text-align: right;">${currencyFormatter.format(split.amount)}</td><td></td>${isMonthOver ? '<td></td>' : ''}</tr>`;
  }
  html += `</table>`;


  const toEmails = reportEmails.join(",");
  const subject = targetReportEmailSubject(monthKey);
  await sendNotificationEmail({ to: toEmails, subject, html, allowAllRecipients: true });

  return NextResponse.json({ ok: true, sentTo: reportEmails.length });
}
