import { Query } from "node-appwrite";
import { createAdminClient } from "../lib/server/appwrite";
import { COLLECTIONS, DATABASE_ID } from "../lib/constants/appwrite";

async function main() {
  const { databases } = await createAdminClient();
  const leads = ["6a971d0900056ae8e5b2", "6a97142600158e2ab289"];
  const targetDate = "2026-08-31T23:59:59.999Z";
  
  for (const id of leads) {
    // Update Lead closedAt
    await databases.updateDocument(DATABASE_ID, COLLECTIONS.LEADS, id, {
      closedAt: targetDate
    });
    console.log(`Updated Lead ${id} closedAt to ${targetDate}`);
    
    // Find client_payments
    const docs = await databases.listDocuments(DATABASE_ID, COLLECTIONS.CLIENT_PAYMENTS, [
      Query.equal("leadId", id)
    ]);
    
    for (const d of docs.documents) {
      let updates = [];
      try {
        updates = JSON.parse(d.updatesJson || d.updates || "[]");
      } catch {}
      
      let modified = false;
      for (const u of updates) {
        if (u.createdAt && u.createdAt.startsWith("2026-09-01")) {
          u.createdAt = targetDate;
          modified = true;
        }
      }
      
      if (modified) {
        await databases.updateDocument(DATABASE_ID, COLLECTIONS.CLIENT_PAYMENTS, d.$id, {
          updates: JSON.stringify(updates)
        });
        console.log(`Updated Payment ${d.$id} internal updates JSON createdAt to ${targetDate}`);
      }
    }
  }
}
main().catch(console.error);
