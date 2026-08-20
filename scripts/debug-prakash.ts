import { createAdminClient } from "@/lib/server/appwrite";
import { DATABASE_ID, COLLECTIONS } from "@/lib/constants/appwrite";
import { Query } from "node-appwrite";
import { listAllDocuments } from "@/lib/server/appwrite-pagination";

async function run() {
  const { databases } = await createAdminClient();
  const docs = await listAllDocuments<any>({
    databases,
    databaseId: DATABASE_ID,
    collectionId: COLLECTIONS.AGENT_DAILY_STATS,
    queries: [
      Query.equal("dateKey", [
        "2026-08-01", "2026-08-02", "2026-08-03", "2026-08-04",
        "2026-08-05", "2026-08-06", "2026-08-07", "2026-08-08",
        "2026-08-09", "2026-08-10", "2026-08-11", "2026-08-12",
        "2026-08-13", "2026-08-14", "2026-08-15", "2026-08-16",
        "2026-08-17", "2026-08-18", "2026-08-19", "2026-08-20",
        "2026-08-21", "2026-08-22", "2026-08-23", "2026-08-24",
        "2026-08-25", "2026-08-26", "2026-08-27", "2026-08-28",
        "2026-08-29", "2026-08-30", "2026-08-31"
      ]),
      Query.limit(100),
    ],
  });

  const users = await databases.listDocuments(DATABASE_ID, COLLECTIONS.USERS, [
    Query.limit(500)
  ]);
  const pId = users.documents.find(u => u.name && u.name.includes('Prakash')).$id;

  console.log("Prakash ID:", pId);

  let totalUpfront = 0;
  for (const doc of docs) {
    if (doc.agentId === pId) {
      if (doc.upfrontRevenue > 0) {
        console.log(`Date: ${doc.dateKey}, Upfront: ${doc.upfrontRevenue}, Tech: ${doc.technicalUpfrontRevenue}`);
      }
      totalUpfront += doc.upfrontRevenue || 0;
    }
  }

  const followups = await listAllDocuments<any>({
    databases,
    databaseId: DATABASE_ID,
    collectionId: COLLECTIONS.PREVIOUS_FOLLOWUPS_PAYMENTS,
    queries: [
      Query.equal("createdById", pId),
      Query.greaterThanEqual("date", "2026-08-01"),
      Query.lessThanEqual("date", "2026-08-31")
    ]
  });

  let totalFollowups = 0;
  for (const f of followups) {
    console.log(`Followup Date: ${f.date}, Amount: ${f.amount}, Lead: ${f.leadId}`);
    totalFollowups += f.amount || 0;
  }

  console.log(`Total Upfront (Agent Stats): ${totalUpfront}`);
  console.log(`Total Followups: ${totalFollowups}`);
  console.log(`Total Achieved: ${totalUpfront + totalFollowups}`);
}

run().catch(console.error);
