import { createAdminClient } from "@/lib/server/appwrite";
import { COLLECTIONS, DATABASE_ID } from "@/lib/constants/appwrite";

async function main() {
  const { databases } = await createAdminClient();
  
  try {
    console.log(`Deleting notifications collection (${COLLECTIONS.NOTIFICATIONS})...`);
    await databases.deleteCollection(DATABASE_ID, COLLECTIONS.NOTIFICATIONS);
    console.log(`Successfully deleted notifications collection.`);
  } catch (e: any) {
    console.error(`Failed to delete notifications collection:`, e.message);
  }
}

main().catch(console.error);
