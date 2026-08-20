import { createAdminClient } from "../lib/server/appwrite";
import { COLLECTIONS, DATABASE_ID } from "../lib/constants/appwrite";
import { Query } from "node-appwrite";
import { listAllDocuments } from "../lib/server/appwrite-pagination";

async function main() {
  const { databases } = await createAdminClient();

  console.log("Fetching all users...");
  const users = await listAllDocuments<any>({
    databases,
    databaseId: DATABASE_ID,
    collectionId: COLLECTIONS.USERS,
    queries: [Query.select(["$id", "teamLeadId"])],
    pageLimit: 100,
    maxPages: 100
  });

  const teamLeadMap = new Map<string, string>();
  users.forEach(u => teamLeadMap.set(u.$id, u.teamLeadId));

  console.log("Fetching all daily stats...");
  const stats = await listAllDocuments<any>({
    databases,
    databaseId: DATABASE_ID,
    collectionId: COLLECTIONS.AGENT_DAILY_STATS,
    queries: [],
    pageLimit: 100,
    maxPages: 500
  });

  console.log(`Found ${stats.length} stats. Updating teamLeadId...`);

  let updated = 0;
  for (const stat of stats) {
    const currentTeamLead = stat.teamLeadId;
    const correctTeamLead = teamLeadMap.get(stat.agentId) || null;

    if (currentTeamLead !== correctTeamLead) {
      await databases.updateDocument(
        DATABASE_ID,
        COLLECTIONS.AGENT_DAILY_STATS,
        stat.$id,
        { teamLeadId: correctTeamLead }
      );
      updated++;
      if (updated % 50 === 0) console.log(`Updated ${updated} records...`);
    }
  }

  console.log(`Finished. Updated ${updated} records.`);
}

main().catch(console.error);
