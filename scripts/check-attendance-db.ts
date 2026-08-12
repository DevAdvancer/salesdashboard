import { Query } from "node-appwrite";
import { createAdminClient } from "../lib/server/appwrite";
import { COLLECTIONS, DATABASE_ID } from "../lib/constants/appwrite";

async function run() {
  const { databases } = await createAdminClient();
  const dateKey = "2026-08-12"; 
  console.log("Fetching attendance for:", dateKey);
  const response = await databases.listDocuments(DATABASE_ID, COLLECTIONS.ATTENDANCE, [
    Query.equal("dateKey", dateKey),
    Query.limit(100)
  ]);
  const todayDocs = response.documents;
  console.log(`Found ${todayDocs.length} attendance docs for today.`);
  for (const doc of todayDocs) {
    console.log(`User: ${doc.userId}, Present: ${doc.present}, PresentAt: ${doc.presentAt}, teamLeadId: ${doc.teamLeadId}`);
  }
}

run().catch(console.error);
