import { createAdminClient } from "@/lib/server/appwrite";
import { COLLECTIONS, DATABASE_ID } from "@/lib/constants/appwrite";
import { Query } from "node-appwrite";

async function run() {
  const { databases } = await createAdminClient();
  const followups = await databases.listDocuments(DATABASE_ID, COLLECTIONS.PREVIOUS_FOLLOWUPS_PAYMENTS, [
    Query.greaterThanEqual("date", "2026-08-01T00:00:00.000Z"),
    Query.lessThanEqual("date", "2026-08-31T23:59:59.000Z"),
  ]);
  
  for (const f of followups.documents) {
    const attributedTo = f.creditedAgentId || f.createdById;
    if (attributedTo === "698cf7a3002db144acbd") { // Alisha
      console.log(`Followup ID: ${f.$id}, Amount: ${f.amount}, LeadID: ${f.leadId}`);
    }
  }
}

run().catch(console.error);
