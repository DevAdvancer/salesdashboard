import { Query } from "node-appwrite";
import { createAdminClient } from "../lib/server/appwrite";
import { COLLECTIONS, DATABASE_ID } from "../lib/constants/appwrite";

async function main() {
  const { databases } = await createAdminClient();
  const monthKey = "2026-08";
  
  const targets = await databases.listDocuments(DATABASE_ID, COLLECTIONS.MONTHLY_TARGETS, [
    Query.equal("monthKey", monthKey),
    Query.limit(100),
  ]);
  
  const assignments = await databases.listDocuments(DATABASE_ID, COLLECTIONS.MONTHLY_TARGET_ASSIGNMENTS, [
    Query.limit(500),
  ]);

  const users = await databases.listDocuments(DATABASE_ID, COLLECTIONS.USERS, [
    Query.limit(500),
  ]);
  const userMap = new Map();
  users.documents.forEach(u => userMap.set(u.$id, u.name));

  for (const t of targets.documents) {
    console.log(`Team Lead: ${t.teamLeadName} (Target: $${t.totalAmount})`);
    
    const assigned = assignments.documents.filter((a: any) => a.monthlyTargetId === t.$id);
    for (const a of assigned) {
      console.log(`  - ${userMap.get(a.agentId) || a.agentId}: $${a.amount}`);
    }
  }
}
main().catch(console.error);
