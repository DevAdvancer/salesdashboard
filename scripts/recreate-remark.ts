import { createAdminClient } from "../lib/server/appwrite";
import { DATABASE_ID, COLLECTIONS } from "../lib/constants/appwrite";

async function recreate() {
  const { databases } = await createAdminClient();
  console.log("Deleting remark...");
  try {
    await databases.deleteAttribute(DATABASE_ID, COLLECTIONS.PREVIOUS_FOLLOWUPS_PAYMENTS, 'remark');
    console.log("Deleted. Waiting 5s...");
    await new Promise(r => setTimeout(r, 5000));
  } catch (e: any) {
    console.error("Error deleting:", e.message);
  }

  console.log("Recreating remark...");
  try {
    await databases.createStringAttribute(DATABASE_ID, COLLECTIONS.PREVIOUS_FOLLOWUPS_PAYMENTS, 'remark', 1000, false, undefined, false);
    console.log("Created. Waiting 5s...");
    await new Promise(r => setTimeout(r, 5000));
  } catch (e: any) {
    console.error("Error creating:", e.message);
  }

  console.log("Done.");
}

recreate().catch(console.error);
