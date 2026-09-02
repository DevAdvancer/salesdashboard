import { createAdminClient } from "../lib/server/appwrite";
import { DATABASE_ID, COLLECTIONS } from "../lib/constants/appwrite";

async function run() {
  const { databases } = await createAdminClient();
  await databases.updateEnumAttribute(
    DATABASE_ID,
    COLLECTIONS.USERS,
    "role",
    ['admin', 'developer', 'team_lead', 'senior_tl', 'agent', 'lead_generation', 'monitor', 'operations', 'compliance'],
    true,
    null as any
  );
  console.log("Done");
}

run().catch(console.error);
