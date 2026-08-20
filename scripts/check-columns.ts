import { createAdminClient } from "@/lib/server/appwrite";
import { COLLECTIONS, DATABASE_ID } from "@/lib/constants/appwrite";

async function run() {
  const { databases } = await createAdminClient();
  const docs = await databases.listDocuments(DATABASE_ID, COLLECTIONS.AGENT_DAILY_STATS);
  console.log(docs.documents[0]);
}

run().catch(console.error);
