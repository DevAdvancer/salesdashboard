/**
 * Create previous_followups_payments collection
 */

import * as dotenv from "dotenv";
import * as path from "path";
import { ID, createAdminClient } from "../lib/server/appwrite";
import { DATABASE_ID } from "../lib/constants/appwrite";

// Load env vars
const envPath = path.resolve(process.cwd(), ".env");
dotenv.config({ path: envPath });

const COLLECTION_ID = "previous_followups_payments";

async function createCollection() {
  console.log("Creating previous_followups_payments collection...");
  const { databases } = await createAdminClient();

  try {
    // Check if collection exists
    await databases.getCollection(DATABASE_ID, COLLECTION_ID);
    console.log("Collection already exists:", COLLECTION_ID);
  } catch (error: any) {
    if (error?.code === 404) {
      console.log("Creating collection:", COLLECTION_ID);
      await databases.createCollection(DATABASE_ID, COLLECTION_ID, [
        // Permissions
      ], {
        name: "Previous Followups Payments",
      });
    } else {
      throw error;
    }
  }

  console.log("Collection setup complete!");
}

createCollection().catch(console.error);