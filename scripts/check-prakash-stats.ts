import { createAdminClient } from "../lib/server/appwrite";
import { COLLECTIONS, DATABASE_ID } from "../lib/constants/appwrite";
import { Query } from "node-appwrite";
import { listAllDocuments } from "../lib/server/appwrite-pagination";

async function main() {
  const { databases } = await createAdminClient();
  const users = await listAllDocuments<any>({
    databases,
    databaseId: DATABASE_ID,
    collectionId: COLLECTIONS.USERS,
    queries: [],
    pageLimit: 100,
    maxPages: 50
  });
  
  const prakash = users.find(u => u.name.includes("Prakash") && u.name.includes("Puri"));
  if (!prakash) {
    console.log("Prakash not found");
    return;
  }
  console.log("Found Prakash:", prakash.$id, prakash.name);
  
  // Get all target report data
  const monthFromIso = "2026-08-01";
  const monthToIso = "2026-08-31";
  
  // 1. Agent daily stats
  const docs = await listAllDocuments<any>({
    databases,
    databaseId: DATABASE_ID,
    collectionId: COLLECTIONS.AGENT_DAILY_STATS,
    queries: [
      Query.equal("agentId", prakash.$id),
      Query.greaterThanEqual("dateKey", monthFromIso),
      Query.lessThanEqual("dateKey", monthToIso),
    ],
    pageLimit: 100,
    maxPages: 100,
  });
  
  console.log("Agent Daily Stats Upfront Revenue:", docs.reduce((sum, d) => sum + (d.upfrontRevenue || 0), 0));
  for (const d of docs) {
    if (d.upfrontRevenue > 0) {
      console.log(` - ${d.dateKey}: ${d.upfrontRevenue}`);
    }
  }

  // 2. Followup payments
  const followups = await listAllDocuments<any>({
    databases,
    databaseId: DATABASE_ID,
    collectionId: COLLECTIONS.PREVIOUS_FOLLOWUPS_PAYMENTS,
    queries: [
      Query.equal("createdById", prakash.$id),
      Query.greaterThanEqual("date", monthFromIso),
      Query.lessThanEqual("date", monthToIso),
    ],
    pageLimit: 100,
    maxPages: 100,
  });
  
  console.log("Followup Payments:", followups.reduce((sum, d) => sum + (d.amount || 0), 0));
  for (const d of followups) {
    if (d.amount > 0) {
      console.log(` - ${d.date}: ${d.amount} (leadId: ${d.leadId})`);
    }
  }

  // 3. Technical payments
  const tech = await listAllDocuments<any>({
    databases,
    databaseId: DATABASE_ID,
    collectionId: COLLECTIONS.TECHNICAL_PAYMENTS,
    queries: [
      Query.equal("userId", prakash.$id),
      Query.greaterThanEqual("createdAt", `${monthFromIso}T00:00:00.000Z`),
      Query.lessThanEqual("createdAt", `${monthToIso}T23:59:59.999Z`),
    ],
    pageLimit: 100,
    maxPages: 100,
  });
  
  console.log("Tech Payments:", tech.reduce((sum, d) => sum + (d.amount || 0), 0));
  for (const d of tech) {
    if (d.amount > 0) {
      console.log(` - ${d.createdAt}: ${d.amount}`);
    }
  }
}

main().catch(console.error);
