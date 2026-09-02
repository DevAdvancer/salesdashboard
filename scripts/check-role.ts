import { createAdminClient } from "../lib/server/appwrite";
import { DATABASE_ID, COLLECTIONS } from "../lib/constants/appwrite";

async function run() {
  const { databases } = await createAdminClient();
  const attr = await databases.getAttribute(DATABASE_ID, COLLECTIONS.USERS, "role");
  console.log(attr);
}

run().catch(console.error);
