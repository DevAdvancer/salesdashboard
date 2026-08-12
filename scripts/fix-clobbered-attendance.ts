import { Query } from "node-appwrite";
import { createAdminClient } from "../lib/server/appwrite";
import { COLLECTIONS, DATABASE_ID } from "../lib/constants/appwrite";

async function run() {
  const { databases } = await createAdminClient();
  const dateKey = "2026-08-12"; 
  console.log("Fixing attendance for:", dateKey);
  const response = await databases.listDocuments(DATABASE_ID, COLLECTIONS.ATTENDANCE, [
    Query.equal("dateKey", dateKey),
    Query.limit(500)
  ]);
  
  const todayDocs = response.documents;
  let fixed = 0;
  for (const doc of todayDocs) {
    if (doc.present === false && doc.presentAt !== null) {
      console.log(`Fixing user: ${doc.userId} who had presentAt=${doc.presentAt} but present=false`);
      await databases.updateDocument(DATABASE_ID, COLLECTIONS.ATTENDANCE, doc.$id, {
        present: true
      });
      fixed++;
    }
  }
  console.log(`Fixed ${fixed} attendance docs.`);
}

run().catch(console.error);
