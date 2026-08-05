import { createAdminClient } from "@/lib/server/appwrite";
import { COLLECTIONS, DATABASE_ID } from "@/lib/constants/appwrite";

async function countAll() {
  const { databases } = await createAdminClient();
  console.log("Fetching counts...");
  
  for (const [key, id] of Object.entries(COLLECTIONS)) {
    try {
      // Fetching 0 documents, but the total count will be returned
      const res = await databases.listDocuments(DATABASE_ID, id, []);
      console.log(`${key} (${id}): ${res.total}`);
    } catch(e) {
      console.log(`${key} (${id}): ERROR`);
    }
  }
}

countAll().catch(console.error);
