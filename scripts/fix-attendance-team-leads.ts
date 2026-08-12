import { Query } from "node-appwrite";
import { createAdminClient } from "../lib/server/appwrite";
import { COLLECTIONS, DATABASE_ID } from "../lib/constants/appwrite";

async function run() {
  const { databases } = await createAdminClient();
  const dateKey = "2026-08-12"; 
  console.log("Fixing teamLeadId mismatches for attendance on:", dateKey);
  const response = await databases.listDocuments(DATABASE_ID, COLLECTIONS.ATTENDANCE, [
    Query.equal("dateKey", dateKey),
    Query.limit(5000)
  ]);
  
  const todayDocs = response.documents;
  const userIds = todayDocs.map(doc => doc.userId);
  
  // Fetch current users
  const chunks = [];
  for (let i = 0; i < userIds.length; i += 100) {
    chunks.push(userIds.slice(i, i + 100));
  }
  
  const usersById = new Map();
  for (const chunk of chunks) {
    const usersResponse = await databases.listDocuments(DATABASE_ID, COLLECTIONS.USERS, [
      Query.equal("$id", chunk),
      Query.limit(100)
    ]);
    for (const u of usersResponse.documents) {
      usersById.set(u.$id, u);
    }
  }

  let fixed = 0;
  for (const doc of todayDocs) {
    const user = usersById.get(doc.userId);
    if (!user) continue;

    const currentTeamLeadId = user.role === "team_lead" ? user.$id : (user.teamLeadId ?? null);
    if (currentTeamLeadId && doc.teamLeadId !== currentTeamLeadId) {
      console.log(`Fixing user: ${user.name} (${user.$id}). Attendance had teamLeadId=${doc.teamLeadId}, changing to ${currentTeamLeadId}`);
      await databases.updateDocument(DATABASE_ID, COLLECTIONS.ATTENDANCE, doc.$id, {
        teamLeadId: currentTeamLeadId
      });
      fixed++;
    }
  }
  console.log(`Fixed ${fixed} attendance docs with mismatched teamLeadIds.`);
}

run().catch(console.error);
