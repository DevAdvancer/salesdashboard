/**
 * Setup script for previous_followups_payments collection
 * Run: bun run setup:appwrite
 */

import { createAdminClient } from "../lib/server/appwrite";
import { DATABASE_ID, COLLECTIONS } from "../lib/constants/appwrite";

async function setup() {
  console.log("Setting up previous_followups_payments collection...");
  const { databases } = await createAdminClient();

  try {
    // Check if collection exists
    await databases.getCollection(DATABASE_ID, COLLECTIONS.PREVIOUS_FOLLOWUPS_PAYMENTS);
    console.log("Collection already exists:", COLLECTIONS.PREVIOUS_FOLLOWUPS_PAYMENTS);
  } catch (error: any) {
    if (error?.code === 404) {
      console.log("Creating collection:", COLLECTIONS.PREVIOUS_FOLLOWUPS_PAYMENTS);
      await databases.createCollection(DATABASE_ID, ID.unique(), {
        name: "Previous Followups Payments",
      });
    } else {
      throw error;
    }
  }

  console.log("Setup complete!");
}

setup().catch(console.error);
