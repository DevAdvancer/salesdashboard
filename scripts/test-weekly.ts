import { createAdminClient } from "../lib/server/appwrite";
import { COLLECTIONS, DATABASE_ID } from "../lib/constants/appwrite";
import { Query } from "node-appwrite";
import { getWeeklyReportAction } from "../app/actions/weekly-report";

async function main() {
  const { databases } = await createAdminClient();
  const admins = await databases.listDocuments(DATABASE_ID, COLLECTIONS.USERS, [Query.equal('role', 'admin'), Query.limit(1)]);
  const admin = admins.documents[0];
  console.log("Found admin:", admin.$id);
  
  try {
    const res = await getWeeklyReportAction({ actorId: admin.$id, from: "2026-08-25T00:00:00.000Z", to: "2026-08-25T23:59:59.999Z" });
    console.log("Success! Found teams:", res.teams.length);
    if (res.teams.length === 0) {
      console.log("Empty teams!");
    }
  } catch(e: any) {
    console.error("Error:", e);
  }
}

main();
