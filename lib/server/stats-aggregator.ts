import { Query, ID } from "node-appwrite";
import { createAdminClient } from "./appwrite";
import { DATABASE_ID, COLLECTIONS } from "../constants/appwrite";
import { listAllDocuments } from "./appwrite-pagination";
import { toDateKey } from "../utils/report-kpi";

// --------------------------------------------------------
// LINKEDIN STATS AGGREGATION
// --------------------------------------------------------

export async function computeLinkedinStatsForDate(dateKey: string, accountsMap?: Map<string, any>) {
  const { databases } = await createAdminClient();

  if (!accountsMap) {
    const accounts = await listAllDocuments<any>({
      databases,
      databaseId: DATABASE_ID,
      collectionId: COLLECTIONS.LINKEDIN_ACCOUNTS,
      queries: [Query.limit(100)],
      pageLimit: 100,
      maxPages: 50,
    });
    accountsMap = new Map(accounts.map((a) => [a.$id, a]));
  }

  const startIso = `${dateKey}T00:00:00.000Z`;
  const endIso = `${dateKey}T23:59:59.999Z`;

  // 1. Fetch all requests sent on this date
  const requests = await listAllDocuments<any>({
    databases,
    databaseId: DATABASE_ID,
    collectionId: COLLECTIONS.LINKEDIN_REQUESTS,
    queries: [
      Query.greaterThanEqual("dateSent", startIso),
      Query.lessThanEqual("dateSent", endIso)
    ],
    pageLimit: 100,
    maxPages: 100,
  });

  // 2. Fetch associated leads to check closures
  const leadIds = Array.from(new Set(requests.map((r) => r.leadId).filter(Boolean)));
  const leadById = new Map<string, any>();
  if (leadIds.length > 0) {
    const chunks = [];
    for (let i = 0; i < leadIds.length; i += 100) chunks.push(leadIds.slice(i, i + 100));
    await Promise.all(
      chunks.map(async (chunk) => {
        const docs = await databases.listDocuments(DATABASE_ID, COLLECTIONS.LEADS, [
          Query.equal("$id", chunk),
          Query.limit(100),
        ]);
        docs.documents.forEach((d) => leadById.set(d.$id, d));
      })
    );
  }

  // 3. Aggregate
  const map = new Map<string, any>();
  for (const req of requests) {
    if (!req.accountId || !req.agentId) continue;
    
    const account = accountsMap.get(req.accountId);
    const accountType = account?.accountType ?? "main";
    const idName = account?.idName ?? req.accountId;
    const company = req.company ?? "";

    const key = `${req.agentId}-${req.accountId}`;
    const existing = map.get(key) ?? {
      dateKey,
      agentId: req.agentId,
      accountId: req.accountId,
      teamLeadId: req.teamLeadId ?? null,
      company,
      idName,
      accountType,
      sent: 0,
      coldCalls: 0,
      accepted: 0,
      leadsGenerated: 0,
      closures: 0,
      notAccepted: 0,
      withdrawn: 0,
    };

    existing.sent += 1;
    if (req.coldCall) existing.coldCalls += 1;
    
    const isActive = req.isActive !== false;
    if (req.status === "accepted") existing.accepted += 1;
    else if (req.status === "withdrawn" || !isActive) existing.withdrawn += 1;
    else existing.notAccepted += 1;

    if (req.leadId) {
      existing.leadsGenerated += 1;
      const lead = leadById.get(req.leadId);
      if (lead) {
        const normalizedStatus = typeof lead.status === "string" ? lead.status.trim().toLowerCase().replace(/\s+/g, "") : "";
        if (lead.isClosed && normalizedStatus === "won") {
          existing.closures += 1;
        }
      }
    }

    map.set(key, existing);
  }

  return Array.from(map.values());
}

export async function aggregateLinkedinStatsForDates(dateKeys: string[]) {
  const { databases } = await createAdminClient();
  if (dateKeys.length === 0) return;

  // Fetch all accounts for mapping
  const accounts = await listAllDocuments<any>({
    databases,
    databaseId: DATABASE_ID,
    collectionId: COLLECTIONS.LINKEDIN_ACCOUNTS,
    queries: [Query.limit(100)],
    pageLimit: 100,
    maxPages: 50,
  });
  const accountsMap = new Map(accounts.map((a) => [a.$id, a]));

  for (const dateKey of dateKeys) {
    const rows = await computeLinkedinStatsForDate(dateKey, accountsMap);

    // 4. Delete existing rows for this dateKey to replace them
    const existingRows = await listAllDocuments<any>({
      databases,
      databaseId: DATABASE_ID,
      collectionId: COLLECTIONS.LINKEDIN_DAILY_STATS,
      queries: [Query.equal("dateKey", dateKey)],
      pageLimit: 100,
      maxPages: 100,
    });
    
    await Promise.all(
      existingRows.map((row) =>
        databases.deleteDocument(DATABASE_ID, COLLECTIONS.LINKEDIN_DAILY_STATS, row.$id)
      )
    );

    // 5. Insert new aggregated rows
    for (const row of rows) {
      await databases.createDocument(DATABASE_ID, COLLECTIONS.LINKEDIN_DAILY_STATS, ID.unique(), row);
    }
  }
}

