import { createAdminClient } from "../lib/server/appwrite";
import { DATABASE_ID, COLLECTIONS } from "../lib/constants/appwrite";

async function checkAttributes() {
  const { databases } = await createAdminClient();
  const attributes = await databases.listAttributes(DATABASE_ID, COLLECTIONS.PREVIOUS_FOLLOWUPS_PAYMENTS);
  console.log("Attributes:");
  for (const attr of attributes.attributes) {
    console.log(`- ${attr.key}: status = ${(attr as any).status}`);
  }
}

checkAttributes().catch(console.error);