// --------------------------------------------------------
// AGENT STATS AGGREGATION
// --------------------------------------------------------

export async function computeAgentStatsForDate(dateKey: string) {
  const { databases } = await createAdminClient();
  const startIso = `${dateKey}T00:00:00.000Z`;
  const endIso = `${dateKey}T23:59:59.999Z`;

  // 1. Leads Created on this date
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

  // 2. Leads Closed on this date
  const closedLeads = await listAllDocuments<any>({
    databases,
    databaseId: DATABASE_ID,
    collectionId: COLLECTIONS.LEADS,
    queries: [
      Query.equal("isClosed", true),
      Query.greaterThanEqual("$updatedAt", startIso), // Use $updatedAt and filter below
    ],
    pageLimit: 100,
    maxPages: 500,
  });
  const validClosed = closedLeads.filter(l => {
    const c = l.closedAt ?? l.$updatedAt;
    return c >= startIso && c <= endIso;
  });

  // 3. Not Interested Marks on this date
  const notInterested = await listAllDocuments<any>({
    databases,
    databaseId: DATABASE_ID,
    collectionId: COLLECTIONS.NOT_INTERESTED_LEADS,
    queries: [
      Query.greaterThanEqual("markedAt", startIso),
      Query.lessThanEqual("markedAt", endIso),
    ],
    pageLimit: 100,
    maxPages: 200,
  });
  const validNI = notInterested.filter(d => !d.status || d.status === "active");

  // 4. Client Payments updated on this date
  const payments = await listAllDocuments<any>({
    databases,
    databaseId: DATABASE_ID,
    collectionId: COLLECTIONS.CLIENT_PAYMENTS,
    queries: [
      Query.greaterThanEqual("updatedAt", startIso),
      Query.lessThanEqual("updatedAt", endIso),
    ],
    pageLimit: 100,
    maxPages: 200,
  });

  // 5. Tech Payments on this date
  const techPayments = await listAllDocuments<any>({
    databases,
    databaseId: DATABASE_ID,
    collectionId: COLLECTIONS.TECHNICAL_PAYMENTS,
    queries: [
      Query.greaterThanEqual("createdAt", startIso),
      Query.lessThanEqual("createdAt", endIso),
    ],
    pageLimit: 100,
    maxPages: 100,
  });

  // 6. Aggregate per agent
  const map = new Map<string, any>();
  const getMap = (agentId: string) => {
    if (!agentId) return null;
    let existing = map.get(agentId);
    if (!existing) {
      existing = {
        dateKey,
        agentId,
        teamLeadId: null,
        leadsGenerated: 0,
        assignedLeadCount: 0,
        referralsGenerated: 0,
        coldCallsGenerated: 0,
        leadsClosed: 0,
        notInterestedMarked: 0,
        callsScheduled: 0, // Ignored for now (requires audit logs)
        followupsScheduled: 0, // Ignored for now
        upfrontRevenue: 0,
        technicalUpfrontRevenue: 0,
      };
      map.set(agentId, existing);
    }
    return existing;
  };

  const getAttributed = (l: any) => l.assignedToId || l.ownerId;
  const normalizeSource = (v: any) => (typeof v === "string" ? v.trim().toLowerCase().replace(/[^a-z0-9]/g, "") : "");

  createdLeads.forEach(l => {
    let data: any = {};
    try { data = JSON.parse(l.data); } catch {}
    const src = normalizeSource(data.sourceName ?? data.source);
    const isReferral = src === "referral" || src.includes("referral");
    
    const creatorId = data.creatorId || l.ownerId;
    if (creatorId) {
      const creatorRow = getMap(creatorId);
      if (creatorRow) {
        if (isReferral) creatorRow.referralsGenerated += 1;
        else creatorRow.leadsGenerated += 1;
        
        if (src.includes("coldcall")) creatorRow.coldCallsGenerated += 1;
      }
    }
    
    if (l.assignedToId) {
      const assigneeRow = getMap(l.assignedToId);
      if (assigneeRow) {
        assigneeRow.assignedLeadCount = (assigneeRow.assignedLeadCount || 0) + 1;
      }
    }
  });

  validClosed.forEach(l => {
    const row = getMap(getAttributed(l));
    if (row) row.leadsClosed += 1;
  });

  validNI.forEach(ni => {
    const owner = ni.previousAssignedToId || ni.previousOwnerId;
    const row = getMap(owner);
    if (row) row.notInterestedMarked += 1;
  });

  // Payments requires lead attribution
  const paymentLeadIds = Array.from(new Set(payments.map(p => p.leadId).filter(Boolean)));
  const paymentLeads = new Map<string, any>();
  if (paymentLeadIds.length > 0) {
    const chunks = [];
    for (let i = 0; i < paymentLeadIds.length; i += 100) chunks.push(paymentLeadIds.slice(i, i + 100));
    await Promise.all(
      chunks.map(async (chunk) => {
        const docs = await databases.listDocuments(DATABASE_ID, COLLECTIONS.LEADS, [Query.equal("$id", chunk), Query.limit(100)]);
        docs.documents.forEach(d => paymentLeads.set(d.$id, d));
      })
    );
  }

  payments.forEach(p => {
    const lead = paymentLeads.get(p.leadId);
    if (!lead) return;
    
    const leadCreated = (lead.closedAt as string) || (lead.$createdAt as string) || (lead.createdAt as string);
    const monthStartIso = `${dateKey.slice(0, 7)}-01T00:00:00.000Z`;
    if (leadCreated && leadCreated < monthStartIso) {
      return; // Payments for leads closed in previous months are followups, not upfront
    }

    let updates = [];
    try { updates = JSON.parse(p.updates ?? p.updatesJson ?? "[]"); } catch {}
    if (!Array.isArray(updates)) updates = [];
    
    let addedFromUpdates = false;
    for (const u of updates) {
      if (u && u.createdAt && u.createdAt >= startIso && u.createdAt <= endIso) {
        if (u.status === "partially_paid" || u.status === "fully_paid") {
          const actorId = getAttributed(lead);
          const row = getMap(actorId);
          if (row) {
            const amount = Number(u.amount) || 0;
            if (amount > 0) row.upfrontRevenue += amount;
            addedFromUpdates = true;
          }
        }
      }
    }
    
    if (!addedFromUpdates && (p.status === "partially_paid" || p.status === "fully_paid")) {
      if (updates.length === 0) {
        const paymentDateIso = p.createdAt;
        if (paymentDateIso >= startIso && paymentDateIso <= endIso) {
          const actorId = getAttributed(lead);
          const row = getMap(actorId);
          if (row) {
            let plan: any = {};
            try { plan = JSON.parse(p.paymentPlan ?? p.paymentPlanJson ?? "{}"); } catch {}
            const amount = Number(plan.upfrontAmount) || 0;
            if (amount > 0) row.upfrontRevenue += amount;
          }
        }
      }
    }
  });

  techPayments.forEach(p => {
    const row = getMap(p.userId);
    if (!row) return;
    const amount = Number(p.amount) || 0;
    row.technicalUpfrontRevenue += amount;
    row.upfrontRevenue += amount;
  });

  const agentIds = Array.from(map.keys());
  if (agentIds.length > 0) {
    const chunks = [];
    for (let i = 0; i < agentIds.length; i += 100) chunks.push(agentIds.slice(i, i + 100));
    await Promise.all(
      chunks.map(async (chunk) => {
        const docs = await databases.listDocuments(DATABASE_ID, COLLECTIONS.USERS, [
          Query.equal("$id", chunk),
          Query.select(["$id", "teamLeadId"]),
          Query.limit(100),
        ]);
        docs.documents.forEach((d) => {
          const row = map.get(d.$id);
          if (row) row.teamLeadId = d.teamLeadId || null;
        });
      })
    );
  }

  return Array.from(map.values());
}

export async function aggregateAgentStatsForDates(dateKeys: string[]) {
  const { databases } = await createAdminClient();
  if (dateKeys.length === 0) return;

  for (const dateKey of dateKeys) {
    const rows = await computeAgentStatsForDate(dateKey);

    // Delete existing
    const existingRows = await listAllDocuments<any>({
      databases,
      databaseId: DATABASE_ID,
      collectionId: COLLECTIONS.AGENT_DAILY_STATS,
      queries: [Query.equal("dateKey", dateKey)],
      pageLimit: 100,
      maxPages: 100,
    });
    await Promise.all(existingRows.map((row) => databases.deleteDocument(DATABASE_ID, COLLECTIONS.AGENT_DAILY_STATS, row.$id)));

    // Insert new
    for (const row of rows) {
      await databases.createDocument(DATABASE_ID, COLLECTIONS.AGENT_DAILY_STATS, ID.unique(), row);
    }
  }
}
